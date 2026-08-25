import '@/styles/tokens.css';
import '@/styles/base.css';
import '@/styles/typography.css';
import { createEngine } from '@/engine';
import { mountSection as mountHero } from '@/sections/hero';
import { mountSection as mountTese } from '@/sections/tese';

/**
 * Página interna com a F1 e a F2 na ordem do site (não entra no build: só
 * `index.html` é input do Vite). É aqui que a troca de tela entre as duas
 * aparece: o hero desenha até o rodapé dele passar do topo, e a tese assume
 * exatamente no mesmo quadro, na mesma cena.
 *
 *   ?stats=1  mostra fps/tier/progresso no canto
 */

const STATS_EVERY_N_FRAMES = 15; // ~4 atualizações/s: legível sem thrash de layout

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) throw new Error(`forja/dev: elemento ausente: ${selector}`);
  return element;
}

function boot(): void {
  const canvas = requireElement<HTMLCanvasElement>('#gl');
  const hero = requireElement<HTMLElement>('#hero');
  const tese = requireElement<HTMLElement>('#tese');
  const stats = requireElement<HTMLElement>('#stats');

  const engine = createEngine(canvas);
  if (engine === null) {
    hero.textContent = 'WebGL2 indisponível neste navegador.';
    return;
  }

  // A ordem importa: o ticker roda os callbacks na ordem de inscrição, e no
  // quadro em que as duas seções trocam de dona, a de baixo é quem desenha.
  mountHero(hero, engine);
  mountTese(tese, engine);

  const params = new URLSearchParams(window.location.search);
  const wantsStats = params.get('stats') === '1';
  if (wantsStats) stats.hidden = false;

  let frameIndex = 0;
  engine.ticker.subscribe(() => {
    frameIndex += 1;
    if (!wantsStats || frameIndex % STATS_EVERY_N_FRAMES !== 0) return;
    stats.textContent = [
      `fps      ${engine.ticker.fps.toFixed(1)}`,
      `tier     ${engine.gl.tier} (dpr ${engine.gl.size.dpr}, fbo ${engine.gl.settings.fboScale})`,
      `viewport ${engine.gl.size.w}×${engine.gl.size.h}`,
      `máscara  ${engine.composite.progress.toFixed(3)}`,
      `renderer ${engine.gl.rendererName}`,
    ].join('\n');
  });
}

boot();
