import '@/styles/tokens.css';
import '@/styles/base.css';
import '@/styles/typography.css';
import { createEngine } from '@/engine';
import { mountSection as mountRelevo } from '@/sections/relevo';
import type { Engine } from '@/engine';

/**
 * Página interna da seção F4 (não entra no build: só `index.html` é input do
 * Vite). Serve para ver o espécime entrar e sair da tela — é entrando que a
 * viagem de profundidade e o recorte por scissor aparecem.
 *
 *   pnpm dev  →  http://localhost:5173/dev/relevo.html
 *   ?stats=1  →  painel com fps, tier e amostras de ray march
 */

/** ~4 atualizações por segundo: legível sem forçar layout a cada quadro. */
const STATS_EVERY_N_FRAMES = 15;

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) throw new Error(`forja/dev: elemento ausente: ${selector}`);
  return element;
}

function styleSpacers(): void {
  for (const spacer of document.querySelectorAll<HTMLElement>('.dev-spacer')) {
    spacer.style.cssText = [
      'min-height:100dvh',
      'display:grid',
      'place-items:center',
      // Transparente de propósito: é assim que se vê o recorte da seção. O que
      // aparece aqui é o canvas *não* desenhado por ninguém — se o relevo
      // vazasse o clear para fora do próprio retângulo, este espaço viraria
      // carvão em vez de continuar preto.
      'background:transparent',
      'color:#efece5',
      'font:1rem/1.5 system-ui,sans-serif',
    ].join(';');
  }
}

function attachStats(engine: Engine): void {
  const panel = document.createElement('pre');
  panel.style.cssText = [
    'position:fixed',
    'right:1rem',
    'bottom:1rem',
    'z-index:10',
    'margin:0',
    'padding:0.6rem 0.8rem',
    'font:0.75rem/1.5 ui-monospace,monospace',
    'color:#b9b6b0',
    'background:#0b0b0de0',
    'border:1px solid #241a13',
    'white-space:pre',
  ].join(';');
  document.body.append(panel);

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
  styleSpacers();

  const canvas = requireElement<HTMLCanvasElement>('#gl');
  const relevo = requireElement<HTMLElement>('#relevo');

  const engine = createEngine(canvas);
  if (engine === null) {
    relevo.textContent = 'WebGL2 indisponível neste navegador.';
    return;
  }

  mountRelevo(relevo, engine);

  if (new URLSearchParams(window.location.search).get('stats') === '1') {
    attachStats(engine);
  }
}

boot();
