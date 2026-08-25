import { COVER_UV, LINEAR_TO_SRGB } from '@/shaders/glsl';
import { POINTER_RAY_GLSL } from '@/engine/pointer';

/**
 * Tinta sobre papel — o plano que fica **atrás** de um bloco de texto do DOM,
 * sincronizado 1 px = 1 unidade por `engine/domSync`.
 *
 * A ideia não é "shader de fundo": é fingir que a página foi impressa e que o
 * papel ainda está úmido. Três fenômenos de impressão, todos sutis:
 *
 * 1. **Bleed** — a tinta se espalha a partir do cursor. A distância vem do
 *    *raio* do cursor (V.4), não de um ponto 3D, então o efeito é o mesmo em
 *    qualquer profundidade do plano.
 * 2. **Fibra** — a borda do bleed é deformada por uma textura de grão, porque
 *    papel absorve pela fibra e não em círculo perfeito.
 * 3. **Misregistration** — os canais R/G/B amostram o grão com 1–2 px de
 *    deslocamento, como chapas de impressão fora de registro.
 *
 * O plano é **opaco**: em vez de blendar alpha, ele mistura papel→tinta e
 * escreve a cor final. O `clearColor` do renderer é o mesmo papel, então a
 * junção é invisível — e o texto continua sendo HTML por cima, com seleção,
 * foco e leitor de tela intactos.
 *
 * A mistura só anda numa direção: do papel para `uInk`. Quem escolhe `uInk`
 * decide, com isso, o que acontece com o contraste — e a regra do projeto é
 * escolher uma tinta que **afaste** o fundo do texto (mais escura que o papel
 * numa página clara, mais clara numa página escura). `uInkMax` é o teto que
 * transforma essa escolha num número verificável.
 */

/**
 * Fração do raio em que a tinta ainda é plena. 0.18 dá um núcleo pequeno e uma
 * saia longa — é o perfil de absorção real; com núcleo grande vira um disco.
 */
const BLEED_CORE = 0.18;

/**
 * Altura (em UV do plano) até onde a absorção por scroll sobe a partir da base
 * do bloco. 0.8 deixa o topo do texto sempre mais limpo que o rodapé, que é o
 * que dá a leitura de "molhando de baixo para cima".
 */
const SOAK_REACH = 0.8;

/**
 * Enfraquecimento máximo pelo grão: 0.55 significa que a fibra mais clara segura
 * 55% da tinta. Abaixo disso o grão vira chuvisco; acima, some.
 */
const FIBER_FLOOR = 0.55;

/**
 * Início do esfumado, em raio normalizado do bloco (0 = centro, 1 = canto).
 *
 * A queda é **elíptica**, não retangular: qualquer esfumado alinhado aos lados
 * do plano deixa trechos retos, e um trecho reto de mancha no meio do papel
 * denuncia o retângulo na hora — foi exatamente o que apareceu no primeiro
 * teste. 0.35 dá um núcleo pequeno e uma queda longa, sem borda em lugar nenhum.
 */
const EDGE_FALLOFF_START = 0.35;

/** Grão quadrado: `coverUv` usa isto para não esticar a fibra em planos largos. */
const GRAIN_ASPECT = 1;

/**
 * Escala da amostra larga do grão em relação à fina. 0.22 ≈ 4,5× maior: separa
 * "mancha" (o que deforma a borda do bleed) de "fibra" (o que quebra o tom).
 */
const WIDE_GRAIN_SCALE = 0.22;

/**
 * Deslocamento da segunda amostra larga, em repetições do grão. 0.37 não é
 * múltiplo de nenhuma das oitavas da textura (6/17/43), então o par (x, y) do
 * domain warp sai descorrelacionado — com offset harmônico as duas amostras
 * andam juntas e o warp vira translação, não distorção.
 */
const WARP_OFFSET = 0.37;

export const vertex: string = /* glsl */ `
precision highp float;

in vec3 position;
in vec2 uv;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform vec2 uPointerRay;

out vec2 vUv;
/** Deslocamento do fragmento até o raio do cursor, em px (1 unidade = 1 px). */
out vec2 vPointer;

${POINTER_RAY_GLSL}

void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vPointer = pointerOffset(mv.xyz, uPointerRay);
  gl_Position = projectionMatrix * mv;
}
`;

