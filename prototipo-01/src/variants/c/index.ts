import './style.css';
import { createInkLayer } from './ink';
import { HERO_TITLE_ID, buildHero } from './markup';
import type { InkLayer } from './ink';
import type { Engine } from '@/engine';

/**
 * Variante C do hero — "Revista técnica".
 *
 * Aposta: contra o reflexo dark-first, uma página **clara**, editorial e
 * assimétrica; e um WebGL que não faz cenário nem partícula, mas age *sobre o
 * texto*, como tinta que o papel ainda está absorvendo. O texto permanece HTML
 * do começo ao fim — o shader nunca desenha uma letra.
 */

export interface HeroHandle {
  /** Camada de tinta — a página de dev usa para verificar a sincronia DOM↔WebGL. */
  readonly ink: InkLayer;
  dispose(): void;
}

/**
 * Molda `root` como a página impressa e liga a camada de tinta ao motor.
 * `root` costuma ser o `<section id="hero">`; a função assume o conteúdo dele.
 */
export function mountHero(root: HTMLElement, engine: Engine): HeroHandle {
  const hero = buildHero();
  root.classList.add('hero-c');
  root.setAttribute('aria-labelledby', HERO_TITLE_ID);
  root.append(...hero.nodes);

  const ink = createInkLayer(engine, [
    { el: hero.title },
    // A tagline é um bloco menor e mais denso de texto: com a mesma dose de
    // absorção do título, ela fecharia e o olho leria mancha antes de ler frase.
    { el: hero.tagline, soakGain: 0.65 },
  ]);

  const stopTick = engine.ticker.subscribe((dt) => ink.update(dt));

  /**
   * Sob `prefers-reduced-motion` o ticker está em `demand`: sem um pedido, o
   * primeiro quadro — o que pinta o papel — nunca aconteceria e o canvas
   * ficaria preto atrás de uma página clara.
   */
  engine.ticker.invalidate();
  const stopResize = engine.gl.onResize(() => engine.ticker.invalidate());

  // O título muda de largura quando a Instrument Serif substitui a fonte de
  // fallback. Em `always` o próximo quadro já corrige; em `demand`, nada
  // pediria esse quadro e o plano ficaria com a caixa antiga.
  void document.fonts.ready.then(() => engine.ticker.invalidate());

  return {
    ink,

    dispose(): void {
      stopTick();
      stopResize();
      ink.dispose();
      for (const node of hero.nodes) node.remove();
      root.classList.remove('hero-c');
      root.removeAttribute('aria-labelledby');
    },
  };
}
