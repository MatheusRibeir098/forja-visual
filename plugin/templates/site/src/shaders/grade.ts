import { FULLSCREEN_TRIANGLE_VERTEX } from '@/shaders/glsl';

/**
 * O passe de grade final (VI.3+VI.4 do catálogo, em produção): o shader que
 * transforma o FBO de página — a montagem inteira do site, em um retrato
 * único — de "render de browser" em "imagem revelada".
 *
 * Compartilha o vertex de tela cheia de `glsl.ts`, então este módulo só
 * exporta o fragment.
 *
 * ── POR QUE O FBO NÃO É HDR DE VERDADE ──────────────────────────────────────
 * A convenção do motor é que **toda cena termina o próprio fragment em
 * `linearToSrgb`** — os shaders nascem podendo escrever direto na tela. Este
 * passe portanto opera em espaço **de exibição** (os mesmos números que a tela
 * receberia, antes só do encode final): bloom aqui é brilho cosmético sobre a
 * imagem já revelada, não soma de radiância física. É a mesma simplificação
 * que motores de jogo fazem quando o pipeline upstream não é HDR — o ganho
 * (banding morto, sem emenda entre seções) supera a pureza perdida.
 * Consequência medida: como não há faixa acima de 1.0 para preservar, o FBO de
 * página é `RGBA8`, não `RGBA16F` — ver o comentário de `createFrame` em
 * `engine/frame.ts`. Se as suas cenas escreverem luz linear no FBO, é este
 * parágrafo que deixa de valer, e aí meça antes de mudar os dois arquivos.
 *
 * ── BLOOM INLINE, SEM TROCA DE RENDER TARGET ────────────────────────────────
 * Existia um mip-chain de 2-3 estágios (extração + downsample), cada um seu
 * próprio `WebGLRenderTarget` e seu próprio `setRenderTarget`. Medido: no
 * tier `high`, mesmo com a mediana de GPU confortável (11-12 ms de 16,67), o
 * p5 de fps caía a 30 em ~40% das execuções — cauda instável mesmo com
 * `bloomLevels = 1` (um `setRenderTarget` a mais só) e p95 de GPU ainda
 * abaixo do teto. A hipótese: o custo não é fill rate, é overhead/stall de
 * driver por troca de alvo (Mesa/ANGLE em Intel integrada). Este bloom
 * amostra `uScene` (o próprio FBO de página) direto, com taps largos em dois
 * anéis, tudo dentro do passe de grade — zero `setRenderTarget` extra. Troca
 * *switches* por *fill rate*, que é justamente o que sobrava. Custa halo mais
 * curto que o mip-chain (menos alcance), e é a troca certa: numa GPU
 * integrada, uma troca de alvo a mais custa mais que centenas de taps.
 */

/**
 * O passe final: FBO de página -> tela. Ordem fixa:
 * curva fílmica -> bloom -> vinheta -> grão animado -> dither.
 *
 * Uniforms:
 * - `uScene`          FBO de página (RGBA8, espaço de exibição — ver acima)
 * - `uTexelSize`       1/tamanho de `uScene`, em px — base dos taps do bloom
 * - `uBloomEnabled`    0 desliga o laço de taps sem mudar caminho de código
 * - `uBloomIntensity`  ganho do brilho somado
 * - `uBloomThreshold`  brilho mínimo (canal máx.) que entra no bloom
 * - `uBloomKnee`       largura do joelho suave em torno do threshold
 * - `uFilmicStrength`  0–1, mistura entre identidade e a curva em S
 * - `uVignetteStrength` 0–1, força do escurecimento de borda
 * - `uGrainAmount`     amplitude do grão, em fração de canal (0–1)
 * - `uGrainSeed`       muda por quadro quando animado; 0 sob reduced-motion
 */
