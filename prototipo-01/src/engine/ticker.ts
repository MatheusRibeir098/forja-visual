/**
 * O **único** `requestAnimationFrame` do projeto.
 *
 * Cada rAF independente custa um agendamento e, pior, torna a ordem entre
 * sistemas indefinida (a câmera pode atualizar depois do objeto que a segue).
 * Aqui há um loop só; quem precisa de quadro se inscreve.
 */

export type TickFn = (dt: number, elapsed: number) => void;

/**
 * `always`: loop contínuo, para movimento dirigido por scroll/cursor.
 * `demand`: nada roda até alguém chamar `invalidate()` — é o modo de
 * `prefers-reduced-motion` e de páginas onde a cena é estática.
 */
export type TickerMode = 'always' | 'demand';

export interface Ticker {
  /** Inscreve uma função por quadro. Retorna o cancelamento. */
  subscribe(fn: TickFn): () => void;
  setMode(mode: TickerMode): void;
  /** Pede um quadro. Em `always` é no-op (já há um agendado). */
  invalidate(): void;
  /** Mediana móvel dos últimos 60 quadros, em quadros por segundo. */
  readonly fps: number;
  dispose(): void;
}

/**
 * Teto do delta, em segundos. 1/15 s porque abaixo de 15 fps (aba em segundo
 * plano, GC longo, troca de janela) o `now - last` real chega a segundos: sem
 * teto, tudo que integra o dt salta de posição. Preferimos câmera lenta a
 * teleporte — e o teleporte é o que o usuário percebe ao voltar para a aba.
 */
const MAX_DELTA_SECONDS = 1 / 15;

/**
 * Janela do fps. 60 quadros = ~1 s a 60 Hz: curto o bastante para reagir a uma
 * queda real, longo o bastante para a mediana ignorar o quadro perdido isolado.
 */
const FPS_WINDOW = 60;

/** Sentinela de "ainda não houve quadro" — `performance.now()` nunca devolve 0 aqui. */
const NO_PREVIOUS_FRAME = 0;

function median(sorted: Float64Array, count: number): number {
  if (count === 0) return 0;
  const middle = count >> 1;
  if (count % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

export function createTicker(): Ticker {
  const subscribers = new Set<TickFn>();

  /** Duração de cada quadro em ms, em buffer circular pré-alocado (zero GC no loop). */
  const frameMs = new Float64Array(FPS_WINDOW);
  const sortScratch = new Float64Array(FPS_WINDOW);
  let sampleCount = 0;
  let sampleCursor = 0;

  let fpsCache = 0;
  let fpsStale = true;

  let mode: TickerMode = 'always';
  let frameHandle = 0;
  let previousTime = NO_PREVIOUS_FRAME;
  let elapsed = 0;
  let disposed = false;

  function recordFrame(durationMs: number): void {
    frameMs[sampleCursor] = durationMs;
    sampleCursor = (sampleCursor + 1) % FPS_WINDOW;
    if (sampleCount < FPS_WINDOW) sampleCount += 1;
    fpsStale = true;
  }

  function schedule(): void {
    if (disposed || frameHandle !== 0 || document.hidden) return;
    frameHandle = requestAnimationFrame(frame);
  }

  function frame(now: number): void {
    frameHandle = 0;

    const rawDelta = previousTime === NO_PREVIOUS_FRAME ? 0 : now - previousTime;
    previousTime = now;

    if (rawDelta > 0) recordFrame(rawDelta);

    const dt = Math.min(rawDelta / 1000, MAX_DELTA_SECONDS);
    elapsed += dt;

    for (const fn of subscribers) fn(dt, elapsed);

    if (mode === 'always') schedule();
  }

  function handleVisibility(): void {
    if (document.hidden) {
      if (frameHandle !== 0) {
        cancelAnimationFrame(frameHandle);
        frameHandle = 0;
      }
      // Ao voltar, o primeiro quadro recomeça a contagem: o intervalo de aba
      // oculta não é tempo de animação.
      previousTime = NO_PREVIOUS_FRAME;
      return;
    }
    if (mode === 'always') schedule();
  }

  document.addEventListener('visibilitychange', handleVisibility);
  schedule();

  return {
    subscribe(fn: TickFn): () => void {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },

    setMode(next: TickerMode): void {
      if (next === mode) return;
      mode = next;
      if (mode === 'always') schedule();
    },

    invalidate(): void {
      schedule();
    },

    get fps(): number {
      if (!fpsStale) return fpsCache;
      sortScratch.set(frameMs.subarray(0, sampleCount));
      sortScratch.subarray(0, sampleCount).sort();
      const middleMs = median(sortScratch, sampleCount);
      fpsCache = middleMs > 0 ? 1000 / middleMs : 0;
      fpsStale = false;
      return fpsCache;
    },

    dispose(): void {
      disposed = true;
      if (frameHandle !== 0) {
        cancelAnimationFrame(frameHandle);
        frameHandle = 0;
      }
      document.removeEventListener('visibilitychange', handleVisibility);
      subscribers.clear();
    },
  };
}
