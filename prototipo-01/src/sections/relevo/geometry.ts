import type { Vec2 } from '@/engine';

/**
 * Geometria da seção "Relevo", em funções puras.
 *
 * Tudo aqui existe para que o quadro não precise **ler layout**. O retângulo da
 * seção na tela, a distância da câmera e o remapeamento do cursor são derivados
 * de três números que só mudam em resize (altura da seção, altura das faixas,
 * tamanho do canvas) mais o progresso do beat, que o `beats.ts` já mede no
 * único `getBoundingClientRect()` do quadro. Um `innerHeight` ou um `rect`
 * lido aqui, depois de outra seção ter escrito no DOM, seria reflow forçado —
 * exatamente o que o E2E procura no trace.
 *
 * Sem WebGL e sem three: é isto que deixa a conta testável em Node.
 */

/** Retângulo em px CSS, origem no canto superior esquerdo da viewport. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Menor lado aceito — 0 invalidaria o viewport e dividiria por zero no aspecto. */
export const MIN_SIZE_PX = 1;

/**
 * Topo da seção em relação ao topo da viewport, a partir do progresso do beat.
 *
 * Inverte a conta de `computeBeatProgress` para as âncoras `enter`/`exit`:
 * lá, `progress = (V − top) / (H + V)`. Nada é cravado — `H` vem do
 * `ResizeObserver` da própria seção e `V` do canvas, então um bloco inserido
 * acima não desalinha nada (é o teste do `document.body.prepend` da spec).
 */
export function sectionTopFromProgress(
  progress: number,
  sectionHeight: number,
  viewportHeight: number,
): number {
  return viewportHeight - progress * (sectionHeight + viewportHeight);
}

/**
 * Aproximação da chapa: 0 nas bordas da janela do beat, 1 com a seção centrada.
 *
 * Triângulo (`1 − |2p − 1|`) suavizado por Hermite. O triângulo cru chega ao
 * centro com quina — a chapa pararia de avançar de um quadro para o outro; o
 * smoothstep zera a derivada nas duas pontas e no topo.
 */
export function approachEase(progress: number): number {
  const centred = 1 - Math.abs(progress * 2 - 1);
  const clamped = centred < 0 ? 0 : centred;
  return clamped * clamped * (3 - 2 * clamped);
}

/**
 * Fração da altura da faixa que a chapa ocupa quando está no ponto mais perto.
 *
 * Encaixe "contain": manda quem apertar primeiro. Em paisagem manda a altura
 * (`heightFraction`), em retrato manda a largura — sem isto, uma chapa 16:9 a
 * 86% de 407 px de faixa mediria 622 px de largura numa tela de 375.
 */
export function plateCoverFraction(
  band: { width: number; height: number },
  plateAspect: number,
  heightFraction: number,
  widthFraction: number,
): number {
  const height = Math.max(band.height, MIN_SIZE_PX);
  const byWidth = (Math.max(band.width, MIN_SIZE_PX) * widthFraction) / plateAspect / height;
  return Math.min(heightFraction, byWidth);
}

/**
 * Distância da câmera que faz um plano de altura `planeWorldHeight` ocupar
 * `coverFraction` da altura do viewport.
 *
 * A altura visível a uma distância `d` é `2 · tan(fov/2) · d`; igualando à
 * altura do plano dividida pela fração e isolando `d`. É a conta que permite a
 * chapa **viajar em profundidade** sem que o enquadramento vire chute.
 */
export function cameraDistanceForCover(
  coverFraction: number,
  planeWorldHeight: number,
  tanHalfFov: number,
): number {
  const fraction = Math.max(coverFraction, Number.EPSILON);
  return planeWorldHeight / (2 * tanHalfFov * fraction);
}

/**
 * NDC do cursor (relativo à janela) convertido para o NDC do viewport da faixa.
 *
 * `pointer.setCamera` **não** serve aqui: ele é estado global do motor, e
 * chamá-lo faria esta seção brigar com o hero pelo mesmo raio. Cada seção que
 * desenha num pedaço do canvas resolve o seu próprio NDC.
 *
 * O resultado pode passar de ±1 de propósito: com o cursor sobre a faixa de
 * texto, ou fora da seção, a luz continua no lugar certo do raio — é o aceite
 * "cursor em qualquer canto da tela".
 */
export function ndcInsideRect(
  ndc: Readonly<Vec2>,
  viewportWidth: number,
  viewportHeight: number,
  rect: Rect,
  out: Vec2,
): Vec2 {
  const pointerX = ((ndc.x + 1) / 2) * viewportWidth;
  const pointerY = ((1 - ndc.y) / 2) * viewportHeight;
  out.x = ((pointerX - rect.x) / Math.max(rect.width, MIN_SIZE_PX)) * 2 - 1;
  out.y = 1 - ((pointerY - rect.y) / Math.max(rect.height, MIN_SIZE_PX)) * 2;
  return out;
}

/**
 * NDC → raio do cursor (V.4): a direção em view space já dividida pela
 * profundidade. Mesma conta de `createPointer`, aplicada ao viewport da faixa.
 */
export function rayFromNdc(
  ndcX: number,
  ndcY: number,
  aspect: number,
  tanHalfFov: number,
  out: Vec2,
): Vec2 {
  out.x = tanHalfFov * aspect * ndcX;
  out.y = tanHalfFov * ndcY;
  return out;
}

/**
 * Y de um retângulo CSS (origem em cima) no sistema do WebGL (origem embaixo),
 * que é o que `setViewport`/`setScissor` esperam.
 */
export function toGlBottom(topPx: number, heightPx: number, canvasHeightPx: number): number {
  return canvasHeightPx - (topPx + heightPx);
}
