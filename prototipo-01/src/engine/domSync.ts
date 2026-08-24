import { PerspectiveCamera } from 'three';
import type { Mesh } from 'three';
import type { GL } from './gl';
import type { Pointer } from './pointer';

/**
 * I.2 — Sincronia DOM ↔ WebGL: **1 px = 1 unidade**.
 *
 * Posicionar um plano "no olho" (`scale 2.4`, `y -0.7`) desalinha no primeiro
 * resize e não há número para corrigir, só tentativa. Aqui a câmera é montada
 * para que a altura visível na profundidade dos planos seja exatamente
 * `innerHeight` px: um mesh com `scale = (w, h, 1)` mede `w × h` px na tela e a
 * posição sai direto do `getBoundingClientRect()` do elemento.
 *
 * Com a câmera em `z = D` e o plano em `z = 0`, a altura visível é
 * `2 · D · tan(fov / 2)`. Igualando a `h` px:
 *
 *     fov = 2 · atan(h / 2 / D)
 *
 * As três armadilhas do catálogo, e o que este módulo faz com elas:
 *
 * 1. **Leitura-escrita intercalada.** Ler um `getBoundingClientRect()` depois de
 *    escrever no DOM força reflow síncrono; N elementos = N reflows por quadro.
 *    `update()` lê **todos** os retângulos num laço e só depois escreve nos
 *    meshes (escrita em three, não em DOM — mas a ordem fica explícita e o
 *    módulo continua correto quando alguém mexer no DOM aqui dentro).
 * 2. **Textura distorcida.** Quem amostra textura no plano usa `coverUv()` do
 *    `@/shaders/glsl` com o aspecto real do plano — este módulo entrega o
 *    tamanho em px via `mesh.scale`.
 * 3. **Resize.** `fov` depende da *altura*, então redimensionar exige recalcular
 *    fov e projeção, não só o tamanho do renderer. `syncCamera()` roda no início
 *    de cada `update()` e sai cedo quando nada mudou.
 */

/**
 * Distância da câmera aos planos, em px de mundo. O valor exato é arbitrário
 * (fov compensa qualquer D), mas ele decide a escala numérica de toda a cena:
 * 100 mantém posições na casa das centenas — longe do limite de precisão do
 * float32 e longe do zero, onde o z-fighting apareceria.
 */
export const CAMERA_DISTANCE_PX = 100;

/**
 * Near/far em px de mundo. Near 1 px porque nada é desenhado entre a câmera e
 * o plano; far em 10× a distância deixa espaço para camadas atrás sem esticar a
 * faixa de profundidade (razão far/near baixa = buffer de profundidade preciso).
 */
const CAMERA_NEAR_PX = 1;
const CAMERA_FAR_PX = CAMERA_DISTANCE_PX * 10;

/**
 * Margem de culling, em px. Um bloco a menos de 200 px de entrar no viewport já
 * pode aparecer no meio de um quadro de scroll rápido (a 60 fps, um flick de
 * trackpad anda ~150 px por quadro); abaixo disso o plano piscaria ao surgir.
 */
const CULL_MARGIN_PX = 200;

const RAD_TO_DEG = 180 / Math.PI;

/** Só o que o cálculo precisa de um `DOMRect` — facilita testar sem layout real. */
export interface DomRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface WorldPoint {
  x: number;
  y: number;
}

/**
 * Converte o retângulo do DOM (origem no topo-esquerda, Y para baixo) no centro
 * do mesh em coordenadas de mundo (origem no centro, Y para cima).
 *
 * `getBoundingClientRect()` já é relativo ao viewport — o scroll está embutido.
 * Com `offsetTop` seria preciso subtrair `scrollY` à mão, que é justamente onde
 * a sincronia costuma quebrar.
 */
export function domRectToWorld(rect: DomRectLike, viewport: ViewportSize): WorldPoint {
  return {
    x: rect.left - viewport.width / 2 + rect.width / 2,
    y: -rect.top + viewport.height / 2 - rect.height / 2,
  };
}

/** fov vertical, em graus, que faz `heightPx` px caberem exatos na distância `distancePx`. */
export function fovForHeight(heightPx: number, distancePx: number = CAMERA_DISTANCE_PX): number {
  return 2 * Math.atan(heightPx / 2 / distancePx) * RAD_TO_DEG;
}

