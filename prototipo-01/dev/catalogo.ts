import '@/styles/tokens.css';
import '@/styles/base.css';
import '@/styles/typography.css';
import { createEngine, projectMeshToScreen, screenRectDelta } from '@/engine';
import { mountCatalog } from '@/sections/catalogo';
import type { TrackedPlane } from '@/sections/catalogo/planes';
import type { Engine, ScreenRect } from '@/engine';
import type { PerspectiveCamera } from 'three';

/**
 * Página interna do catálogo (não entra no build: só `index.html` é input do
 * Vite). Serve para duas coisas:
 *
 * - olhar a seção sobre uma página com scroll de verdade, antes de `main.ts`
 *   existir;
 * - `?check=1`: provar que os 16 planos **não descolam** dos verbetes em
 *   nenhuma velocidade de scroll — o aceite medido da F5.
 *
 * `?hud=1` mostra fps, viewport e tier num canto.
 */

/** Tolerância do aceite: 1 px entre o retângulo do DOM e a projeção do mesh. */
const MAX_DELTA_PX = 1;

/**
 * Passo do scroll na varredura, em px. 137 é primo e não é múltiplo de nenhuma
 * altura de linha do índice: garante posições fracionárias, onde erro de
 * arredondamento apareceria.
 */
const SCROLL_STEP_PX = 137;

/** Quadros da varredura — cobre o índice inteiro atravessando a tela. */
const SWEEP_FRAMES = 40;

/** Atualizações do HUD por segundo ≈ 4, para o texto ser legível. */
const HUD_EVERY_N_FRAMES = 15;

interface SyncCheck {
  maxDeltaPx: number;
  samples: number;
  /** Onde o pior desvio aconteceu, para o erro não ser um número solto. */
  worst: string;
  passed: boolean;
}

interface CatalogDebug {
  readonly fps: number;
  check?: SyncCheck;
}

declare global {
  interface Window {
    __forjaCatalogo?: CatalogDebug;
  }
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) throw new Error(`forja/dev: elemento ausente: ${selector}`);
  return element;
}

/** Reusados por quadro: a verificação roda dentro do loop e não deve alocar. */
const projected: ScreenRect = { left: 0, top: 0, right: 0, bottom: 0 };
const domRect: ScreenRect = { left: 0, top: 0, right: 0, bottom: 0 };

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/**
 * Mede o desvio de todos os planos visíveis no quadro corrente. Roda depois do
 * callback do ticker (o rAF desta função é agendado sempre após o dele), então
 * o que se compara é exatamente o que foi desenhado.
 */
function measureFrame(
  planes: readonly TrackedPlane[],
  camera: PerspectiveCamera,
  engine: Engine,
  label: string,
  result: SyncCheck,
): void {
  camera.updateMatrixWorld();
  const viewport = { width: engine.gl.size.w, height: engine.gl.size.h };

  for (const plane of planes) {
    if (!plane.mesh.visible) continue;
    const rect = plane.el.getBoundingClientRect();
    domRect.left = rect.left;
    domRect.top = rect.top;
    domRect.right = rect.right;
    domRect.bottom = rect.bottom;

    projectMeshToScreen(plane.mesh, camera, viewport, projected);
    const delta = screenRectDelta(domRect, projected);
    result.samples += 1;
    if (delta > result.maxDeltaPx) {
      result.maxDeltaPx = delta;
      result.worst = `${label} · ${plane.el.textContent?.slice(0, 24) ?? '?'}`;
    }
  }
}

async function runSyncCheck(
  engine: Engine,
  planes: readonly TrackedPlane[],
  camera: PerspectiveCamera,
): Promise<SyncCheck> {
  const result: SyncCheck = { maxDeltaPx: 0, samples: 0, worst: 'nenhum', passed: false };

  for (let frame = 0; frame < SWEEP_FRAMES; frame += 1) {
    const top = frame * SCROLL_STEP_PX;
    window.scrollTo({ top, behavior: 'instant' });
    await nextFrame();
    measureFrame(planes, camera, engine, `scroll ${top}px`, result);
  }

  window.scrollTo({ top: 0, behavior: 'instant' });
  await nextFrame();
  measureFrame(planes, camera, engine, 'scroll 0px', result);

  result.passed = result.maxDeltaPx <= MAX_DELTA_PX && result.samples > 0;
  return result;
}

function reportCheck(result: SyncCheck, stats: HTMLElement): void {
  const line =
    `check: desvio máximo ${result.maxDeltaPx.toFixed(4)} px em ${result.samples} amostras ` +
    `(pior: ${result.worst})`;
  stats.dataset['check'] = result.passed ? 'pass' : 'fail';
  if (result.passed) {
    console.info(`forja/dev: PASSOU — ${line}`);
    return;
  }
  console.error(`forja/dev: FALHOU — ${line} (limite ${MAX_DELTA_PX} px)`);
}

function boot(): void {
  const canvas = requireElement<HTMLCanvasElement>('#gl');
  const section = requireElement<HTMLElement>('#catalogo');
  const stats = requireElement<HTMLElement>('#stats');

  const engine = createEngine(canvas);
  if (engine === null) {
    stats.hidden = false;
    stats.textContent = 'WebGL2 indisponível: a página segue como documento estático.';
    return;
  }

  const handle = mountCatalog(section, engine);
  const params = new URLSearchParams(window.location.search);

  window.__forjaCatalogo = {
    get fps(): number {
      return engine.ticker.fps;
    },
  };

  if (params.get('hud') === '1') {
    stats.hidden = false;
    let frameIndex = 0;
    engine.ticker.subscribe(() => {
      frameIndex += 1;
      if (frameIndex % HUD_EVERY_N_FRAMES !== 0) return;
      stats.textContent = [
        `fps      ${engine.ticker.fps.toFixed(1)}`,
        `viewport ${engine.gl.size.w}×${engine.gl.size.h} @${engine.gl.size.dpr}`,
        `tier     ${engine.gl.tier}`,
        `planos   ${handle.planes.tracked().length}`,
        stats.dataset['check'] === undefined ? '' : `check    ${stats.dataset['check']}`,
      ]
        .filter((row) => row !== '')
        .join('\n');
    });
  }

  if (params.get('check') === '1') {
    // Depois das fontes: as linhas mudam de altura ao trocar a fallback pela
    // Instrument Sans, e medir antes disso testaria outro layout.
    void document.fonts.ready
      .then(() => runSyncCheck(engine, handle.planes.tracked(), handle.planes.camera))
      .then((result) => {
        const debug = window.__forjaCatalogo;
        if (debug !== undefined) debug.check = result;
        reportCheck(result, stats);
      });
  }
}

boot();
