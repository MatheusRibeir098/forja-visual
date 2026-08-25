import { FULLSCREEN_TRIANGLE_VERTEX } from '@/shaders/glsl';
import { POINTER_RAY_GLSL } from '@/engine';

/**
 * Cena B da variante A: **o específico** — um campo de limalha de ferro.
 *
 * Cada limalha é uma cápsula curta *fixa numa grade*: ela nunca se desloca, só
 * gira. É essa a diferença entre limalha magnetizada sobre papel e "partículas
 * flutuando", que é o efeito médio que este projeto existe para evitar.
 *
 * A direção vem da soma de três polos magnéticos (campo 1/r², linhas de campo
 * de verdade, não ruído), e o cursor entra como um quarto polo: perto dele a
 * limalha se alinha radialmente, alonga e esquenta — a metáfora da forja, em
 * que a mão do visitante é a fonte de calor.
 *
 * O cursor é tratado como **raio** (técnica V.4): as limalhas têm profundidade
 * jitterada para dar paralaxe, e medir distância até um *ponto* faria só a
 * fatia de limalha naquela profundidade reagir. `pointerOffset(mv.xyz, ray)`
 * devolve o afastamento do raio na própria profundidade do ponto — atenção ao
 * sinal, a forma correta é a **soma** `mv.xy + ray * mv.z`.
 */

// ---------------------------------------------------------------------------
// Limalha
// ---------------------------------------------------------------------------

/**
 * Uniforms do campo:
 * - `uPointerRay`      direção do cursor em view space, já dividida por z
 * - `uPointerActive`   0 quando não há cursor (touch) — desliga o polo do mouse
 * - `uTime`            segundos; 0 sob `prefers-reduced-motion`
 * - `uExtent`          meia-largura/meia-altura do campo, em unidades de mundo
 * - `uFilingSize`      comprimento e espessura da limalha, em unidades de mundo
 * - `uSafeCenter`      centro da área reservada ao texto HTML, em NDC
 * - `uSafeHalf`        meia-extensão dessa área, em NDC
 * - `uSafeCenter2`     centro de uma segunda área reservada (opcional — ver
 *                       `uSafeHalf2`), em NDC
 * - `uSafeHalf2`        meia-extensão da segunda área; `(0,0)` a desliga
 * - `uSafeFeather`     largura da queda suave em volta das duas áreas, em NDC
 * - `uDirectToScreen`  1 = a cena vai direto para a tela e sai em sRGB
 */
