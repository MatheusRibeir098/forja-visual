import './style.css';
import { CATALOG_TITLE_ID, buildCatalog } from './markup';
import { createPlaneLayer } from './planes';
import type { PlaneLayer } from './planes';
import type { Engine } from '@/engine';

/**
 * F5 — O Catálogo: as 16 técnicas como um índice impresso, com um plano WebGL
 * sincronizado atrás de cada verbete (técnica I.2).
 *
 * A montagem é sempre a mesma ordem: DOM primeiro, WebGL depois. O shader
 * precisa de retângulos reais para se posicionar, e retângulo real só existe
 * depois que o conteúdo está no documento.
 */

export interface CatalogHandle {
  /**
   * A camada de planos. Existe no retorno para que a página de verificação
   * possa projetar cada mesh de volta para px de tela e comparar com o
   * `getBoundingClientRect()` do verbete — o aceite da seção é um número
   * medido, não uma impressão.
   */
  readonly planes: PlaneLayer;
  dispose(): void;
}

/**
 * Monta a seção e devolve o controle. Use quando alguém precisa desmontar ou
 * inspecionar; a página usa `mountSection`.
 */
export function mountCatalog(root: HTMLElement, engine: Engine): CatalogHandle {
  const markup = buildCatalog();
  root.classList.add('cat');
  root.setAttribute('aria-labelledby', CATALOG_TITLE_ID);
  // `replaceChildren`, e não `append`: o `index.html` traz um título de
  // rascunho dentro da seção, e mantê-lo daria dois `<h2>` com o mesmo papel.
  root.replaceChildren(...markup.nodes);

  const index = root.querySelector<HTMLElement>('.cat__index');
  if (index === null) throw new Error('catalogo: índice não montado');

  const planes = createPlaneLayer(engine, {
    hoverRoot: index,
    entries: markup.entries,
    colorSource: root,
  });

  const stopTick = engine.ticker.subscribe((dt) => planes.update(dt));

  /**
   * Sob `prefers-reduced-motion` o ticker está em `demand`: sem um pedido, o
   * quadro que pinta a faixa do índice nunca aconteceria e a seção ficaria com
   * o canvas do vizinho atrás do texto.
   */
  engine.ticker.invalidate();
  const stopResize = engine.gl.onResize(() => engine.ticker.invalidate());

  // As linhas mudam de altura quando a Instrument Sans substitui a fonte de
  // fallback. Em `always` o quadro seguinte já corrige; em `demand`, nada
  // pediria esse quadro e os planos ficariam com as caixas antigas.
  void document.fonts.ready.then(() => engine.ticker.invalidate());

  return {
    planes,

    dispose(): void {
      stopTick();
      stopResize();
      planes.dispose();
      root.replaceChildren();
      root.classList.remove('cat');
      root.removeAttribute('aria-labelledby');
    },
  };
}

/**
 * Contrato de seção do projeto. A seção vive enquanto a página viver, então o
 * controle é descartado de propósito — quem precisa desmontar chama
 * `mountCatalog`.
 */
export function mountSection(root: HTMLElement, engine: Engine): void {
  mountCatalog(root, engine);
}
