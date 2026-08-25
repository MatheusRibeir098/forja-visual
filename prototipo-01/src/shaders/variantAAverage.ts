import { FULLSCREEN_TRIANGLE_VERTEX } from '@/shaders/glsl';

/**
 * Cena A da variante A: **a média**.
 *
 * Uma caricatura do hero que todo gerador de site produz — gradiente
 * roxo→azul com blobs aurora, nav centrada, badge "novo", headline centralizada
 * em duas linhas, dois botões (um cheio, um outline) e três cards de vidro.
 * Nada aqui é texto: são SDFs de retângulo arredondado, do jeito que um
 * wireframe representa texto. A intenção é que o visitante *reconheça* o padrão
 * em meio segundo, antes de a máscara destruí-lo.
 *
 * Um único fullscreen triangle: a caricatura inteira é ~30 SDFs num fragment,
 * o que custa menos que instanciar 30 meshes e é resolução-independente.
 */

export const vertex: string = FULLSCREEN_TRIANGLE_VERTEX;

/**
 * Uniforms:
 * - `uAspect`         largura/altura da viewport
 * - `uDirectToScreen` 1 quando o composite desenha esta cena direto na tela
 *   (progress 0) e o resultado precisa sair já codificado em sRGB; 0 quando vai
 *   para o render target linear do composite, que faz o encode no quad final.
 *   `RawShaderMaterial` não recebe o chunk de color space do three, então sem
 *   este switch a cena mudaria de cor no primeiro quadro da transição.
 * - `uSafeCenter`, `uSafeHalf`, `uSafeCenter2`, `uSafeHalf2`, `uSafeFeather`
 *   mesmas (até duas) áreas reservadas ao texto HTML que o campo
 *   (`@/shaders/variantAField`) recebe — ver `paintSafeArea`. `uSafeHalf2` em
 *   `(0,0)` desliga a segunda região.
 * - `uProgress`       progresso 0–1 da varredura (o mesmo que o composite usa
 *   para o threshold). Só governa a *força* da proteção, não a posição: em
 *   `uProgress` 0 a média precisa continuar intacta (é o beat em que o
 *   visitante reconhece o padrão), então a proteção nasce zerada e sobe antes
 *   da primeira janela de revelação de texto abrir (ver `SAFE_RAMP_END`).
 */
