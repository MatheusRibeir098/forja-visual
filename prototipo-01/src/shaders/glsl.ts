/**
 * Trechos GLSL ES 3.00 compartilhados entre shaders.
 *
 * Regra do projeto: shaders vivem em `.ts` exportando strings — assim o bundler
 * os trata como código (minifica, tree-shake) e o TS garante que nenhum shader
 * fique órfão. Nada aqui depende de three: são funções GLSL puras.
 */

/**
 * Vertex de tela cheia com **um único triângulo** (não um quad de 2 triângulos).
 *
 * Por que triângulo: o quad tem uma diagonal no meio da tela onde os quads de
 * 2x2 pixels do rasterizador são invocados duas vezes (helper lanes duplicados).
 * Um triângulo que ultrapassa a viewport cobre a tela inteira sem essa costura
 * e sem geometria de plano — 3 vértices, zero índices.
 *
 * Espera um atributo `position` vec3 (Z ignorado) com os vértices (-1,-1),
 * (3,-1), (-1,3). Três componentes, e não duas, porque o three calcula bounding
 * sphere a partir de `position` e um atributo sem Z produz raio NaN.
 * `vUv` sai em [0,1] dentro da viewport (e > 1 na parte descartada).
 */
export const FULLSCREEN_TRIANGLE_VERTEX: string = /* glsl */ `
precision highp float;

in vec3 position;
out vec2 vUv;

void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * Emula `object-fit: cover` para uma textura amostrada em coordenadas de tela.
 *
 * Sem isso, uma máscara quadrada esticada numa tela 21:9 vira um padrão achatado
 * — o olho lê distorção antes de ler o efeito. `coverUv` mantém a proporção da
 * textura e corta o excesso no eixo que sobra, como o CSS faria.
 *
 * @param uv           coordenada de tela em [0,1]
 * @param aspectTex    largura/altura da textura
 * @param aspectScreen largura/altura da viewport
 */
export const COVER_UV: string = /* glsl */ `
vec2 coverUv(vec2 uv, float aspectTex, float aspectScreen) {
  // Tela mais larga que a textura -> a textura estica na horizontal e sobra
  // em cima/embaixo, então comprimimos a amostragem em Y (e vice-versa).
  vec2 scale = aspectScreen > aspectTex
    ? vec2(1.0, aspectTex / aspectScreen)
    : vec2(aspectScreen / aspectTex, 1.0);
  return (uv - 0.5) * scale + 0.5;
}
`;

/**
 * Transferência linear -> sRGB, idêntica ao chunk `colorspace_fragment` do three
 * (incluindo o expoente 0.41666 que ele usa, e não 1/2.4 exato).
 *
 * Precisa ser explícita aqui porque `RawShaderMaterial` não recebe injeção de
 * chunks do three: o `outputColorSpace` do renderer não é aplicado sozinho.
 * Manter a mesma fórmula garante que um objeto renderizado direto na tela e o
 * mesmo objeto passando pelo composite cheguem à mesma cor.
 */
export const LINEAR_TO_SRGB: string = /* glsl */ `
vec3 linearToSrgb(vec3 color) {
  vec3 c = max(color, vec3(0.0)); // pow() de negativo vira NaN em half-float
  return mix(
    pow(c, vec3(0.41666)) * 1.055 - vec3(0.055),
    c * 12.92,
    vec3(lessThanEqual(c, vec3(0.0031308)))
  );
}
`;