export interface DomSync {
  /** Câmera px→unidade. Use-a para renderizar a cena dos planos rastreados. */
  camera: PerspectiveCamera;
  /**
   * Passa o mesh a seguir o elemento. O mesh precisa de geometria **1 × 1
   * centrada na origem** (`PlaneGeometry(1, 1)`), porque a escala aplicada é o
   * tamanho em px. Devolve o cancelamento.
   */
  track(el: Element, mesh: Mesh): () => void;
  /**
   * Um por quadro, chamado pelo ticker: mede todos os elementos e só então
   * posiciona os meshes.
   */
  update(): void;
  dispose(): void;
}

/**
 * O que este módulo usa do motor. Tipado como fatia (e não como `Engine`
 * inteiro) por dois motivos: evita o ciclo de import com `engine/index.ts` e
 * deixa o teste montar um duplo sem WebGL. `Engine` satisfaz esta forma.
 */
export interface DomSyncHost {
  gl: Pick<GL, 'size' | 'onResize'>;
  pointer: Pick<Pointer, 'setCamera'>;
}

interface TrackEntry {
  el: Element;
  mesh: Mesh;
  /** Retângulo da fase de leitura do quadro corrente. */
  left: number;
  top: number;
  width: number;
  height: number;
}

export function createDomSync(host: DomSyncHost): DomSync {
  const { gl, pointer } = host;
  const camera = new PerspectiveCamera(
    fovForHeight(gl.size.h),
    gl.size.h > 0 ? gl.size.w / gl.size.h : 1,
    CAMERA_NEAR_PX,
    CAMERA_FAR_PX,
  );
  camera.position.z = CAMERA_DISTANCE_PX;

  /** Array (e não Set) porque `update()` percorre isto duas vezes por quadro. */
  const entries: TrackEntry[] = [];
  /** Reusado a cada quadro: `update()` não pode alocar. */
  const viewport: ViewportSize = { width: gl.size.w, height: gl.size.h };

  let cameraWidth = -1;
  let cameraHeight = -1;
  let disposed = false;

  /**
   * Recalcula fov, aspect e projeção quando o viewport muda — e avisa o
   * `pointer`, cujo raio depende dos dois. Sai cedo no caso comum (nada mudou),
   * então pode ser chamada todo quadro.
   */
  function syncCamera(): void {
    const { w, h } = gl.size;
    if (w === cameraWidth && h === cameraHeight) return;
    cameraWidth = w;
    cameraHeight = h;
    if (w <= 0 || h <= 0) return;

    camera.fov = fovForHeight(h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    pointer.setCamera(camera.fov, camera.aspect);
  }

  /** Fora da tela por mais que a margem: não vale o draw call. */
  function isVisible(entry: TrackEntry): boolean {
    return (
      entry.top < viewport.height + CULL_MARGIN_PX &&
      entry.top + entry.height > -CULL_MARGIN_PX &&
      entry.width > 0 &&
      entry.height > 0
    );
  }

  function update(): void {
    if (disposed || entries.length === 0) return;
    syncCamera();
    viewport.width = gl.size.w;
    viewport.height = gl.size.h;

    // Fase 1 — leitura. Nenhuma escrita entre os `getBoundingClientRect()`:
    // um layout por quadro em vez de um por elemento.
    for (const entry of entries) {
      const rect = entry.el.getBoundingClientRect();
      entry.left = rect.left;
      entry.top = rect.top;
      entry.width = rect.width;
      entry.height = rect.height;
    }

    // Fase 2 — escrita.
    for (const entry of entries) {
      const { mesh } = entry;
      mesh.visible = isVisible(entry);
      if (!mesh.visible) continue;
      const world = domRectToWorld(entry, viewport);
      mesh.position.set(world.x, world.y, 0);
      mesh.scale.set(entry.width, entry.height, 1);
    }
  }

  const stopResize = gl.onResize(syncCamera);
  syncCamera();

  return {
    camera,

    track(el: Element, mesh: Mesh): () => void {
      if (disposed) throw new Error('createDomSync: track() chamado após dispose()');
      const entry: TrackEntry = { el, mesh, left: 0, top: 0, width: 0, height: 0 };
      entries.push(entry);
      // Sem uma primeira medida o mesh apareceria com escala 1×1 px no centro
      // até o próximo quadro — um flash de um quadro em cada montagem.
      update();
      return () => {
        const index = entries.indexOf(entry);
        if (index >= 0) entries.splice(index, 1);
      };
    },

    update,

    dispose(): void {
      if (disposed) return;
      disposed = true;
      stopResize();
      entries.length = 0;
    },
  };
}
