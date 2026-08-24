import { site } from '@/content/site';
import { DEFAULT_CURVE } from '@/shaders/thresholdMask';
import { FIELD_FOV, createFieldScene } from './sceneField';
import { createAverageScene } from './sceneAverage';
import type { Engine } from '@/engine';
import './style.css';

/**
 * Variante A — **"A Média"**.
 *
 * O hero abre parecendo exatamente o site que uma IA gera: gradiente roxo→azul,
 * badge, headline centralizada, dois botões, três cards. Um segundo depois a
 * máscara de threshold come essa imagem e revela o site real por baixo — chapa
 * escura, campo de limalha de ferro e o título em serifa oversized, rente à
 * esquerda. A tese do projeto é o próprio ato de abertura: o visitante
 * reconhece a média antes de ler uma palavra sobre ela.
 *
 * Quem chama é dono do quadro: `mountHero` inscreve **só** a atualização de
 * estado no ticker e nunca chama `composite.render()`. O caller deve se
 * inscrever depois, para que o render aconteça com o progresso já do quadro.
 */

// ---------------------------------------------------------------------------
// Timeline (em segundos — tempo, não scroll: a tese precisa ser vista de cara)
// ---------------------------------------------------------------------------

/**
 * Quanto tempo a média fica intacta antes de ser destruída. 0.6 s é o mínimo
 * para o olho identificar o padrão (badge + headline + cards) e ainda curto o
 * bastante para não parecer que o site travou naquela tela.
 */
const AVERAGE_HOLD_S = 0.6;

/**
 * Duração da varredura da máscara. 1.5 s: abaixo de ~1.2 s a destruição vira
 * corte e o visitante não vê *o que* foi destruído; acima de ~1.8 s ele já
 * entendeu e começa a esperar.
 */
const WIPE_DURATION_S = 1.5;

const TIMELINE_END_S = AVERAGE_HOLD_S + WIPE_DURATION_S;

/**
 * Janelas de revelação de cada linha de texto, em espaço **curvado**: o mesmo
 * `pow(progress, DEFAULT_CURVE)` que o shader da máscara aplica. Assim a borda
 * do texto acelera junto com a borda da máscara, em vez de correr num ritmo
 * próprio. Todas começam depois de 0.2 porque o texto mora embaixo, e a máscara
 * varre de cima-esquerda para baixo-direita: ele só aparece depois que ela passou.
 */
const REVEAL_WINDOWS = {
  index: { start: 0.22, end: 0.46 },
  title: { start: 0.3, end: 0.7 },
  rule: { start: 0.48, end: 0.78 },
  tagline: { start: 0.55, end: 0.86 },
  goal: { start: 0.62, end: 0.92 },
  replay: { start: 0.85, end: 1 },
} as const;

/**
 * Passo de quantização da revelação. 1/200 é ~0.4 px de deslocamento da borda
 * num título de 15 rem — invisível — e corta em ~3x as escritas de custom
 * property por quadro.
 */
const REVEAL_STEP = 1 / 200;

const LABEL_REPLAY = 'ver a média de novo';
const LABEL_BACK = 'voltar ao específico';

/** Rótulo de seção. O par número/nome é o que uma capa de estúdio traz, não um breadcrumb. */
const SECTION_INDEX = '01 — a média';

// ---------------------------------------------------------------------------

interface Reveal {
  element: HTMLElement;
  start: number;
  end: number;
  applied: number;
}