export const fieldVertex: string = /* glsl */ `
precision highp float;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform vec2 uPointerRay;
uniform float uPointerActive;
uniform float uTime;
uniform vec2 uExtent;
uniform vec2 uFilingSize;
uniform vec2 uSafeCenter;
uniform vec2 uSafeHalf;
uniform vec2 uSafeCenter2;
uniform vec2 uSafeHalf2;
uniform float uSafeFeather;

in vec3 position;   // canto do quad unitário, x/y em [-0.5, 0.5]
in vec3 aOffset;    // centro da limalha em unidades de mundo (z jitterado)
in vec2 aParams;    // x = semente 0..1, y = variação de comprimento

out vec2 vLocal;    // coordenada dentro da cápsula, em unidades de meia-espessura
out float vHalfLen; // meia-extensão longitudinal, nas mesmas unidades
out vec3 vLook;     // x = calor, y = brilho, z = opacidade

${POINTER_RAY_GLSL}

/**
 * Polos em coordenadas normalizadas (y em [-1,1], x proporcional ao aspecto).
 * Três polos, sinais alternados: dois dariam um dipolo simétrico demais, quatro
 * viram sopa. Os pesos (1.0 / -0.85 / 0.5) deixam um polo claramente dominante,
 * o que produz uma linha de campo principal legível.
 */
const vec3 POLE_A = vec3(-0.55, 0.30, 1.0);
const vec3 POLE_B = vec3(0.42, -0.45, -0.85);
const vec3 POLE_C = vec3(0.62, 0.85, 0.5);

/** Raio² mínimo do polo. Sem piso o campo diverge e a direção vira NaN. */
const float POLE_MIN_RADIUS_SQ = 0.0025;

/** Deriva dos polos: 0.05 em ~15 s de período — respiração, não movimento. */
const float POLE_DRIFT = 0.05;
const float DRIFT_SPEED_X = 0.07;
const float DRIFT_SPEED_Y = 0.053;

/**
 * Grão sobre as linhas de campo. Frequência 5.5 dá ondulação com ~1/3 da altura
 * de período; amplitude 0.2 desvia a limalha em até ~11°, o suficiente para o
 * campo não parecer plotado por software.
 */
const float GRAIN_FREQUENCY = 5.5;
const float GRAIN_AMOUNT = 0.2;

/**
 * Ganho da "energia" do campo (raiz da magnitude). 0.62 satura em energia 1 a
 * ~2.6 de magnitude, que é a vizinhança imediata dos polos; longe deles a
 * energia cai para ~0.3 e a limalha fica curta e apagada, como no papel.
 */
const float ENERGY_GAIN = 0.62;
const float MIN_ENERGY_BRIGHTNESS = 0.26;
const float MIN_ENERGY_LENGTH = 0.55;
const float MAX_ENERGY_LENGTH = 1.15;

/**
 * Raio de influência do cursor, em unidades de tan(fov/2) * ndc. 0.18 com
 * tan(25°) = 0.466 cobre ~38% da meia-altura da tela: grande o bastante para o
 * gesto ser óbvio, pequeno o bastante para o campo base continuar sendo o tema.
 */
const float POINTER_RADIUS = 0.18;
/** Alongamento máximo sob o cursor: +55% sobre o comprimento base. */
const float POINTER_STRETCH = 0.55;

/** Luz rasante: a limalha alinhada a ela brilha, a transversal apaga. */
const vec2 LIGHT_DIR = vec2(0.94, 0.342);
const float SHEEN_FLOOR = 0.55;
const float SHEEN_EXPONENT = 1.5;

/** Variação de brilho por peça: metal real não tem duas lascas iguais. */
const float SEED_BRIGHTNESS_MIN = 0.7;
const float SEED_BRIGHTNESS_MAX = 1.15;

/**
 * Brilho da limalha dentro da área reservada ao texto.
 *
 * Escurece a **cor**, e não a opacidade — essa distinção foi medida: com
 * blending normal, n limalhas sobrepostas convergem para a cor da fonte
 * (dst = src + (dst-src)·(1-a)ⁿ), então baixar só o alpha apenas atrasa a
 * convergência. Atenuando a cor, o pixel mais claro possível passa a ser
 * STEEL (#8f98a6) × 1.15 de teto de brilho × este fator, por mais que as peças
 * se empilhem.
 *
 * Em 0.30 isso dá luminância relativa 0.035 e contraste 11:1 contra o texto
 * #f4f2ee, com folga sobre os 7:1 exigidos (a primeira versão, com 0.30 no
 * alpha, media 4.87:1 na tela). E como uSafeFeather é largo, lê como queda de
 * luz, não como buraco retangular no campo.
 */
const float SAFE_AREA_FLOOR = 0.30;
const float BASE_ALPHA = 0.9;

/** Profundidade mínima aceita antes da divisão do raio do cursor. */
const float MIN_DEPTH = 0.001;

vec2 poleField(vec2 p, vec2 center, float strength) {
  vec2 delta = p - center;
  float radiusSq = max(dot(delta, delta), POLE_MIN_RADIUS_SQ);
  return strength * delta / radiusSq;
}

/** Distância (com sinal) de 'ndc' à caixa arredondada 'center'±'half', em NDC. */
float safeBoxDistance(vec2 ndc, vec2 center, vec2 half_) {
  vec2 relative = abs(ndc - center) - half_;
  return length(max(relative, vec2(0.0))) + min(max(relative.x, relative.y), 0.0);
}

/**
 * Atenuação combinada das (até) duas áreas seguras. 'uSafeHalf2' em '(0,0)'
 * deixa a segunda caixa com meia-extensão nula — 'safeBoxDistance' então só
 * pode devolver um valor grande e positivo (a menos que 'uSafeCenter2' também
 * esteja em cima do pixel, caso degenerado que não ocorre: o centro nasce
 * fora da tela). O 'min' entre as duas atenuações escurece o pixel se ele
 * cair dentro de qualquer uma das duas regiões — é a mesma lógica de "a mais
 * protetora vence" que faria sentido com N áreas.
 */
float safeAreaAttenuation(vec2 ndc, float floorValue) {
  float d1 = safeBoxDistance(ndc, uSafeCenter, uSafeHalf);
  float d2 = safeBoxDistance(ndc, uSafeCenter2, uSafeHalf2);
  float a1 = mix(floorValue, 1.0, smoothstep(0.0, uSafeFeather, d1));
  float a2 = mix(floorValue, 1.0, smoothstep(0.0, uSafeFeather, d2));
  return min(a1, a2);
}

void main() {
  vec4 mv = modelViewMatrix * vec4(aOffset, 1.0);

  // Coordenadas normalizadas do campo: y em [-1,1], x proporcional ao aspecto.
  float aspect = uExtent.x / max(uExtent.y, MIN_DEPTH);
  vec2 field = aOffset.xy / max(uExtent.y, MIN_DEPTH);

  vec2 drift = vec2(sin(uTime * DRIFT_SPEED_X), cos(uTime * DRIFT_SPEED_Y)) * POLE_DRIFT;
  vec2 sum = poleField(field, vec2(POLE_A.x * aspect, POLE_A.y) + drift, POLE_A.z)
    + poleField(field, vec2(POLE_B.x * aspect, POLE_B.y) - drift, POLE_B.z)
    + poleField(field, vec2(POLE_C.x * aspect, POLE_C.y) + drift.yx, POLE_C.z);

  float magnitude = length(sum);
  vec2 direction = magnitude > 1e-5 ? sum / magnitude : vec2(1.0, 0.0);

  vec2 grain = vec2(
    sin(field.y * GRAIN_FREQUENCY + uTime * 0.13),
    sin(field.x * GRAIN_FREQUENCY - uTime * 0.11)
  );
  direction = normalize(direction + grain * GRAIN_AMOUNT);

  float energy = clamp(sqrt(magnitude) * ENERGY_GAIN, 0.0, 1.0);

  // --- cursor como raio (V.4) -------------------------------------------
  float depth = max(-mv.z, MIN_DEPTH);
  vec2 screenOffset = pointerOffset(mv.xyz, uPointerRay) / depth;
  float normalizedDistance = length(screenOffset) / POINTER_RADIUS;
  float pull = uPointerActive * exp(-normalizedDistance * normalizedDistance);

  vec2 radial = screenOffset / max(length(screenOffset), 1e-4);
  // A limalha não tem ponta: escolher o sentido mais próximo do campo evita que
  // a interpolação passe pelo vetor nulo e a peça gire 180° de repente.
  radial *= dot(radial, direction) < 0.0 ? -1.0 : 1.0;
  direction = normalize(mix(direction, radial, pull));

  // --- forma -------------------------------------------------------------
  float lengthScale = mix(MIN_ENERGY_LENGTH, MAX_ENERGY_LENGTH, energy)
    * aParams.y
    * (1.0 + pull * POINTER_STRETCH);
  float halfLength = uFilingSize.x * 0.5 * lengthScale;
  float halfThickness = max(uFilingSize.y * 0.5, MIN_DEPTH);

  vec3 along = vec3(direction, 0.0);
  vec3 across = vec3(-direction.y, direction.x, 0.0);
  vec3 world = aOffset + along * (position.x * 2.0 * halfLength) + across * (position.y * 2.0 * halfThickness);

  vec4 clipCenter = projectionMatrix * mv;
  vec2 ndc = clipCenter.xy / max(clipCenter.w, MIN_DEPTH);
  float attenuation = safeAreaAttenuation(ndc, SAFE_AREA_FLOOR);

  float sheen = mix(SHEEN_FLOOR, 1.0, pow(abs(dot(direction, LIGHT_DIR)), SHEEN_EXPONENT));
  float variation = mix(SEED_BRIGHTNESS_MIN, SEED_BRIGHTNESS_MAX, aParams.x);
  float brightness = mix(MIN_ENERGY_BRIGHTNESS, 1.0, energy) * sheen * variation;

  vLocal = vec2(position.x * 2.0 * halfLength / halfThickness, position.y * 2.0);
  vHalfLen = halfLength / halfThickness;
  vLook = vec3(pull, mix(brightness, 1.0, pull * 0.8) * attenuation, BASE_ALPHA);

  gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
}
`;

