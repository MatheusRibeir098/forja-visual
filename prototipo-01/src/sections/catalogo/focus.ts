import type { DomRectLike, ViewportSize } from '@/engine';

/**
 * Matemática pura da seção F5 — sem DOM, sem three, sem WebGL.
 *
 * Está separada porque é exatamente a parte que erra em silêncio: um sinal
 * trocado no eixo Y do scissor desloca a banda de tinta meia tela e ninguém
 * consegue provar o contrário olhando um print. Aqui dá para testar.
 */

/** Faixa vertical da tela, em px de CSS, nos eixos de `getBoundingClientRect()`. */
export interface Band {
  top: number;
  bottom: number;
}

/** Retângulo de scissor do WebGL: origem no canto **inferior** esquerdo. */
export interface Scissor {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Converte o progresso de travessia da ficha (0 = entrando por baixo, 1 = saindo
 * por cima) na **atenção de leitura**: 1 no meio da tela, 0 nas duas bordas.
 *
 * É o que dá à seção uma cabeça de leitura descendo pelo índice conforme se
 * rola, em vez de tinta acumulando monotonicamente até o rodapé. A curva é
 * suavizada com o mesmo `smoothstep` do GLSL para não haver um bico no pico —
 * um bico se lê como um piscar quando a ficha cruza o centro.
 */
export function readingFocus(progress: number): number {
  const triangle = 1 - Math.abs(2 * clamp01(progress) - 1);
  return triangle * triangle * (3 - 2 * triangle);
}

/**
 * Menor faixa que cobre todos os retângulos visíveis. É a única região do canvas
 * que a seção tem direito de escrever: fora dela ficam o hero e o relevo, que
 * desenham no mesmo canvas.
 *
 * `null` quando não há nada visível — o caso comum, já que 6 das 7 seções estão
 * fora da tela na maior parte do scroll, e aí a seção não desenha nada.
 */
export function unionBand(rects: Iterable<DomRectLike>): Band | null {
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const rect of rects) {
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (rect.top < top) top = rect.top;
    if (rect.top + rect.height > bottom) bottom = rect.top + rect.height;
  }
  if (top > bottom) return null;
  return { top, bottom };
}

/**
 * Faixa de tela → retângulo de scissor, recortado no viewport.
 *
 * Dois detalhes que só aparecem quando erram: o eixo Y do WebGL cresce para
 * cima, então `y` é medido a partir do fundo; e a faixa precisa ser cortada
 * *antes* da conversão, senão uma ficha acima do topo produz altura maior que a
 * tela e o scissor cobre vizinho que não é nosso.
 *
 * `null` quando a faixa não intersecta o viewport.
 */
export function bandToScissor(band: Band, viewport: ViewportSize): Scissor | null {
  const top = Math.max(0, Math.floor(band.top));
  const bottom = Math.min(viewport.height, Math.ceil(band.bottom));
  const height = bottom - top;
  if (height <= 0 || viewport.width <= 0) return null;
  return { x: 0, y: viewport.height - bottom, width: viewport.width, height };
}

/** Teto da escala do catálogo: ⭐ a ⭐⭐⭐. */
export const RATING_MAX = 3;

/**
 * Estrelas do verbete como texto: sempre três posições, para a coluna alinhar
 * mesmo com fonte proporcional. O rótulo legível fica separado, no markup — um
 * leitor de tela não deve soletrar glifos de desenho.
 */
export function formatRating(stars: number, full: string, empty: string): string {
  const filled = Math.max(0, Math.min(RATING_MAX, Math.round(stars)));
  return full.repeat(filled) + empty.repeat(RATING_MAX - filled);
}