export interface HeroHandle {
  dispose(): void;
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function applyReveal(reveal: Reveal, curved: number): void {
  const span = reveal.end - reveal.start;
  const raw = span > 0 ? (curved - reveal.start) / span : 1;
  const quantized = Math.round(clamp01(raw) / REVEAL_STEP) * REVEAL_STEP;
  if (quantized === reveal.applied) return;
  reveal.applied = quantized;
  reveal.element.style.setProperty('--va-reveal', quantized.toFixed(3));
}

interface HeroDom {
  stage: HTMLElement;
  block: HTMLElement;
  replay: HTMLButtonElement;
  reveals: Reveal[];
}

function buildDom(root: HTMLElement, animated: boolean): HeroDom {
  const stage = createElement('div', 'va-stage');
  const block = createElement('div', 'va-block');

  const index = createElement('p', 'va-index t-mono va-reveal', SECTION_INDEX);
  const title = createElement('h1', 'va-title t-display va-reveal', site.title);
  const rule = createElement('div', 'va-rule');
  const lines = createElement('div', 'va-lines');
  const tagline = createElement('p', 'va-tagline va-reveal', site.tagline);
  const goal = createElement('p', 'va-goal va-reveal', site.sucesso);
  const replay = createElement('button', 'va-replay va-reveal', LABEL_REPLAY);
  replay.type = 'button';

  lines.append(tagline, goal);
  block.append(index, title, rule, lines, replay);
  stage.append(block);
  root.append(stage);

  const reveals: Reveal[] = [
    { element: index, ...REVEAL_WINDOWS.index, applied: -1 },
    { element: title, ...REVEAL_WINDOWS.title, applied: -1 },
    { element: rule, ...REVEAL_WINDOWS.rule, applied: -1 },
    { element: tagline, ...REVEAL_WINDOWS.tagline, applied: -1 },
    { element: goal, ...REVEAL_WINDOWS.goal, applied: -1 },
  ];

  if (animated) {
    reveals.push({ element: replay, ...REVEAL_WINDOWS.replay, applied: -1 });
  } else {
    // Sob movimento reduzido o botão vira um interruptor entre a média e o
    // específico: se ele fosse revelado pelo progresso, ficaria recortado
    // justamente no estado em que é o único jeito de voltar.
    replay.style.setProperty('--va-reveal', '1');
  }

  return { stage, block, replay, reveals };
}

export function mountHero(root: HTMLElement, engine: Engine): HeroHandle {
  const { gl, ticker, pointer, composite, reducedMotion } = engine;
  const animated = !reducedMotion;

  root.classList.add('va-root');
  const { stage, block, replay, reveals } = buildDom(root, animated);

  const average = createAverageScene();
  const field = createFieldScene(gl.tier, animated);
  composite.setLayers(average, field);

  /** Sob movimento reduzido a timeline já nasce no fim: nada anima sozinho. */
  let clock = animated ? 0 : TIMELINE_END_S;
  let showingAverage = false;
  let animatingFlag: boolean | null = null;
  let disposed = false;

  function measureSafeArea(): void {
    if (disposed) return;
    const rect = block.getBoundingClientRect();
    field.setSafeArea(rect, gl.size.w, gl.size.h);
  }

  function applyViewport(): void {
    const aspect = gl.size.h > 0 ? gl.size.w / gl.size.h : 1;
    average.setAspect(aspect);
    field.resize(gl.size.w, gl.size.h);
    // Sem isto o raio do cursor fica esticado em X assim que a tela deixa de
    // ser quadrada, e o ímã reage fora do lugar.
    pointer.setCamera(FIELD_FOV, aspect);
    measureSafeArea();
    // Em `demand` (movimento reduzido) ninguém agendaria o quadro do redesenho.
    ticker.invalidate();
  }

  const stopResize = gl.onResize(applyViewport);
  applyViewport();

  // A caixa do texto depende da métrica da fonte de display; medir antes de ela
  // carregar reservaria uma área menor que o título final.
  void document.fonts.ready.then(measureSafeArea);

  function handleReplay(): void {
    if (animated) {
      clock = 0;
    } else {
      showingAverage = !showingAverage;
      clock = showingAverage ? 0 : TIMELINE_END_S;
      replay.textContent = showingAverage ? LABEL_BACK : LABEL_REPLAY;
      stage.dataset['average'] = String(showingAverage);
    }
    ticker.invalidate();
  }

  replay.addEventListener('click', handleReplay);

  const stopTicker = ticker.subscribe((dt, elapsed) => {
    if (animated) clock = Math.min(clock + dt, TIMELINE_END_S);

    const progress = clamp01((clock - AVERAGE_HOLD_S) / WIPE_DURATION_S);
    composite.progress = progress;

    // Nos extremos o composite desenha uma camada direto na tela, e aí ela
    // precisa entregar sRGB em vez de linear (ver `setDirectToScreen`).
    average.setDirectToScreen(progress <= 0);
    field.setDirectToScreen(progress >= 1);
    field.update(dt, elapsed, pointer);

    const curved = Math.pow(progress, DEFAULT_CURVE);
    for (const reveal of reveals) applyReveal(reveal, curved);

    const animating = progress > 0 && progress < 1;
    if (animating !== animatingFlag) {
      animatingFlag = animating;
      stage.dataset['animating'] = String(animating);
    }
  });

  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      stopTicker();
      stopResize();
      replay.removeEventListener('click', handleReplay);
      stage.remove();
      root.classList.remove('va-root');
      average.dispose();
      field.dispose();
    },
  };
}