/**
 * Uniforms esperados:
 * - `uGrain`         textura de grão do papel (R8, RepeatWrapping)
 * - `uGrainScale`    repetições do grão sobre o lado maior do plano
 * - `uPaper`,`uInk`  cores em espaço linear
 * - `uPlanePx`       tamanho do plano em px (vem de `mesh.scale`)
 * - `uPointerRay`    direção do cursor em view space dividida por z
 * - `uPointer`       0–1, presença do cursor (amortecida na CPU)
 * - `uBleedInk`      tinta máxima que o bleed do cursor deposita
 * - `uRadiusPx`      raio do bleed em px
 * - `uFiberPx`       amplitude da deformação da borda pelo grão, em px
 * - `uMisregPx`      desalinhamento entre canais, em px
 * - `uSoak`          0–1, absorção acumulada pelo scroll
 * - `uRest`          tinta de repouso (quase invisível, > 0 só para o papel viver)
 * - `uInkMax`        teto de tinta — o guarda que protege o contraste do texto
 * - `uWarpPx`        amplitude do domain warp sob o cursor, em px (opcional)
 *
 * `uWarpPx` é o único opcional: um uniform declarado no shader e ausente do
 * material fica no default do GL, que é 0 — e 0 é exatamente "sem warp", o
 * comportamento de quem só quer a tinta. Quem quer a distorção passa o valor.
 */
export const fragment: string = /* glsl */ `
precision highp float;

in vec2 vUv;
in vec2 vPointer;
out vec4 outColor;

uniform sampler2D uGrain;
uniform float uGrainScale;
uniform vec3 uPaper;
uniform vec3 uInk;
uniform vec2 uPlanePx;
uniform float uPointer;
uniform float uBleedInk;
uniform float uRadiusPx;
uniform float uFiberPx;
uniform float uMisregPx;
uniform float uSoak;
uniform float uRest;
uniform float uInkMax;
uniform float uWarpPx;

${COVER_UV}
${LINEAR_TO_SRGB}

/** Queda elíptica: a mancha morre antes da borda do plano, sem nenhum trecho reto. */
float edgeFalloff(vec2 uv) {
  float radius = length((uv - 0.5) * 2.0);
  return 1.0 - smoothstep(${EDGE_FALLOFF_START.toFixed(2)}, 1.0, radius);
}

void main() {
  float planeAspect = uPlanePx.x / max(uPlanePx.y, 1.0);
  // coverUv mantém a fibra isotrópica: sem ele, um titulo 5:1 esticaria o grão
  // cinco vezes na horizontal e o papel viraria madeira.
  vec2 grainUv = (coverUv(vUv, ${GRAIN_ASPECT.toFixed(1)}, planeAspect) - 0.5) * uGrainScale;
  vec2 misreg = vec2(uMisregPx / max(uPlanePx.x, 1.0), 0.0) * uGrainScale;

  // coverUv deixa o grão isotrópico, então 1 px vale o mesmo nos dois eixos:
  // o fator é sempre em relação ao lado maior do plano.
  float grainPerPx = uGrainScale / max(max(uPlanePx.x, uPlanePx.y), 1.0);

  float wide = texture(uGrain, grainUv * ${WIDE_GRAIN_SCALE.toFixed(2)}).r;

  // Domain warp: a segunda amostra larga (eixos trocados e deslocada) empurra a
  // amostragem da fibra. É o que faz a superfície *distorcer* sob o cursor em
  // vez de só escurecer — a fibra escorre, como papel molhado que incha.
  float wideWarp =
    texture(uGrain, grainUv.yx * ${WIDE_GRAIN_SCALE.toFixed(2)} + ${WARP_OFFSET.toFixed(2)}).r;
  grainUv += (vec2(wide, wideWarp) - 0.5) * uWarpPx * grainPerPx * uPointer;

  // Borda fibrosa: o grão largo empurra o raio do bleed para dentro e para fora.
  float dist = length(vPointer) + (wide - 0.5) * uFiberPx;
  float bleed = 1.0 - smoothstep(uRadiusPx * ${BLEED_CORE.toFixed(2)}, uRadiusPx, dist);

  // Absorção por scroll, subindo da base do bloco.
  float soak = uSoak * (1.0 - smoothstep(0.0, ${SOAK_REACH.toFixed(2)}, vUv.y));

  float amount = uRest + bleed * uPointer * uBleedInk + soak;
  amount = min(amount, uInkMax) * edgeFalloff(vUv);

  // Fora de registro: cada canal lê a fibra com um deslocamento próprio.
  vec3 fiber = vec3(
    texture(uGrain, grainUv + misreg).r,
    texture(uGrain, grainUv).r,
    texture(uGrain, grainUv - misreg).r
  );
  vec3 ink = amount * mix(vec3(${FIBER_FLOOR.toFixed(2)}), vec3(1.0), fiber);

  outColor = vec4(linearToSrgb(mix(uPaper, uInk, ink)), 1.0);
}
`;
