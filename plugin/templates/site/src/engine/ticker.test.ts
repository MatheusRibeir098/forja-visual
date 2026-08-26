import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTicker } from '@/engine/ticker';
import type { Ticker } from '@/engine/ticker';

/**
 * O que estes testes seguram é o **rearme** (`ticker.ts`, "REARME"): a cadeia de
 * rAF pode ser cortada por fora — por um stub de congelamento, por um inscrito
 * que lança, pela aba oculta — e ela precisa voltar sozinha. Enquanto não
 * voltava, a página ficava parada no último quadro desenhado, sem erro nenhum,
 * exibindo o conteúdo do FBO da seção anterior por baixo do texto da atual.
 */

/** Handle de rAF simulado. O HTML garante inteiro > 0; o stub de congelamento devolve 0. */
const FIRST_HANDLE = 1;

/** Fila de rAF dirigida à mão — o "quadro aconteceu" dos testes. */
interface FakeRaf {
  /** Executa os callbacks pendentes com o tempo dado, em ms. */
  flush(now: number): void;
  /** Quantos callbacks estão na fila. */
  readonly pending: number;
  /** Passa a devolver 0 sem agendar nada — o stub de `freezePage`. */
  freeze(): void;
  /** Volta a agendar de verdade. */
  unfreeze(): void;
}

function installFakeRaf(): FakeRaf {
  let queue: Array<(now: number) => void> = [];
  let nextHandle = FIRST_HANDLE;
  let frozen = false;

  vi.stubGlobal('requestAnimationFrame', (fn: (now: number) => void): number => {
    if (frozen) return 0;
    queue.push(fn);
    nextHandle += 1;
    return nextHandle;
  });
  vi.stubGlobal('cancelAnimationFrame', (): void => {
    queue = [];
  });

  return {
    flush(now: number): void {
      const running = queue;
      queue = [];
      for (const fn of running) fn(now);
    },
    get pending(): number {
      return queue.length;
    },
    freeze(): void {
      frozen = true;
    },
    unfreeze(): void {
      frozen = false;
    },
  };
}

describe('ticker', () => {
  let raf: FakeRaf;
  let ticker: Ticker | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    raf = installFakeRaf();
  });

  afterEach(() => {
    ticker?.dispose();
    ticker = null;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('mantém a cadeia viva em `always`: um quadro agenda o próximo', () => {
    ticker = createTicker();
    const tick = vi.fn();
    ticker.subscribe(tick);

    raf.flush(1000);
    raf.flush(1016);

    expect(tick).toHaveBeenCalledTimes(2);
    expect(raf.pending).toBe(1);
  });

  it('volta a desenhar depois de um rAF que devolve 0, quando alguém pede quadro', () => {
    ticker = createTicker();
    const tick = vi.fn();
    ticker.subscribe(tick);

    // Congela como o medidor faz: o próximo agendamento devolve 0 e não chama de volta.
    raf.freeze();
    raf.flush(1000);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(raf.pending).toBe(0);

    // Com o rAF real de volta, é o `invalidate()` do scroll que rearma.
    raf.unfreeze();
    ticker.invalidate();
    raf.flush(1400);

    expect(tick).toHaveBeenCalledTimes(2);
    expect(raf.pending).toBe(1);
  });

  it('rearma sozinho, sem scroll nem resize, dentro da janela de tentativa', () => {
    ticker = createTicker();
    const tick = vi.fn();
    ticker.subscribe(tick);

    raf.freeze();
    raf.flush(1000);
    expect(raf.pending).toBe(0);

    raf.unfreeze();
    vi.advanceTimersByTime(250);
    raf.flush(1300);

    expect(tick).toHaveBeenCalledTimes(2);
  });

  it('não agenda dois quadros quando `invalidate()` é chamado com a cadeia viva', () => {
    ticker = createTicker();
    const tick = vi.fn();
    ticker.subscribe(tick);

    ticker.invalidate();
    ticker.invalidate();
    ticker.invalidate();
    expect(raf.pending).toBe(1);

    raf.flush(1000);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(raf.pending).toBe(1);
  });

  it('sobrevive a um inscrito que lança: o quadro seguinte continua vindo', () => {
    ticker = createTicker();
    const explode = vi.fn(() => {
      throw new Error('seção quebrada');
    });
    ticker.subscribe(explode);

    expect(() => raf.flush(1000)).toThrow('seção quebrada');
    expect(raf.pending).toBe(1);

    expect(() => raf.flush(1016)).toThrow('seção quebrada');
    expect(explode).toHaveBeenCalledTimes(2);
  });

  it('em `demand` só roda o quadro pedido', () => {
    ticker = createTicker();
    const tick = vi.fn();
    ticker.subscribe(tick);
    ticker.setMode('demand');

    raf.flush(1000);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(raf.pending).toBe(0);

    ticker.invalidate();
    raf.flush(1016);
    expect(tick).toHaveBeenCalledTimes(2);
    expect(raf.pending).toBe(0);
  });

  it('para de tentar rearmar depois do `dispose()`', () => {
    ticker = createTicker();
    const tick = vi.fn();
    ticker.subscribe(tick);

    raf.freeze();
    raf.flush(1000);
    ticker.dispose();
    ticker = null;

    raf.unfreeze();
    vi.advanceTimersByTime(1000);
    expect(raf.pending).toBe(0);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('o dt tem teto: uma pausa longa vira câmera lenta, não teleporte', () => {
    ticker = createTicker();
    const deltas: number[] = [];
    ticker.subscribe((dt) => deltas.push(dt));

    raf.flush(1000);
    raf.flush(11_000); // 10 s de aba oculta
    expect(deltas[0]).toBe(0);
    expect(deltas[1]).toBeCloseTo(1 / 15, 6);
  });
});
