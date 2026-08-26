/**
 * MOLDE de `dev/<nome>.ts` — monta **uma** seção isolada, em `/dev/<nome>.html`.
 *
 * Por que uma página por seção: inspecionar uma técnica sozinha é o que torna o
 * diagnóstico barato. No protótipo 01, `/dev/catalogo.html?check=1` resolveu um
 * bug de alinhamento que a página inteira escondia — com o site todo em volta,
 * o sintoma se confundia com o da seção vizinha.
 *
 * A ordem de inscrição no ticker é a mesma de `src/main.ts`, e não é detalhe:
 * `beginFrame()` primeiro (liga e limpa o FBO de página antes de qualquer
 * cena), a seção no meio, `present()` por último — é o único ponto que escreve
 * no backbuffer. O `Set` do ticker itera na ordem de inserção.
 *
 * Estas páginas ficam **fora do build** (não são entry points), mas entram no
 * `typecheck` e no `lint`: `tsconfig.json` inclui `dev`.
 */
import '@/styles/tokens.css';
import '@/styles/base.css';

import { createEngine } from '@/engine';
import { mountSection } from '@/sections/exemplo';

const SECTION_ID = 'exemplo';

function boot(): void {
  const canvas = document.getElementById('gl');
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error(`dev/${SECTION_ID}: <canvas id="gl"> não encontrado`);
  }

  const root = document.getElementById(SECTION_ID);
  if (!(root instanceof HTMLElement)) {
    throw new Error(`dev/${SECTION_ID}: <section id="${SECTION_ID}"> não encontrado`);
  }

  const engine = createEngine(canvas);
  if (engine === null) {
    // Sem WebGL2 não há cena — e não precisa haver para inspecionar markup,
    // tipografia e contraste. O que falta é só o fundo desenhado.
    document.documentElement.dataset['gl'] = 'off';
    root.style.background = 'var(--bg)';
    return;
  }

  const { tier, reducedMotion, frame } = engine.gl;
  document.documentElement.dataset['tier'] = tier;
  document.documentElement.dataset['motion'] = reducedMotion ? 'reduced' : 'full';

  engine.ticker.subscribe(() => frame.beginFrame());
  mountSection(root, engine);
  engine.ticker.subscribe((_dt, elapsed) => frame.present(elapsed, !reducedMotion));
}

boot();
