/**
 * O **único** `requestAnimationFrame` do projeto.
 *
 * Cada rAF independente custa um agendamento e, pior, torna a ordem entre
 * sistemas indefinida (a câmera pode atualizar depois do objeto que a segue).
 * Aqui há um loop só; quem precisa de quadro se inscreve.
 *
 * ── REARME: A CADEIA TEM DE VOLTAR DEPOIS DE CORTADA ────────────────────────
 * Um loop de rAF é uma corrente: cada quadro agenda o próximo. Se um elo se
 * perde, **nada** recomeça sozinho — e a página fica parada no último quadro
 * desenhado, sem erro no console. Três formas medidas de perder o elo:
 *
 *  1. alguém troca `requestAnimationFrame` por um stub que devolve 0 e nunca
 *     chama de volta. É literalmente o que o medidor de contraste do plugin faz
 *     para fotografar a página (`freezePage`, `scripts/lib/page-state.ts`), e
 *     todo site gerado passa por ele;
 *  2. um inscrito lança: sem `finally`, a linha que reagenda nunca roda, e uma
 *     seção quebrada congela o site inteiro;
 *  3. a aba vai para segundo plano ou o agendamento é descartado.
 *
 * Por que isso é grave e não cosmético: o que fica na tela é o **quadro
 * anterior** do FBO de página, que pode ser de outra seção, com fundo de
 * luminância oposta. Num site gerado com este motor foi exatamente assim que um
 * bloco de texto claro terminou sobre um fundo claro herdado da seção acima —
 * contraste medido de 1,13:1, contra um piso de 7:1.
 *
 * Daí três decisões que não são detalhe:
 *
 *  · `framePending` — e **não** o handle — responde "já há quadro agendado?".
 *    Um handle 0 é ambíguo; a flag não é;
 *  · o reagendamento mora num `finally`, então sobrevive a um inscrito que
 *    lança;
 *  · quando o rAF não agenda nada, um `setTimeout` de `REARM_RETRY_MS` tenta de
 *    novo, e some assim que um quadro é agendado de verdade.
 *
 * Do lado de fora, `engine/index.ts` liga o `onDirty` dos beats
 * **incondicionalmente**: todo scroll/resize chama `invalidate()`, que é o
 * gatilho imediato do rearme (o temporizador é a rede para quando ninguém rola).
 * Com a cadeia viva, `invalidate()` custa duas comparações e um retorno.
 */

export type TickFn = (dt: number, elapsed: number) => void;

/**
 * `always`: loop contínuo, para movimento dirigido por scroll/cursor.
 * `demand`: nada roda até alguém chamar `invalidate()` — modo de páginas em que
 * a cena é estática e só reage a evento.
 *
 * ⚠️ `demand` **não** é mais o modo de `prefers-reduced-motion`: o motor ignora
 * essa preferência por decisão de produto (ver `engine/tier.ts`). Um quadro por
 * evento de scroll também não seria movimento contínuo — o navegador agrupa os
 * eventos e o resultado lê como engasgo.
 */
export type TickerMode = 'always' | 'demand';

