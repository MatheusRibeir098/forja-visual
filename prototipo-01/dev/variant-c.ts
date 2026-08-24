import '@/styles/tokens.css';
import '@/styles/base.css';
import '@/styles/typography.css';
import { Vector3 } from 'three';
import { createEngine } from '@/engine';
import { mountHero } from '@/variants/c';
import type { TrackedPlane } from '@/variants/c/ink';
import type { Engine } from '@/engine';
import type { PerspectiveCamera } from 'three';

/**
 * Página interna da variante C (não entra no build: só `index.html` é input do
 * Vite). Serve para três coisas:
 *
 * - olhar o hero claro sobre uma página com scroll de verdade;
 * - `?check=1`: provar que o plano WebGL **não descola** do texto em nenhuma
 *   velocidade de scroll — a promessa inteira da técnica I.2;
 * - `?hud=1`: fps, viewport e tier num canto.
 */

/** Tolerância do aceite: 1 px entre o retângulo do DOM e a projeção do mesh. */
const MAX_DELTA_PX = 1;

/**
 * Passo do scroll na varredura, em px. 137 é primo e não é múltiplo de nenhuma
 * altura de linha da página: garante posições fracionárias, onde erro de
 * arredondamento apareceria.
 */
const SCROLL_STEP_PX = 137;

/** Quadros da varredura — cobre o hero inteiro saindo da tela e voltando. */
const SWEEP_FRAMES = 24;

/** Atualizações do HUD por segundo ≈ 4, para o texto ser legível. */
const HUD_EVERY_N_FRAMES = 15;

interface SyncCheck {
  maxDeltaPx: number;
  samples: number;
  /** Onde o pior desvio aconteceu, para o erro não ser um número solto. */
  worst: string;
  passed: boolean;
}

interface VariantCDebug {
  readonly fps: number;
  check?: SyncCheck;
}

declare global {
  interface Window {
    __forjaVariantC?: VariantCDebug;
  }
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) throw new Error(`forja/dev: elemento ausente: ${selector}`);
  return element;
}

interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Reusados na projeção: a verificação roda dentro do quadro e não deve alocar. */
const topLeft = new Vector3();
const bottomRight = new Vector3();

/**
 * Projeta os cantos do plano de volta para px de tela. É o caminho inverso do
 * `domSync`: se a matemática de 1 px = 1 unidade estiver certa, o resultado é o
 * próprio `getBoundingClientRect()` do elemento.
 */
function projectMesh(plane: TrackedPlane, camera: PerspectiveCamera, viewport: ScreenRect): ScreenRect {
  const { mesh } = plane;
  const halfWidth = mesh.scale.x / 2;
  const halfHeight = mesh.scale.y / 2;
  topLeft.set(mesh.position.x - halfWidth, mesh.position.y + halfHeight, 0).project(camera);
  bottomRight.set(mesh.position.x + halfWidth, mesh.position.y - halfHeight, 0).project(camera);

  const width = viewport.right;
  const height = viewport.bottom;
  return {
    left: (topLeft.x * 0.5 + 0.5) * width,
    top: (-topLeft.y * 0.5 + 0.5) * height,
    right: (bottomRight.x * 0.5 + 0.5) * width,
    bottom: (-bottomRight.y * 0.5 + 0.5) * height,
  };
}

function compare(dom: DOMRect, projected: ScreenRect): number {
  return Math.max(
    Math.abs(dom.left - projected.left),
    Math.abs(dom.top - projected.top),
    Math.abs(dom.right - projected.right),
    Math.abs(dom.bottom - projected.bottom),
  );
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/**
 * Mede o desvio de todos os planos no quadro corrente. Roda depois do callback
 * do ticker (o rAF desta função é agendado sempre após o dele), então o que se
 * compara é exatamente o que foi desenhado.
 */
function measureFrame(
  planes: readonly TrackedPlane[],
  camera: PerspectiveCamera,
  engine: Engine,
  label: string,
  result: SyncCheck,
): void {
  camera.updateMatrixWorld();
  const viewport: ScreenRect = { left: 0, top: 0, right: engine.gl.size.w, bottom: engine.gl.size.h };

  for (const plane of planes) {
    if (!plane.mesh.visible) continue;
    const dom = plane.el.getBoundingClientRect();
    const delta = compare(dom, projectMesh(plane, camera, viewport));
    result.samples += 1;
    if (delta > result.maxDeltaPx) {
      result.maxDeltaPx = delta;
      result.worst = `${label} · ${plane.el.nodeName.toLowerCase()}.${plane.el.className}`;
    }
  }
}

async function runSyncCheck(
  engine: Engine,
  planes: readonly TrackedPlane[],
  camera: PerspectiveCamera,
): Promise<SyncCheck> {
  const result: SyncCheck = { maxDeltaPx: 0, samples: 0, worst: 'nenhum', passed: false };

  // Varredura em scroll rápido: um passo grande por quadro é o pior caso real
  // (flick de trackpad anda ~150 px/quadro).
  for (let frame = 0; frame < SWEEP_FRAMES; frame += 1) {
    window.scrollTo({ top: frame * SCROLL_STEP_PX, behavior: 'instant' });
    await nextFrame();
    measureFrame(planes, camera, engine, `scroll ${frame * SCROLL_STEP_PX}px`, result);
  }

  // E de volta ao topo, que é onde o hero é julgado.
  window.scrollTo({ top: 0, behavior: 'instant' });
  await nextFrame();
  measureFrame(planes, camera, engine, 'scroll 0px', result);

  result.passed = result.maxDeltaPx <= MAX_DELTA_PX;
  return result;
}

function reportCheck(result: SyncCheck, stats: HTMLElement): void {
  const line =
    `check: desvio máximo ${result.maxDeltaPx.toFixed(3)} px em ${result.samples} amostras ` +
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
  const hero = requireElement<HTMLElement>('#hero');
  const stats = requireElement<HTMLElement>('#stats');

  const engine = createEngine(canvas);
  if (engine === null) {
    stats.hidden = false;
    stats.textContent = 'WebGL2 indisponível: a página segue como documento estático.';
    return;
  }

  const handle = mountHero(hero, engine);
  const params = new URLSearchParams(window.location.search);

  window.__forjaVariantC = {
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
        stats.dataset['check'] === undefined ? '' : `check    ${stats.dataset['check']}`,
      ]
        .filter((row) => row !== '')
        .join('\n');
    });
  }

  if (params.get('check') === '1') {
    // Depois das fontes: o título muda de largura ao trocar a fallback pela
    // Instrument Serif, e medir antes disso testaria outro layout.
    void document.fonts.ready
      .then(() => runSyncCheck(engine, handle.ink.tracked(), handle.ink.camera))
      .then((result) => {
        const debug = window.__forjaVariantC;
        if (debug !== undefined) debug.check = result;
        reportCheck(result, stats);
      });
  }
}

boot();