export const fieldFragment: string = /* glsl */ `
precision highp float;

in vec2 vLocal;
in float vHalfLen;
in vec3 vLook;
out vec4 outColor;

uniform float uDirectToScreen;

/** Aço frio e brasa. A limalha só esquenta onde o cursor a magnetiza. */
const vec3 STEEL = vec3(0.561, 0.596, 0.651); // #8f98a6
const vec3 EMBER = vec3(1.0, 0.478, 0.165);   // #ff7a2a

vec3 srgbToLinear(vec3 c) {
  vec3 v = max(c, vec3(0.0));
  return mix(
    pow((v + vec3(0.055)) / 1.055, vec3(2.4)),
    v / 12.92,
    vec3(lessThanEqual(v, vec3(0.04045)))
  );
}

void main() {
  // Cápsula: segmento de reta com pontas redondas, em unidades de meia-espessura.
  float axial = max(abs(vLocal.x) - max(vHalfLen - 1.0, 0.0), 0.0);
  float distance = length(vec2(axial, vLocal.y)) - 1.0;
  float width = max(fwidth(distance), 1e-4);
  float mask = 1.0 - smoothstep(-width, width, distance);
  if (mask <= 0.0) discard;

  vec3 color = mix(STEEL, EMBER, vLook.x) * vLook.y;
  outColor = vec4(uDirectToScreen > 0.5 ? color : srgbToLinear(color), mask * vLook.z);
}
`;

