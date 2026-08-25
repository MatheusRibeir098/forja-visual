import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBeats } from '@/engine/beats';
import type { Beats } from '@/engine/beats';

const VIEWPORT_HEIGHT = 800;
const ELEMENT_HEIGHT = 400;
const INITIAL_OFFSET_TOP = 1000;
/** Altura do bloco inserido acima do beat no teste de remedição. */
const INSERTED_BLOCK_HEIGHT = 800;

/**
 * O ResizeObserver do happy-dom existe mas é um stub sem implementação
 * (`observe`/`disconnect` são no-ops), então não há como disparar o callback.
 * Este mock guarda os callbacks e expõe `trigger()` para simular o relayout.
 */
class MockResizeObserver {
  static callbacks = new Set<() => void>();

  static trigger(): void {
    for (const callback of MockResizeObserver.callbacks) callback();
  }

  static reset(): void {
    MockResizeObserver.callbacks.clear();
  }

  private readonly callback: () => void;

  constructor(callback: () => void) {
    this.callback = callback;
    MockResizeObserver.callbacks.add(callback);
  }

  observe(): void {}
  unobserve(): void {}

  disconnect(): void {
    MockResizeObserver.callbacks.delete(this.callback);
  }
}

/**
 * Ticker manual no lugar do rAF do projeto — `tick()` é o "frame aconteceu".
 * `createBeats` exige `onFrame`: o único rAF do código vive em `ticker.ts`,
 * então em teste a fila de quadros é esta, dirigida à mão.
 */
function createManualTicker(): { onFrame: (fn: () => void) => () => void; tick: () => void } {
  const callbacks = new Set<() => void>();
  return {
    onFrame(fn: () => void): () => void {
      callbacks.add(fn);
      return () => {
        callbacks.delete(fn);
      };
    },
    tick(): void {
      for (const fn of callbacks) fn();
    },
  };
}

/** Layout simulado: o rect do elemento é derivado do documento e do scroll. */
interface FakeLayout {
  offsetTop: number;
  scrollTop: number;
}

function attachFakeRect(el: Element, layout: FakeLayout, height = ELEMENT_HEIGHT): void {
  const rect = (): DOMRect => {
    const top = layout.offsetTop - layout.scrollTop;
    return {
      top,
      height,
      bottom: top + height,
      left: 0,
      right: 0,
      width: 0,
      x: 0,
      y: top,
    } as DOMRect;
  };
  vi.spyOn(el, 'getBoundingClientRect').mockImplementation(rect);
}

