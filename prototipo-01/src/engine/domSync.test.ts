import { Mesh } from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CAMERA_DISTANCE_PX,
  createDomSync,
  domRectToWorld,
  fovForHeight,
  projectMeshToScreen,
  screenRectDelta,
} from '@/engine/domSync';
import type { DomSync, DomSyncHost } from '@/engine/domSync';
import type { GLSize, ResizeListener } from '@/engine/gl';

const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 720;
/** Tolerância de ponto flutuante em px: bem abaixo do 1 px exigido pelo aceite. */
const EPSILON_PX = 1e-9;

function rectOf(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  };
}

interface TestHost extends DomSyncHost {
  size: GLSize;
  resize(width: number, height: number): void;
  readonly cameraCalls: ReadonlyArray<{ fov: number; aspect: number }>;
}

function createTestHost(): TestHost {
  const size: GLSize = { w: VIEWPORT_WIDTH, h: VIEWPORT_HEIGHT, dpr: 1 };
  const listeners = new Set<ResizeListener>();
  const cameraCalls: Array<{ fov: number; aspect: number }> = [];

  return {
    size,
    cameraCalls,
    gl: {
      size,
      onResize(fn: ResizeListener): () => void {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    },
    pointer: {
      setCamera(fov: number, aspect: number): void {
        cameraCalls.push({ fov, aspect });
      },
    },
    resize(width: number, height: number): void {
      size.w = width;
      size.h = height;
      for (const fn of listeners) fn(size);
    },
  };
}

interface TrackedElement {
  el: Element;
  setRect(rect: DOMRect): void;
  readonly reads: number;
  resetReads(): void;
}

function createTrackedElement(rect: DOMRect): TrackedElement {
  const el = document.createElement('div');
  let current = rect;
  let reads = 0;
  el.getBoundingClientRect = (): DOMRect => {
    reads += 1;
    return current;
  };
  return {
    el,
    setRect(next: DOMRect): void {
      current = next;
    },
    get reads(): number {
      return reads;
    },
    resetReads(): void {
      reads = 0;
    },
  };
}

describe('domRectToWorld', () => {
  const viewport = { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT };

  it('põe na origem um retângulo centrado no viewport', () => {
    const rect = rectOf(VIEWPORT_WIDTH / 2 - 100, VIEWPORT_HEIGHT / 2 - 40, 200, 80);
    expect(domRectToWorld(rect, viewport)).toEqual({ x: 0, y: 0 });
  });

  it('inverte o Y: o canto superior esquerdo vira X negativo e Y positivo', () => {
    const rect = rectOf(0, 0, 400, 100);
    expect(domRectToWorld(rect, viewport)).toEqual({
      x: -VIEWPORT_WIDTH / 2 + 200,
      y: VIEWPORT_HEIGHT / 2 - 50,
    });
  });

  it('acompanha o scroll pelo próprio rect, sem somar scrollY à mão', () => {
    // Elemento que já subiu 500 px além do topo do viewport.
    const rect = rectOf(0, -500, 400, 100);
    const world = domRectToWorld(rect, viewport);
    expect(world.y).toBeCloseTo(VIEWPORT_HEIGHT / 2 - 50 + 500, 9);
  });
});

describe('fovForHeight', () => {
  it('faz a altura visível na distância da câmera valer exatamente o viewport', () => {
    const fov = fovForHeight(VIEWPORT_HEIGHT);
    const visible = 2 * CAMERA_DISTANCE_PX * Math.tan((fov * Math.PI) / 180 / 2);
    expect(visible).toBeCloseTo(VIEWPORT_HEIGHT, 9);
  });
});

describe('createDomSync', () => {
  let sync: DomSync | null = null;

  afterEach(() => {
    sync?.dispose();
    sync = null;
  });

  it('escala o mesh em px e o posiciona sobre o elemento', () => {
    const host = createTestHost();
    sync = createDomSync(host);
    const tracked = createTrackedElement(rectOf(120, 60, 640, 180));
    const mesh = new Mesh();
    sync.track(tracked.el, mesh);
    sync.update();

    expect(mesh.scale.x).toBe(640);
    expect(mesh.scale.y).toBe(180);
    expect(mesh.position.x).toBeCloseTo(120 - VIEWPORT_WIDTH / 2 + 320, 9);
    expect(mesh.position.y).toBeCloseTo(-60 + VIEWPORT_HEIGHT / 2 - 90, 9);
    expect(mesh.position.z).toBe(0);
  });

  it('lê o rect de cada elemento exatamente uma vez por quadro', () => {
    const host = createTestHost();
    sync = createDomSync(host);
    const first = createTrackedElement(rectOf(0, 0, 100, 100));
    const second = createTrackedElement(rectOf(0, 200, 100, 100));
    sync.track(first.el, new Mesh());
    sync.track(second.el, new Mesh());

    first.resetReads();
    second.resetReads();
    sync.update();
    expect(first.reads).toBe(1);
    expect(second.reads).toBe(1);

    sync.update();
    expect(first.reads).toBe(2);
    expect(second.reads).toBe(2);
  });

  it('recalcula fov e aspect no resize, e o plano segue o elemento', () => {
    const host = createTestHost();
    sync = createDomSync(host);
    const tracked = createTrackedElement(rectOf(0, 0, VIEWPORT_WIDTH, 200));
    const mesh = new Mesh();
    sync.track(tracked.el, mesh);

    const narrowWidth = 375;
    const narrowHeight = 667;
    tracked.setRect(rectOf(0, 0, narrowWidth, 120));
    host.resize(narrowWidth, narrowHeight);
    sync.update();

    expect(sync.camera.fov).toBeCloseTo(fovForHeight(narrowHeight), 9);
    expect(sync.camera.aspect).toBeCloseTo(narrowWidth / narrowHeight, 9);
    expect(mesh.scale.x).toBe(narrowWidth);
    expect(Math.abs(mesh.position.x)).toBeLessThan(EPSILON_PX);
    expect(mesh.position.y).toBeCloseTo(narrowHeight / 2 - 60, 9);

    const lastCall = host.cameraCalls.at(-1);
    expect(lastCall?.fov).toBeCloseTo(fovForHeight(narrowHeight), 9);
  });

  it('esconde o mesh de um elemento muito acima do viewport', () => {
    const host = createTestHost();
    sync = createDomSync(host);
    const mesh = new Mesh();
    const tracked = createTrackedElement(rectOf(0, -5000, 800, 200));
    sync.track(tracked.el, mesh);
    sync.update();
    expect(mesh.visible).toBe(false);
  });

  it('devolve em rectOf o retângulo já lido, sem uma segunda medição', () => {
    const host = createTestHost();
    sync = createDomSync(host);
    const tracked = createTrackedElement(rectOf(120, 60, 640, 180));
    sync.track(tracked.el, new Mesh());

    tracked.resetReads();
    sync.update();
    expect(sync.rectOf(tracked.el)).toMatchObject({
      left: 120,
      top: 60,
      width: 640,
      height: 180,
    });
    // A consulta é do quadro corrente: ela não pode custar layout nenhum.
    expect(tracked.reads).toBe(1);
    expect(sync.rectOf(document.createElement('div'))).toBeNull();
  });

  it('projeta o mesh de volta para o próprio rect do DOM — o aceite da técnica', () => {
    const host = createTestHost();
    sync = createDomSync(host);
    const dom = rectOf(137, 421.5, 640.25, 180.75);
    const tracked = createTrackedElement(dom);
    const mesh = new Mesh();
    sync.track(tracked.el, mesh);
    sync.update();
    sync.camera.updateMatrixWorld();

    const projected = projectMeshToScreen(mesh, sync.camera, {
      width: VIEWPORT_WIDTH,
      height: VIEWPORT_HEIGHT,
    });
    expect(screenRectDelta(dom, projected)).toBeLessThan(EPSILON_PX);
  });

  it('mantém a projeção colada ao texto durante uma varredura de scroll', () => {
    const host = createTestHost();
    sync = createDomSync(host);
    const tracked = createTrackedElement(rectOf(40, 900, 812, 96));
    const mesh = new Mesh();
    sync.track(tracked.el, mesh);
    const viewport = { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT };

    // 137 px por quadro: passo primo, não múltiplo de nenhuma altura de linha,
    // e da ordem do pior caso real (flick de trackpad anda ~150 px/quadro).
    let worst = 0;
    for (let frame = 0; frame < 24; frame += 1) {
      const top = 900 - frame * 137;
      tracked.setRect(rectOf(40, top, 812, 96));
      sync.update();
      sync.camera.updateMatrixWorld();
      if (!mesh.visible) continue;
      worst = Math.max(
        worst,
        screenRectDelta(
          rectOf(40, top, 812, 96),
          projectMeshToScreen(mesh, sync.camera, viewport),
        ),
      );
    }
    expect(worst).toBeLessThan(EPSILON_PX);
  });
});