// ---------------------------------------------------------------------------
// Fundo
// ---------------------------------------------------------------------------

export const backdropVertex: string = FULLSCREEN_TRIANGLE_VERTEX;

/**
 * Chapa quase preta. Sem gradiente decorativo: só uma variação de ~2% para a
 * superfície não parecer um `#000` chapado, mais o calor do cursor.
 *
 * Uniforms: `uAspect`, `uPointerNdc`, `uPointerActive`, `uDirectToScreen`.
 */
export const backdropFragment: string = /* glsl */ `
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform float uAspect;
uniform vec2 uPointerNdc;
uniform float uPointerActive;
uniform float uDirectToScreen;

/** #08080a: mais escuro que o --bg dos tokens, para o texto ter folga de contraste. */
const vec3 PLATE = vec3(0.031, 0.031, 0.039);
/** Topo levemente mais frio; a diferença é de ~2%, só o bastante para ter matéria. */
const vec3 PLATE_TOP = vec3(0.047, 0.051, 0.063);
/** Brasa sob o cursor. 0.055 de pico mantém a luminância abaixo de 0.01. */
const vec3 HEAT = vec3(1.0, 0.478, 0.165);
const float HEAT_STRENGTH = 0.055;
/** Raio do calor em unidades de NDC — cobre ~45% da meia-altura da tela. */
const float HEAT_RADIUS = 0.45;

vec3 srgbToLinear(vec3 c) {
  vec3 v = max(c, vec3(0.0));
  return mix(
    pow((v + vec3(0.055)) / 1.055, vec3(2.4)),
    v / 12.92,
    vec3(lessThanEqual(v, vec3(0.04045)))
  );
}

void main() {
  vec3 color = mix(PLATE, PLATE_TOP, vUv.y);

  vec2 ndc = vUv * 2.0 - 1.0;
  vec2 delta = (ndc - uPointerNdc) * vec2(uAspect, 1.0) / HEAT_RADIUS;
  color += HEAT * (exp(-dot(delta, delta)) * HEAT_STRENGTH * uPointerActive);

  outColor = vec4(uDirectToScreen > 0.5 ? color : srgbToLinear(color), 1.0);
}
`;
