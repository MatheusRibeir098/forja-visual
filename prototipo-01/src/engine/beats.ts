/**
 * V.2 — Beats ancorados no DOM.
 *
 * Coreografia por scroll com posições cravadas (`at: 0.36`) quebra em silêncio:
 * basta um parágrafo crescer acima e todos os números abaixo apontam para o
 * lugar errado, sem erro nenhum no console. Aqui a relação é invertida — a
 * seção *entrega um elemento* e o registro converte a posição dele em progresso
 * 0–1. Nada é cravado, então nada desalinha.
 *
 * Módulo puro em TS: sem WebGL, sem three.
 */

/** Âncora que abre a janela do beat. */
export type BeatStart = 'enter' | 'top' | 'center';

/** Âncora que fecha a janela do beat. */
export type BeatEnd = 'exit' | 'bottom' | 'center';

export interface BeatOptions {
  /**
   * `'enter'`: topo do elemento no fundo do viewport (padrão).
   * `'top'`: topo do elemento no topo do viewport.
   * `'center'`: centro do elemento no centro do viewport.
   */
  start?: BeatStart;
  /**
   * `'exit'`: fundo do elemento no topo do viewport (padrão).
   * `'bottom'`: fundo do elemento no fundo do viewport.
   * `'center'`: centro do elemento no centro do viewport.
   */
  end?: BeatEnd;
  /** px somados às duas pontas: a janela fica `2 × margin` maior. */
  margin?: number;
}

export interface Beat {
  /** 0–1 com clamp. Leia direto a 60 fps: é um campo, não um cálculo. */
  readonly progress: number;
  readonly el: Element;
  /** Notifica só quando o valor muda. Devolve a função de cancelamento. */
  subscribe(fn: (progress: number) => void): () => void;
  dispose(): void;
}

export interface Beats {
  register(el: Element, opts?: BeatOptions): Beat;
  /** Força remedição síncrona de todos os beats, ignorando o agendamento. */
  measure(): void;
  dispose(): void;
}

export interface BeatsOptions {
  /**
   * Registra um callback por quadro e devolve o cancelamento — na prática,
   * `ticker.subscribe`. É **obrigatório**: o projeto tem um
   * `requestAnimationFrame` só, dentro de `ticker.ts`, e um agendamento próprio
   * aqui reintroduziria a ordem indefinida entre medir e desenhar.
   */
  onFrame: (fn: () => void) => () => void;
  /**
   * Avisa que algo sujou a medição (scroll, resize, relayout), antes do próximo
   * quadro. Só é necessário com o ticker em `demand`: sem isto, nada pediria o
   * quadro em que a medição aconteceria. Em `always` pode ficar de fora.
   */
  onDirty?: () => void;
}

/**
 * Menor variação que dispara subscribers. 1e-4 do curso equivale a 0,1 px numa
 * janela de 1000 px: abaixo disso é jitter de sub-pixel do `getBoundingClientRect`.
 */
const PROGRESS_EPSILON = 1e-4;

/** Abaixo disso a janela é degenerada (start e end na mesma âncora): vira degrau. */
const MIN_SPAN_PX = 1e-3;

interface BeatEntry {
  el: Element;
  start: BeatStart;
  end: BeatEnd;
  margin: number;
  progress: number;
  lastNotified: number | null;
  listeners: Set<(progress: number) => void>;
}