export const fragment: string = /* glsl */ `
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform float uAspect;
uniform float uDirectToScreen;
uniform vec2 uSafeCenter;
uniform vec2 uSafeHalf;
uniform vec2 uSafeCenter2;
uniform vec2 uSafeHalf2;
uniform float uSafeFeather;
uniform float uProgress;

// ---------------------------------------------------------------------------
// Paleta da média. Não é escolha de gosto: são as famílias violet-600,
// blue-600, fuchsia-500 e cyan-400 do Tailwind — literalmente a paleta que um
// modelo de linguagem prevê quando pedem "hero moderno". Autorada em sRGB
// porque a caricatura imita uma página web, e páginas compõem cor em sRGB.
// ---------------------------------------------------------------------------
const vec3 GRADIENT_START = vec3(0.427, 0.247, 0.961); // #6d3ff5
const vec3 GRADIENT_END = vec3(0.145, 0.388, 0.922);   // #2563eb
const vec3 BLOB_WARM = vec3(0.851, 0.275, 0.937);      // #d946ef
const vec3 BLOB_COOL = vec3(0.133, 0.827, 0.933);      // #22d3ee
const vec3 SURFACE = vec3(1.0);                        // superfícies e "texto": branco
const vec3 ON_SURFACE = vec3(0.169, 0.086, 0.412);     // #2c166a — rótulo dentro do botão cheio

// Peso dos blobs sobre o gradiente. 0.5/0.42: forte o bastante para o "aurora"
// aparecer, fraco o bastante para o gradiente base continuar legível.
const float BLOB_WARM_WEIGHT = 0.5;
const float BLOB_COOL_WEIGHT = 0.42;
// Concentração gaussiana dos blobs. 5.0 dá raio visível ~0.45 de altura de
// viewport, que é a proporção que os geradores usam (blur-3xl sobre w-96).
const float BLOB_FALLOFF = 5.0;
// Cruzados em relação ao gradiente base (roxo em cima-esquerda, azul embaixo-
// direita): o blob fúcsia cai sobre o azul e o ciano sobre o roxo, que é o que
// faz a "aurora" aparecer. Alinhados com o gradiente eles somem dentro dele.
const vec2 BLOB_WARM_CENTER = vec2(0.46, -0.30);
const vec2 BLOB_COOL_CENTER = vec2(-0.44, 0.32);

// ---------------------------------------------------------------------------
// Layout da caricatura, em unidades de *altura de viewport*, origem no centro,
// Y crescendo para baixo. Height-units e não pixels: as proporções do hero
// genérico precisam sobreviver a qualquer viewport.
//
// CONTENT_ASPECT é o aspecto abaixo do qual o container de 0.97 h de largura
// não caberia; abaixo dele o conjunto encolhe. O piso de 0.55 impede que em
// 375x667 a caricatura vire uma miniatura ilegível (0.485 * 0.55 = 0.267 de
// meia-largura, ainda dentro dos 0.281 disponíveis nesse aspecto).
// ---------------------------------------------------------------------------
const float CONTENT_ASPECT = 1.15;
const float MIN_CONTENT_SCALE = 0.55;
const float CONTAINER_HALF = 0.485;

// Nav: fica no espaço de página (não escala), porque barra de navegação gruda
// no topo da viewport mesmo quando o conteúdo encolhe.
const float NAV_Y = -0.438;
const float NAV_SIDE_MARGIN = 0.03;

const vec2 BADGE_CENTER = vec2(0.0, -0.335);
const vec2 BADGE_HALF = vec2(0.082, 0.023);

const vec2 HEADLINE_A_CENTER = vec2(0.0, -0.238);
const vec2 HEADLINE_A_HALF = vec2(0.300, 0.040);
const vec2 HEADLINE_B_CENTER = vec2(0.0, -0.150);
const vec2 HEADLINE_B_HALF = vec2(0.195, 0.040);
// 0.010 de raio numa barra de 0.080 de altura: o arredondamento discreto que
// separa "barra de wireframe" de "retângulo cru".
const float HEADLINE_RADIUS = 0.010;

const vec2 SUB_A_CENTER = vec2(0.0, -0.075);
const vec2 SUB_A_HALF = vec2(0.225, 0.0115);
const vec2 SUB_B_CENTER = vec2(0.0, -0.038);
const vec2 SUB_B_HALF = vec2(0.150, 0.0115);

const float BUTTON_Y = 0.048;
const float BUTTON_OFFSET_X = 0.098;
const vec2 BUTTON_HALF = vec2(0.088, 0.031);
const vec2 BUTTON_LABEL_HALF = vec2(0.045, 0.006);

const float CARD_Y = 0.265;
const vec2 CARD_HALF = vec2(0.152, 0.112);
const float CARD_RADIUS = 0.026;
// 0.318 de passo com 0.304 de largura deixa 0.014 de gap — o "gap-4" do grid
// de três cards, que é a assinatura mais reconhecível do gênero.
const float CARD_STRIDE = 0.318;
const float CARD_PADDING = 0.030;
const float CARD_ICON_RADIUS = 0.026;

// Transparências do vidro fosco. 0.10 de preenchimento com 0.22 de borda é a
// receita padrão (bg-white/10 + border-white/20) do glassmorphism.
const float GLASS_FILL = 0.10;
const float GLASS_BORDER = 0.22;

// Largura mínima de traço, em height-units. 0.0016 ≈ 1.2 px em 720 de altura:
// abaixo disso a borda some por subamostragem em telas de dpr 1.
const float MIN_STROKE = 0.0016;

// ---------------------------------------------------------------------------
// Área segura do texto (lição de 'variantAField': escurece a **cor**, nunca o
// alfa — esta cena não tem alfa para abusar mesmo, é sempre opaca, mas a razão
// é a mesma: se o threshold ainda não virou para o campo neste pixel, é esta
// camada que precisa estar escura por conta própria).
// ---------------------------------------------------------------------------

/**
 * Piso multiplicativo dentro da área segura. Mais baixo que o do campo (0.30)
 * porque a base daqui é um gradiente saturado (luminância alta), não aço cinza
 * — precisa de mais atenuação para chegar ao mesmo teto de luminância. Medido
 * contra o pior caso plausível (um retângulo branco do wireframe, luminância 1,
 * sob o piso): ~0.008 de luminância relativa, 8:1 contra '--fg' (#a7adb6, o
 * texto mais escuro do hero), com folga sobre os 7:1 exigidos.
 */
const float SAFE_AREA_FLOOR = 0.07;

/** Mesma chapa quase preta do fundo do campo ('variantAField.backdropFragment'
 * — não pode importar a constante entre dois módulos GLSL-em-string, então é
 * repetida; qualquer mudança lá precisa vir para cá). Usar o mesmo tom faz o
 * patch escurecido ler como "a chapa real aparecendo cedo", não como mancha
 * arbitrária. */
const vec3 SAFE_AREA_PLATE = vec3(0.031, 0.031, 0.039);

/**
 * Progresso em que a proteção atinge força total. Precisa ser bem menor que
 * 0.39 (progresso bruto equivalente à primeira janela de revelação de texto,
 * 'REVEAL_WINDOWS.index' em 'hero/index.ts', curva 0.22) — mas o hold em
 * 'uProgress' 0 já é a garantia real de que a média nasce intacta (o clamp de
 * 'progress' em 'hero/index.ts' mantém 0 exato durante os 0.6 s do hold, então
 * nenhum valor de rampa aqui muda esse beat). Uma rampa quase instantânea
 * evita a janela em que o piso ainda está subindo e o retângulo aparece só
 * parcialmente escurecido — foi nela que a medição pegou o pior caso.
 */
const float SAFE_RAMP_END = 0.03;

/** Distância (com sinal) de 'ndc' à caixa arredondada 'center'±'half', em NDC. */
float safeBoxDistance(vec2 ndc, vec2 center, vec2 half_) {
  vec2 relative = abs(ndc - center) - half_;
  return length(max(relative, vec2(0.0))) + min(max(relative.x, relative.y), 0.0);
}

/**
 * Escurece 'col' dentro dos (até duas) retângulos reservados a texto HTML. Usa
 * a mesma métrica de "distância a uma caixa arredondada" do campo (soma da
 * distância externa com a distância interna clampada), só que em NDC de tela
 * cheia em vez de espaço de mundo. 'min' entre as duas atenuações espaciais
 * escurece o pixel se ele cair dentro de qualquer uma das regiões — a segunda
 * nasce com 'uSafeHalf2' em '(0,0)' (nunca aciona) quando ninguém a define.
 */
vec3 paintSafeArea(vec3 col, vec2 uv, float progress) {
  vec2 ndc = uv * 2.0 - 1.0;
  float d1 = safeBoxDistance(ndc, uSafeCenter, uSafeHalf);
  float d2 = safeBoxDistance(ndc, uSafeCenter2, uSafeHalf2);
  float spatial1 = mix(SAFE_AREA_FLOOR, 1.0, smoothstep(0.0, uSafeFeather, d1));
  float spatial2 = mix(SAFE_AREA_FLOOR, 1.0, smoothstep(0.0, uSafeFeather, d2));
  float spatial = min(spatial1, spatial2);
  float strength = smoothstep(0.0, SAFE_RAMP_END, progress);
  float attenuation = mix(1.0, spatial, strength);
  return mix(SAFE_AREA_PLATE, col, attenuation);
}

// ---------------------------------------------------------------------------

float sdRoundedBox(vec2 p, vec2 halfSize, float radius) {
  vec2 q = abs(p) - halfSize + radius;
  return min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0))) - radius;
}

/** Cobertura antialiasada: px é meia largura de pixel nas unidades do SDF. */
float coverage(float d, float px) {
  return 1.0 - smoothstep(-px, px, d);
}

void paint(inout vec3 col, float d, vec3 tint, float alpha, float px) {
  col = mix(col, tint, coverage(d, px) * alpha);
}

void stroke(inout vec3 col, float d, vec3 tint, float alpha, float width, float px) {
  paint(col, abs(d) - width, tint, alpha, px);
}

/** Pílula: retângulo cujo raio é a própria meia-altura. */
float sdPill(vec2 p, vec2 halfSize) {
  return sdRoundedBox(p, halfSize, halfSize.y);
}

/**
 * O "✨" do badge, desenhado como duas barras cruzadas de pontas arredondadas.
 * Em ~10 px na tela isso lê como faísca e custa dois SDFs — uma estrela de
 * quatro pontas de verdade custaria pow() fracionário por pixel.
 */
float sdSparkle(vec2 p, float arm, float thickness) {
  float horizontal = sdRoundedBox(p, vec2(arm, thickness), thickness);
  float vertical = sdRoundedBox(p, vec2(thickness, arm), thickness);
  return min(horizontal, vertical);
}

vec3 srgbToLinear(vec3 c) {
  vec3 v = max(c, vec3(0.0));
  return mix(
    pow((v + vec3(0.055)) / 1.055, vec3(2.4)),
    v / 12.92,
    vec3(lessThanEqual(v, vec3(0.04045)))
  );
}

void drawNav(inout vec3 col, vec2 page, float px) {
  float halfW = min(uAspect * 0.5 - NAV_SIDE_MARGIN, CONTAINER_HALF);
  vec2 p = page - vec2(0.0, NAV_Y);

  // Marca: bolinha + palavra.
  paint(col, length(p - vec2(-halfW + 0.012, 0.0)) - 0.012, SURFACE, 0.9, px);
  paint(col, sdPill(p - vec2(-halfW + 0.068, 0.0), vec2(0.034, 0.007)), SURFACE, 0.78, px);

  // Três links centrados — nunca dois, nunca quatro.
  for (int i = 0; i < 3; i++) {
    float x = (float(i) - 1.0) * 0.058;
    paint(col, sdPill(p - vec2(x, 0.0), vec2(0.024, 0.006)), SURFACE, 0.55, px);
  }

  // CTA no canto direito, sempre.
  vec2 ctaCenter = vec2(halfW - 0.048, 0.0);
  paint(col, sdPill(p - ctaCenter, vec2(0.048, 0.017)), SURFACE, 0.92, px);
  paint(col, sdPill(p - ctaCenter, vec2(0.026, 0.005)), ON_SURFACE, 0.85, px);
}

void drawCard(inout vec3 col, vec2 q, float centerX, float px) {
  vec2 p = q - vec2(centerX, CARD_Y);
  float card = sdRoundedBox(p, CARD_HALF, CARD_RADIUS);
  paint(col, card, SURFACE, GLASS_FILL, px);
  stroke(col, card, SURFACE, GLASS_BORDER, max(MIN_STROKE, px), px);

  float left = -CARD_HALF.x + CARD_PADDING;
  float top = -CARD_HALF.y + CARD_PADDING;

  // Círculo de ícone: o gerador nunca entrega um card sem ele.
  paint(
    col,
    length(p - vec2(left + CARD_ICON_RADIUS, top + CARD_ICON_RADIUS)) - CARD_ICON_RADIUS,
    SURFACE,
    0.30,
    px
  );

  // Título do card e duas linhas de corpo, alinhados à esquerda.
  paint(col, sdPill(p - vec2(left + 0.075, 0.012), vec2(0.075, 0.0085)), SURFACE, 0.62, px);
  paint(col, sdPill(p - vec2(left + 0.105, 0.049), vec2(0.105, 0.007)), SURFACE, 0.34, px);
  paint(col, sdPill(p - vec2(left + 0.078, 0.077), vec2(0.078, 0.007)), SURFACE, 0.34, px);
}

void main() {
  // Espaço de página: origem no centro, Y para baixo, 1 unidade = altura da tela.
  vec2 page = vec2((vUv.x - 0.5) * uAspect, 0.5 - vUv.y);
  vec2 normalized = vec2(page.x / uAspect, page.y);

  vec3 col = mix(GRADIENT_START, GRADIENT_END, clamp(normalized.x + normalized.y + 0.5, 0.0, 1.0));

  vec2 warm = page - BLOB_WARM_CENTER;
  vec2 cool = page - BLOB_COOL_CENTER;
  col = mix(col, BLOB_WARM, exp(-dot(warm, warm) * BLOB_FALLOFF) * BLOB_WARM_WEIGHT);
  col = mix(col, BLOB_COOL, exp(-dot(cool, cool) * BLOB_FALLOFF) * BLOB_COOL_WEIGHT);

  float scale = clamp(uAspect / CONTENT_ASPECT, MIN_CONTENT_SCALE, 1.0);
  vec2 q = page / scale;

  // page é linear em vUv, então uma derivada descreve o pixel em toda a tela.
  float pagePx = fwidth(page.x) * 0.75;
  float px = pagePx / scale;

  drawNav(col, page, pagePx);

  float badge = sdPill(q - BADGE_CENTER, BADGE_HALF);
  paint(col, badge, SURFACE, 0.16, px);
  stroke(col, badge, SURFACE, 0.34, max(MIN_STROKE, px), px);
  paint(col, sdSparkle(q - BADGE_CENTER - vec2(-0.056, 0.0), 0.013, 0.0045), SURFACE, 0.95, px);
  paint(col, sdPill(q - BADGE_CENTER - vec2(0.014, 0.0), vec2(0.038, 0.006)), SURFACE, 0.8, px);

  paint(col, sdRoundedBox(q - HEADLINE_A_CENTER, HEADLINE_A_HALF, HEADLINE_RADIUS), SURFACE, 0.95, px);
  paint(col, sdRoundedBox(q - HEADLINE_B_CENTER, HEADLINE_B_HALF, HEADLINE_RADIUS), SURFACE, 0.95, px);

  paint(col, sdPill(q - SUB_A_CENTER, SUB_A_HALF), SURFACE, 0.6, px);
  paint(col, sdPill(q - SUB_B_CENTER, SUB_B_HALF), SURFACE, 0.6, px);

  vec2 filled = q - vec2(-BUTTON_OFFSET_X, BUTTON_Y);
  paint(col, sdPill(filled, BUTTON_HALF), SURFACE, 1.0, px);
  paint(col, sdPill(filled, BUTTON_LABEL_HALF), ON_SURFACE, 0.9, px);

  vec2 outlined = q - vec2(BUTTON_OFFSET_X, BUTTON_Y);
  stroke(col, sdPill(outlined, BUTTON_HALF), SURFACE, 0.6, max(MIN_STROKE, px), px);
  paint(col, sdPill(outlined, BUTTON_LABEL_HALF), SURFACE, 0.85, px);

  for (int i = 0; i < 3; i++) {
    drawCard(col, q, (float(i) - 1.0) * CARD_STRIDE, px);
  }

  col = paintSafeArea(col, vUv, uProgress);

  outColor = vec4(uDirectToScreen > 0.5 ? col : srgbToLinear(col), 1.0);
}
`;
