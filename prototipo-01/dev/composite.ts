import {
  BoxGeometry,
  Color,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  WireframeGeometry,
  LineSegments,
  LineBasicMaterial,
} from 'three';
import { createEngine } from '@/engine';
import type { Composite, Engine, GL, Layer, Ticker } from '@/engine';

/**
 * Página interna (não entra no build: só `index.html` é input do Vite).
 * Serve para olhar a transição de threshold quadro a quadro e para rodar a
 * verificação de "é threshold, não crossfade" com `?check=1`.
 */

const CAMERA_FOV = 50;
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 100;
const CAMERA_Z = 3.2;
const CUBE_SPEED_Y = 0.6; // rad/s
const CUBE_SPEED_X = 0.23; // rad/s — primo com o Y para o giro não repetir
const STATS_EVERY_N_FRAMES = 15; // ~4 atualizações/s: legível sem thrash de layout

/** Amostras do `readPixels` na verificação. */
const SAMPLE_COUNT = 1000;

/**
 * Tolerância por canal, em níveis de 8 bits.
 *
 * As camadas puras chegam à tela por dois caminhos: direto (progress 0 ou 1) e
 * pelo render target half-float + encode sRGB do quad. A matemática é a mesma,
 * mas a mantissa de 11 bits do half-float pode deslocar um nível. 2 cobre isso
 * e ainda reprovaria qualquer crossfade real, que desloca dezenas de níveis.
 */
const COLOR_TOLERANCE = 2;

/** Cada lado precisa manter esta fração de pixels intactos em progress 0.5. */
const MIN_PURE_RATIO = 0.3;

interface CheckResult {
  pureA: number;
  pureB: number;
  samples: number;
  passed: boolean;
}

declare global {
  interface Window {
    __forjaCompositeCheck?: CheckResult;
  }
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) throw new Error(`forja/dev: elemento ausente: ${selector}`);
  return element;
}

function createLayer(backgroundHex: string, cubeHex: string, edgeHex: string): Layer {
  const scene = new Scene();
  scene.background = new Color(backgroundHex);

  const geometry = new BoxGeometry(1.2, 1.2, 1.2);
  const cube = new Mesh(geometry, new MeshBasicMaterial({ color: new Color(cubeHex) }));
  // Arestas em cor contrastante: com material sem luz, a silhueta sozinha não
  // deixa claro que o cubo está girando.
  cube.add(
    new LineSegments(
      new WireframeGeometry(geometry),
      new LineBasicMaterial({ color: new Color(edgeHex) }),
    ),
  );
  scene.add(cube);

  const camera = new PerspectiveCamera(CAMERA_FOV, 1, CAMERA_NEAR, CAMERA_FAR);
  camera.position.z = CAMERA_Z;

  return { scene, camera };
}

function spin(layer: Layer, elapsed: number, phase: number): void {
  const cube = layer.scene.children[0];
  if (cube === undefined) return;
  cube.rotation.y = elapsed * CUBE_SPEED_Y + phase;
  cube.rotation.x = elapsed * CUBE_SPEED_X;
}

function fitCamera(layer: Layer, aspect: number): void {
  const { camera } = layer;
  if (camera instanceof PerspectiveCamera) {
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  }
}

function readFrame(gl: GL): { pixels: Uint8Array; count: number } | null {
  const context = gl.renderer.getContext();
  if (!(context instanceof WebGL2RenderingContext)) return null;
  const width = context.drawingBufferWidth;
  const height = context.drawingBufferHeight;
  const pixels = new Uint8Array(width * height * 4);
  context.readPixels(0, 0, width, height, context.RGBA, context.UNSIGNED_BYTE, pixels);
  return { pixels, count: width * height };
}

function sameColor(a: Uint8Array, b: Uint8Array, offset: number): boolean {
  for (let channel = 0; channel < 3; channel += 1) {
    const left = a[offset + channel] ?? 0;
    const right = b[offset + channel] ?? 0;
    if (Math.abs(left - right) > COLOR_TOLERANCE) return false;
  }
  return true;
}

/**
 * Captura a tela com A puro, com B puro e no meio da transição, e mede quantos
 * pixels do meio continuam idênticos a um dos extremos. Crossfade reprova aqui:
 * em 0.5 nenhum pixel dele é igual a A nem a B.
 */