describe('beats', () => {
  let beats: Beats | null = null;

  beforeEach(() => {
    MockResizeObserver.reset();
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    window.innerHeight = VIEWPORT_HEIGHT;
  });

  afterEach(() => {
    beats?.dispose();
    beats = null;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('converte a posição do elemento em progresso 0-1', () => {
    const layout: FakeLayout = { offsetTop: INITIAL_OFFSET_TOP, scrollTop: 0 };
    const el = document.createElement('div');
    document.body.append(el);
    attachFakeRect(el, layout);

    // Estes casos dirigem a medição por `measure()`; o ticker existe só porque
    // `onFrame` é obrigatório — nada aqui depende de um quadro chegar.
    beats = createBeats({ onFrame: createManualTicker().onFrame });
    const beat = beats.register(el);

    // Elemento 200 px abaixo do fundo do viewport: ainda não entrou.
    beats.measure();
    expect(beat.progress).toBe(0);

    // Scroll até o centro do elemento coincidir com o centro do viewport.
    layout.scrollTop = INITIAL_OFFSET_TOP + ELEMENT_HEIGHT / 2 - VIEWPORT_HEIGHT / 2;
    beats.measure();
    expect(beat.progress).toBeCloseTo(0.5, 6);

    // Fundo do elemento no topo do viewport: janela fechada.
    layout.scrollTop = INITIAL_OFFSET_TOP + ELEMENT_HEIGHT;
    beats.measure();
    expect(beat.progress).toBe(1);
  });

  it('realinha sem offset residual quando algo cresce acima do elemento', () => {
    const layout: FakeLayout = { offsetTop: INITIAL_OFFSET_TOP, scrollTop: 0 };
    const el = document.createElement('div');
    document.body.append(el);
    attachFakeRect(el, layout);

    const ticker = createManualTicker();
    beats = createBeats({ onFrame: ticker.onFrame });
    const beat = beats.register(el);

    const centeredScroll = INITIAL_OFFSET_TOP + ELEMENT_HEIGHT / 2 - VIEWPORT_HEIGHT / 2;
    layout.scrollTop = centeredScroll;
    window.dispatchEvent(new Event('scroll'));
    ticker.tick();
    expect(beat.progress).toBeCloseTo(0.5, 6);

    // Um bloco de 800 px nasce acima: o beat desce junto, sem ninguém avisar.
    const inserted = document.createElement('div');
    document.body.prepend(inserted);
    layout.offsetTop += INSERTED_BLOCK_HEIGHT;
    MockResizeObserver.trigger();
    ticker.tick();
    // Posição cravada continuaria em 0,5; ancorada no DOM, volta para fora da janela.
    expect(beat.progress).toBe(0);

    // Rolando exatamente o que foi inserido, o beat volta ao mesmo ponto: zero deriva.
    layout.scrollTop += INSERTED_BLOCK_HEIGHT;
    window.dispatchEvent(new Event('scroll'));
    ticker.tick();
    expect(beat.progress).toBeCloseTo(0.5, 6);
  });

  it('coalesce medições num único frame e não mede sem evento', () => {
    const layout: FakeLayout = { offsetTop: INITIAL_OFFSET_TOP, scrollTop: 0 };
    const el = document.createElement('div');
    document.body.append(el);
    attachFakeRect(el, layout);
    const readRect = vi.mocked(el.getBoundingClientRect);

    const ticker = createManualTicker();
    beats = createBeats({ onFrame: ticker.onFrame });
    beats.register(el);
    ticker.tick();
    readRect.mockClear();

    for (let event = 0; event < 5; event += 1) window.dispatchEvent(new Event('scroll'));
    ticker.tick();
    expect(readRect).toHaveBeenCalledTimes(1);

    ticker.tick();
    ticker.tick();
    expect(readRect).toHaveBeenCalledTimes(1);
  });

  it('notifica subscribers só quando o valor muda', () => {
    const layout: FakeLayout = { offsetTop: INITIAL_OFFSET_TOP, scrollTop: 0 };
    const el = document.createElement('div');
    document.body.append(el);
    attachFakeRect(el, layout);

    // Estes casos dirigem a medição por `measure()`; o ticker existe só porque
    // `onFrame` é obrigatório — nada aqui depende de um quadro chegar.
    beats = createBeats({ onFrame: createManualTicker().onFrame });
    const beat = beats.register(el);
    const listener = vi.fn();
    const unsubscribe = beat.subscribe(listener);

    beats.measure();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith(0);

    beats.measure();
    expect(listener).toHaveBeenCalledTimes(1);

    layout.scrollTop = INITIAL_OFFSET_TOP;
    beats.measure();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    layout.scrollTop += 100;
    beats.measure();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('margin expande a janela nas duas pontas', () => {
    const layout: FakeLayout = { offsetTop: INITIAL_OFFSET_TOP, scrollTop: 0 };
    const el = document.createElement('div');
    document.body.append(el);
    attachFakeRect(el, layout);

    // Estes casos dirigem a medição por `measure()`; o ticker existe só porque
    // `onFrame` é obrigatório — nada aqui depende de um quadro chegar.
    beats = createBeats({ onFrame: createManualTicker().onFrame });
    const withMargin = beats.register(el, { margin: 200 });

    // Sem margin o progresso seria 0 aqui; com 200 px a janela já abriu.
    layout.scrollTop = INITIAL_OFFSET_TOP - VIEWPORT_HEIGHT + 100;
    beats.measure();
    expect(withMargin.progress).toBeGreaterThan(0);
  });

  it('dispose para de observar e libera os listeners', () => {
    const layout: FakeLayout = { offsetTop: INITIAL_OFFSET_TOP, scrollTop: 0 };
    const el = document.createElement('div');
    document.body.append(el);
    attachFakeRect(el, layout);

    const ticker = createManualTicker();
    const local = createBeats({ onFrame: ticker.onFrame });
    const beat = local.register(el);
    const listener = vi.fn();
    beat.subscribe(listener);
    ticker.tick();
    listener.mockClear();

    local.dispose();
    layout.scrollTop = INITIAL_OFFSET_TOP;
    window.dispatchEvent(new Event('scroll'));
    ticker.tick();
    expect(listener).not.toHaveBeenCalled();
    expect(MockResizeObserver.callbacks.size).toBe(0);
  });
});