export const gradeFragment: string = /* glsl */ `
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uScene;
uniform vec2 uTexelSize;
uniform float uBloomEnabled;
uniform float uBloomIntensity;
uniform float uBloomThreshold;
uniform float uBloomKnee;
uniform float uFilmicStrength;
uniform float uVignetteStrength;
uniform float uGrainAmount;
uniform float uGrainSeed;

/** Extrai só o brilho acima do threshold, com joelho suave (Karis/Unity). */
vec3 bloomTap(vec2 uv) {
  vec3 c = texture(uScene, uv).rgb;
  float brightness = max(max(c.r, c.g), c.b);
  float soft = clamp(brightness - uBloomThreshold + uBloomKnee, 0.0, 2.0 * uBloomKnee);
  soft = soft * soft / (4.0 * uBloomKnee + 1e-4);
  float contribution = max(soft, brightness - uBloomThreshold) / max(brightness, 1e-4);
  return c * contribution;
}

/**
 * Bloom "inline": 8 taps largos em dois anéis, direto no FBO de página, sem
 * passe extra e sem troca de render target — ver a nota do módulo. Os raios
 * são em fração de tela (não em texel de \`uScene\`), então o alcance do halo
 * não encolhe quando o FBO é redimensionado.
 */
vec3 inlineBloom(vec2 uv) {
  const float RING1 = 0.006;
  const float RING2 = 0.014;
  float aspect = uTexelSize.y / uTexelSize.x;
  vec2 r1 = vec2(RING1, RING1 * aspect);
  vec2 r2 = vec2(RING2, RING2 * aspect);

  vec3 sum = bloomTap(uv + vec2( r1.x, 0.0));
  sum += bloomTap(uv + vec2(-r1.x, 0.0));
  sum += bloomTap(uv + vec2(0.0,  r1.y));
  sum += bloomTap(uv + vec2(0.0, -r1.y));
  sum += bloomTap(uv + vec2( r2.x,  r2.y));
  sum += bloomTap(uv + vec2(-r2.x,  r2.y));
  sum += bloomTap(uv + vec2( r2.x, -r2.y));
  sum += bloomTap(uv + vec2(-r2.x, -r2.y));
  return sum * 0.125;
}

/**
 * Curva em S que preserva os dois extremos exatamente (f(0)=0, f(1)=1): texto
 * quase-branco ou quase-preto — o caso do contraste medido — mal se move,
 * porque smoothstep já é ~identidade perto das pontas. O meio-tom ganha
 * contraste. uFilmicStrength é a mistura com a identidade, não a curva
 * pura: aplicá-la a 100% também preserva os extremos, mas a mistura deixa a
 * força ajustável sem trocar de fórmula.
 */
vec3 filmicCurve(vec3 x) {
  vec3 s = x * x * (3.0 - 2.0 * x);
  return mix(x, s, uFilmicStrength);
}

float vignette(vec2 uv) {
  vec2 centered = uv - 0.5;
  float radius = length(centered) * 1.4142136; // canto = 1
  float falloff = smoothstep(0.35, 1.05, radius);
  return 1.0 - uVignetteStrength * falloff;
}

/** Hash 1D determinístico a partir de posição de tela + semente de quadro. */
float grainHash(vec2 coord, float seed) {
  vec3 p = vec3(coord, seed);
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

/**
 * Interleaved Gradient Noise (Jimenez, "Next Generation Post-Processing in
 * Call of Duty: Advanced Warfare", SIGGRAPH 2014). Ruído azul de verdade
 * precisa de uma textura pré-computada (não dá para gerar em tempo real — é
 * o próprio ponto do ruído azul); IGN é a aproximação sem textura e sem custo
 * de fetch que a indústria usa exatamente para isto: dither anti-banding de
 * 1 LSB, por pixel, todo quadro, de graça.
 */
float interleavedGradientNoise(vec2 coord) {
  const vec3 magic = vec3(0.06711056, 0.00583715, 52.9829189);
  return fract(magic.z * fract(dot(coord, magic.xy)));
}

void main() {
  vec3 color = texture(uScene, vUv).rgb;

  color = filmicCurve(color);

  if (uBloomEnabled > 0.0) {
    color += inlineBloom(vUv) * uBloomIntensity;
  }

  color *= vignette(vUv);

  // Grão 1:1 pixel: lido de gl_FragCoord (px físicos do backbuffer), nunca de
  // vUv — em vUv o grão escalaria com o FBO e deixaria de ser grão de sensor.
  float grain = grainHash(gl_FragCoord.xy, uGrainSeed) - 0.5;
  color += grain * uGrainAmount;

  color = clamp(color, 0.0, 1.0);

  // Dither por último, depois de qualquer clamp: é o que mata o degrau da
  // quantização de 8 bits do backbuffer, então tem que ser a última soma antes
  // do outColor.
  float dither = interleavedGradientNoise(gl_FragCoord.xy) - 0.5;
  color += dither / 255.0;

  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

export const vertex: string = FULLSCREEN_TRIANGLE_VERTEX;