function runThresholdCheck(gl: GL, composite: Composite): CheckResult | null {
  const previous = composite.progress;

  composite.progress = 0;
  composite.render();
  const frameA = readFrame(gl);

  composite.progress = 1;
  composite.render();
  const frameB = readFrame(gl);

  composite.progress = 0.5;
  composite.render();
  const frameMid = readFrame(gl);

  composite.progress = previous;

  if (frameA === null || frameB === null || frameMid === null) return null;

  const stride = Math.max(1, Math.floor(frameA.count / SAMPLE_COUNT));
  let samples = 0;
  let pureA = 0;
  let pureB = 0;

  for (let pixel = 0; pixel < frameA.count && samples < SAMPLE_COUNT; pixel += stride) {
    const offset = pixel * 4;
    samples += 1;
    if (sameColor(frameMid.pixels, frameA.pixels, offset)) pureA += 1;
    else if (sameColor(frameMid.pixels, frameB.pixels, offset)) pureB += 1;
  }

  const ratioA = samples > 0 ? pureA / samples : 0;
  const ratioB = samples > 0 ? pureB / samples : 0;
  return {
    pureA: ratioA,
    pureB: ratioB,
    samples,
    passed: ratioA >= MIN_PURE_RATIO && ratioB >= MIN_PURE_RATIO,
  };
}

function reportCheck(result: CheckResult | null, stats: HTMLElement): void {
  if (result === null) {
    console.error('forja/dev: verificação impossível — sem contexto WebGL2');
    return;
  }
  const line =
    `check: A puro ${(result.pureA * 100).toFixed(1)}% · ` +
    `B puro ${(result.pureB * 100).toFixed(1)}% · ${result.samples} amostras`;
  window.__forjaCompositeCheck = result;
  stats.dataset.check = result.passed ? 'pass' : 'fail';

  if (result.passed) {
    console.info(`forja/dev: PASSOU — ${line}`);
    return;
  }
  console.error(
    `forja/dev: FALHOU — ${line} (mínimo ${(MIN_PURE_RATIO * 100).toFixed(0)}% de cada lado)`,
  );
}

interface DemoContext {
  engine: Engine;
  layers: [Layer, Layer];
  stats: HTMLElement;
}

function startLoop(context: DemoContext, wantsCheck: boolean): void {
  const { engine, layers, stats } = context;
  const { gl, composite, ticker } = engine;
  let frameIndex = 0;
  let checked = false;

  ticker.subscribe((_dt, elapsed) => {
    spin(layers[0], elapsed, 0);
    // Fase diferente para as duas cenas não parecerem a mesma imagem colorida.
    spin(layers[1], elapsed, Math.PI / 3);
    composite.render();

    if (wantsCheck && !checked) {
      checked = true;
      reportCheck(runThresholdCheck(gl, composite), stats);
    }

    frameIndex += 1;
    if (frameIndex % STATS_EVERY_N_FRAMES === 0) stats.textContent = formatStats(gl, ticker, stats);
  });
}

function formatStats(gl: GL, ticker: Ticker, stats: HTMLElement): string {
  const check = stats.dataset.check;
  return [
    `fps      ${ticker.fps.toFixed(1)}`,
    `tier     ${gl.tier} (dpr ${gl.size.dpr}, fbo ${gl.settings.fboScale})`,
    `viewport ${gl.size.w}\u00d7${gl.size.h}`,
    `renderer ${gl.rendererName}`,
    check === undefined ? '' : `check    ${check}`,
  ]
    .filter((row) => row !== '')
    .join('\n');
}

function bindSlider(slider: HTMLInputElement, output: HTMLOutputElement, composite: Composite): void {
  const sync = (): void => {
    composite.progress = Number(slider.value);
    output.textContent = composite.progress.toFixed(3);
  };
  slider.addEventListener('input', sync);
  sync();
}

function boot(): void {
  const canvas = requireElement<HTMLCanvasElement>('#gl');
  const slider = requireElement<HTMLInputElement>('#progress');
  const sliderValue = requireElement<HTMLOutputElement>('#progress-value');
  const stats = requireElement<HTMLElement>('#stats');

  const engine = createEngine(canvas);
  if (engine === null) {
    stats.textContent = 'WebGL2 indisponível neste navegador.';
    return;
  }
  const { gl, composite, pointer } = engine;

  const layers: [Layer, Layer] = [
    createLayer('#1d1a17', '#e8dcc8', '#8c7a5c'),
    createLayer('#101d22', '#7fd4e0', '#1c3f49'),
  ];

  composite.setLayers(layers[0], layers[1]);
  bindSlider(slider, sliderValue, composite);

  const applyAspect = (): void => {
    const aspect = gl.size.h > 0 ? gl.size.w / gl.size.h : 1;
    for (const layer of layers) fitCamera(layer, aspect);
    // O raio do cursor depende de fov e aspect: sem isto ele fica esticado no
    // eixo X assim que a janela deixa de ser quadrada.
    pointer.setCamera(CAMERA_FOV, aspect);
  };
  gl.onResize(applyAspect);
  applyAspect();

  const wantsCheck = new URLSearchParams(window.location.search).get('check') === '1';
  startLoop({ engine, layers, stats }, wantsCheck);
}

boot();
