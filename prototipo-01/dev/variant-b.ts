import '@/styles/tokens.css';
import '@/styles/base.css';
import '@/styles/typography.css';
import { createEngine } from '@/engine';
import { mountHero } from '@/variants/b';
import type { Engine } from '@/engine';

/**
 * Página interna da variante B (não entra no build: só `index.html` é input do
 * Vite). Serve para olhar a chapa em tela cheia, mover o cursor e medir.
 *
 *   pnpm dev  →  http://localhost:5173/dev/variant-b.html
 *   ?stats=1  →  painel com fps, tier e renderer (fica fora dos screenshots)
 */

/** ~4 atualizações por segundo: legível sem forçar layout a cada quadro. */
const STATS_EVERY_N_FRAMES = 15;

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) throw new Error(`forja/dev: elemento ausente: ${selector}`);
  return element;
}

function createStatsPanel(): HTMLPreElement {
  const panel = document.createElement('pre');
  panel.id = 'stats';
  panel.textContent = 'iniciando…';
  panel.style.cssText = [
    'position:fixed',
    'right:1rem',
    'bottom:1rem',
    'z-index:10',
    'margin:0',
    'padding:0.6rem 0.8rem',
    'font:0.75rem/1.5 ui-monospace,monospace',
    'color:#b9b6b0',
    'background:#08080ae0',
    'border:1px solid #241a13',
    'white-space:pre',
  ].join(';');
  document.body.append(panel);
  return panel;
}

function attachStats(engine: Engine): void {
  const panel = createStatsPanel();
  const { gl, ticker } = engine;
  let frame = 0;

  ticker.subscribe(() => {
    frame += 1;
    if (frame % STATS_EVERY_N_FRAMES !== 0) return;
    panel.textContent = [
      `fps      ${ticker.fps.toFixed(1)}`,
      `tier     ${gl.tier} (dpr ${gl.size.dpr}, marcha ${gl.settings.rayMarchSamples})`,
      `viewport ${gl.size.w}×${gl.size.h}`,
      `renderer ${gl.rendererName}`,
    ].join('\n');
  });
}

function boot(): void {
  const canvas = requireElement<HTMLCanvasElement>('#gl');
  const hero = requireElement<HTMLElement>('#hero');

  const engine = createEngine(canvas);
  if (engine === null) {
    hero.textContent = 'WebGL2 indisponível neste navegador.';
    return;
  }

  mountHero(hero, engine);

  if (new URLSearchParams(window.location.search).get('stats') === '1') {
    attachStats(engine);
  }
}

boot();