/** Retângulo mínimo de que o cálculo precisa — facilita testar sem layout real. */
interface BeatRect {
  top: number;
  height: number;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * px de scroll que ainda faltam para a âncora se alinhar. Positivo = ainda não
 * chegou; zero = alinhada; negativo = já passou.
 */
function distanceToStart(rect: BeatRect, viewportHeight: number, anchor: BeatStart): number {
  switch (anchor) {
    case 'enter':
      return rect.top - viewportHeight;
    case 'top':
      return rect.top;
    case 'center':
      return rect.top + rect.height / 2 - viewportHeight / 2;
  }
}

function distanceToEnd(rect: BeatRect, viewportHeight: number, anchor: BeatEnd): number {
  switch (anchor) {
    case 'exit':
      return rect.top + rect.height;
    case 'bottom':
      return rect.top + rect.height - viewportHeight;
    case 'center':
      return rect.top + rect.height / 2 - viewportHeight / 2;
  }
}

/**
 * Progresso do elemento na janela. Ambas as distâncias encolhem na mesma taxa
 * conforme o scroll desce, então a diferença entre elas é o tamanho da janela em
 * px e o quociente é estável.
 */
export function computeBeatProgress(
  rect: BeatRect,
  viewportHeight: number,
  options: { start: BeatStart; end: BeatEnd; margin: number },
): number {
  const toStart = distanceToStart(rect, viewportHeight, options.start) - options.margin;
  const toEnd = distanceToEnd(rect, viewportHeight, options.end) + options.margin;
  const span = toEnd - toStart;
  if (span < MIN_SPAN_PX) return toStart <= 0 ? 1 : 0;
  return clamp01(-toStart / span);
}

function getViewportHeight(): number {
  return window.innerHeight || document.documentElement.clientHeight;
}

export function createBeats(opts: BeatsOptions): Beats {
  const entries = new Set<BeatEntry>();
  let isDirty = true;
  let isDisposed = false;

  function notify(entry: BeatEntry, progress: number): void {
    const previous = entry.lastNotified;
    if (previous !== null) {
      if (progress === previous) return;
      // Os extremos são estados (fora / dentro), não ruído: sempre avisam.
      const isEdge = progress === 0 || progress === 1;
      if (!isEdge && Math.abs(progress - previous) < PROGRESS_EPSILON) return;
    }
    entry.lastNotified = progress;
    for (const listener of entry.listeners) listener(progress);
  }

  /**
   * Todos os `getBoundingClientRect()` acontecem no primeiro laço, antes de
   * qualquer escrita ou callback — um só layout por frame em vez de N.
   */
  function measure(): void {
    isDirty = false;
    if (entries.size === 0) return;
    const viewportHeight = getViewportHeight();
    const readings: Array<{ entry: BeatEntry; rect: DOMRect }> = [];
    for (const entry of entries) {
      readings.push({ entry, rect: entry.el.getBoundingClientRect() });
    }
    for (const { entry, rect } of readings) {
      entry.progress = computeBeatProgress(rect, viewportHeight, entry);
    }
    for (const { entry } of readings) {
      notify(entry, entry.progress);
    }
  }

  function flushIfDirty(): void {
    if (isDisposed || !isDirty) return;
    measure();
  }

  // A medição é mais um passo do rAF único do projeto, e só custa algo quando
  // algum evento sujou o estado.
  const unsubscribeFrame = opts.onFrame(flushIfDirty);

  function markDirty(): void {
    if (isDisposed) return;
    isDirty = true;
    opts.onDirty?.();
  }

  // Um ResizeObserver no documentElement pega o caso que quebra posições
  // cravadas: algo *acima* cresceu, moveu o beat e não redimensionou o elemento.
  const resizeObserver =
    typeof ResizeObserver === 'function' ? new ResizeObserver(markDirty) : null;
  resizeObserver?.observe(document.documentElement);

  window.addEventListener('scroll', markDirty, { passive: true });
  window.addEventListener('resize', markDirty, { passive: true });

  function isStillRegistered(el: Element): boolean {
    for (const entry of entries) {
      if (entry.el === el) return true;
    }
    return false;
  }

  function register(el: Element, options: BeatOptions = {}): Beat {
    if (isDisposed) throw new Error('createBeats: register() chamado após dispose()');
    const entry: BeatEntry = {
      el,
      start: options.start ?? 'enter',
      end: options.end ?? 'exit',
      margin: options.margin ?? 0,
      progress: 0,
      lastNotified: null,
      listeners: new Set(),
    };
    entries.add(entry);
    resizeObserver?.observe(el);
    markDirty();

    return {
      el,
      get progress(): number {
        return entry.progress;
      },
      subscribe(fn: (progress: number) => void): () => void {
        entry.listeners.add(fn);
        return () => {
          entry.listeners.delete(fn);
        };
      },
      dispose(): void {
        entry.listeners.clear();
        if (!entries.delete(entry)) return;
        if (!isStillRegistered(el)) resizeObserver?.unobserve(el);
      },
    };
  }

  function dispose(): void {
    if (isDisposed) return;
    isDisposed = true;
    unsubscribeFrame();
    resizeObserver?.disconnect();
    window.removeEventListener('scroll', markDirty);
    window.removeEventListener('resize', markDirty);
    entries.clear();
  }

  return { register, measure, dispose };
}
