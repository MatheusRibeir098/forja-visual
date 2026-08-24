import { COVER_UV, FULLSCREEN_TRIANGLE_VERTEX, LINEAR_TO_SRGB } from '@/shaders/glsl';

/**
 * Transição por **máscara de threshold** (catálogo III.1) entre duas texturas.
 *
 * Não é crossfade: em qualquer progresso intermediário a maioria dos pixels é
 * 100% A ou 100% B, e só a borda de largura `uSoftness` mistura. É a diferença
 * entre "a imagem some" e "a imagem é comida por um padrão".
 */

/**
 * Largura (em unidades da máscara, 0–1) da faixa que ainda mistura A e B.
 * 0.05 = ~13 dos 256 níveis de uma máscara de 8 bits: largo o bastante para o
 * filtro linear esconder o banding da quantização, estreito o bastante para a
 * borda continuar lendo como recorte e não como fade.
 */
export const DEFAULT_SOFTNESS = 0.05;

/**
 * Expoente aplicado ao progresso antes do threshold.
 *
 * O olho mede a transição pela *velocidade da borda*, não pela área revelada.
 * Com expoente 1 a borda sai disparada no primeiro quadro e desacelera — parece
 * um corte. Com 1.6 o início é contido e a borda ganha velocidade, que é a
 * leitura de "algo avançando". Medido comparando 1.0 / 1.3 / 1.6 / 2.2 no
 * `dev/composite.html`: acima de ~2 o começo passa a parecer travado.
 */
export const DEFAULT_CURVE = 1.6;

/** Zoom do padrão da máscara sobre a tela. 1 = a máscara cobre a viewport uma vez. */
export const DEFAULT_MASK_SCALE = 1;

/** Vertex de tela cheia (um triângulo, sem geometria de plano). */
export const vertex: string = FULLSCREEN_TRIANGLE_VERTEX;

/**
 * Uniforms esperados:
 * - `uTexA`, `uTexB`  cenas já renderizadas em render target (espaço linear)
 * - `uMask`           textura P&B; só o canal R é lido
 * - `uProgress`       0–1
 * - `uSoftness`       largura da borda de mistura
 * - `uCurve`          expoente de ritmo (ver DEFAULT_CURVE)
 * - `uAspect`         .x = aspecto da viewport, .y = aspecto da máscara
 * - `uMaskScale`      zoom do padrão
 */
export const fragment: string = /* glsl */ `
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uTexA;
uniform sampler2D uTexB;
uniform sampler2D uMask;
uniform float uProgress;
uniform float uSoftness;
uniform float uCurve;
uniform vec2 uAspect;
uniform float uMaskScale;

${COVER_UV}
${LINEAR_TO_SRGB}

void main() {
  vec2 maskUv = coverUv(vUv, uAspect.y, uAspect.x);
  maskUv = (maskUv - 0.5) / uMaskScale + 0.5;
  float threshold = texture(uMask, maskUv).r;

  float curved = pow(clamp(uProgress, 0.0, 1.0), uCurve);

  // Remapeia o progresso para [-uSoftness, 1 + uSoftness]. Sem isso, em
  // uProgress = 0 os pixels com threshold 0 cairiam no meio do smoothstep
  // (t = 0.5) e a cena B vazaria antes de a transicao comecar.
  float head = curved * (1.0 + 2.0 * uSoftness) - uSoftness;

  float t = smoothstep(threshold - uSoftness, threshold + uSoftness, head);

  vec3 a = texture(uTexA, vUv).rgb;
  vec3 b = texture(uTexB, vUv).rgb;
  outColor = vec4(linearToSrgb(mix(a, b, t)), 1.0);
}
`;