export interface Ticker {
  /** Inscreve uma função por quadro. Retorna o cancelamento. */
  subscribe(fn: TickFn): () => void;
  setMode(mode: TickerMode): void;
  /**
   * Pede um quadro. Com a cadeia viva é no-op (já há um agendado); com a cadeia
   * cortada é o que a traz de volta — ver "REARME" no topo do arquivo.
   */
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

/**
 * Espera entre tentativas de rearme, em ms, quando `requestAnimationFrame` não
 * agenda nada. 250 ms sai da janela em que a cadeia precisa voltar sem depender
 * de o usuário (ou o medidor) tocar em algo: o medidor de contraste do plugin
 * espera 400 ms entre descongelar e fotografar, então uma tentativa cabe com
 * ~150 ms de quadros reais de folga antes da foto.
 *
 * Não é um segundo relógio de animação: o temporizador só existe enquanto a
 * cadeia está cortada — o primeiro quadro que volta a ser agendado o encerra, e
 * o custo enquanto isso é uma chamada de função a cada 250 ms, sem desenho.
 */
const REARM_RETRY_MS = 250;

/** Sentinela de "nenhuma tentativa de rearme pendente" — `setTimeout` devolve > 0. */
const NO_REARM_TIMER = 0;

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
  /**
   * Handle do quadro em voo, ou 0. Serve **só** para cancelar; quem responde
   * "já há quadro agendado?" é `framePending`.
   */
  let frameHandle = 0;
  /**
   * Há um quadro realmente agendado? Separado do handle porque um handle 0 é
   * ambíguo: o HTML garante que `requestAnimationFrame` devolve um inteiro
   * **maior que zero**, então 0 só sai de uma implementação que não agendou
   * nada (o stub `() => 0` do congelamento). Tratando os dois casos com a mesma
   * variável, a cadeia morria em silêncio; separados, um `invalidate()`
   * posterior reagenda.
   */
  let framePending = false;
  /** Handle do `setTimeout` de rearme, ou `NO_REARM_TIMER`. */
  let rearmTimer = NO_REARM_TIMER;
  let previousTime = NO_PREVIOUS_FRAME;
  let elapsed = 0;
  let disposed = false;

  function recordFrame(durationMs: number): void {
    frameMs[sampleCursor] = durationMs;
    sampleCursor = (sampleCursor + 1) % FPS_WINDOW;
    if (sampleCount < FPS_WINDOW) sampleCount += 1;
    fpsStale = true;
  }

  function clearRearmTimer(): void {
    if (rearmTimer === NO_REARM_TIMER) return;
    window.clearTimeout(rearmTimer);
    rearmTimer = NO_REARM_TIMER;
  }

  function retryRearm(): void {
    if (disposed || rearmTimer !== NO_REARM_TIMER || document.hidden) return;
    rearmTimer = window.setTimeout(() => {
      rearmTimer = NO_REARM_TIMER;
      schedule();
    }, REARM_RETRY_MS);
  }

  function schedule(): void {
    if (disposed || framePending || document.hidden) return;
    framePending = true;
    // A leitura é do global a cada chamada, de propósito: guardar a referência
    // no boot ignoraria a troca por stub e, pior, seguraria a função antiga
    // depois que a página devolvesse a verdadeira.
    frameHandle = requestAnimationFrame(frame);
    if (frameHandle === 0) {
      // Não agendou nada (stub de congelamento). Fica pendente de rearme por
      // duas vias independentes: o próximo `invalidate()` — que todo scroll
      // dispara, via `onDirty` dos beats — e o temporizador, que cobre o caso
      // em que ninguém rola nem redimensiona.
      framePending = false;
      retryRearm();
      return;
    }
    clearRearmTimer();
  }

  function frame(now: number): void {
    framePending = false;
    frameHandle = 0;

    const rawDelta = previousTime === NO_PREVIOUS_FRAME ? 0 : now - previousTime;
    previousTime = now;

    if (rawDelta > 0) recordFrame(rawDelta);

    const dt = Math.min(rawDelta / 1000, MAX_DELTA_SECONDS);
    elapsed += dt;

    try {
      for (const fn of subscribers) fn(dt, elapsed);
    } finally {
      // No `finally`, e não depois do laço: um inscrito que lance derrubaria o
      // reagendamento junto e pararia o site inteiro. O erro continua subindo
      // para o console (nada é engolido aqui) — o que não pode acontecer é a
      // página congelar por causa de uma seção.
      if (mode === 'always') schedule();
    }
  }

  function handleVisibility(): void {
    if (document.hidden) {
      if (frameHandle !== 0) cancelAnimationFrame(frameHandle);
      frameHandle = 0;
      framePending = false;
      // Nada a rearmar enquanto a aba está oculta: quem religa é este mesmo
      // handler, na volta.
      clearRearmTimer();
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
      if (frameHandle !== 0) cancelAnimationFrame(frameHandle);
      frameHandle = 0;
      framePending = false;
      clearRearmTimer();
      document.removeEventListener('visibilitychange', handleVisibility);
      subscribers.clear();
    },
  };
}
