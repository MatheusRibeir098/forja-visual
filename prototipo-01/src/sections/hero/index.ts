import { site } from '@/content/site';
import { DEFAULT_CURVE } from '@/shaders/thresholdMask';
import { FIELD_FOV, createFieldScene } from './sceneField';
import { createAverageScene } from './sceneAverage';
import type { Engine } from '@/engine';
import './style.css';

/**
 * F1 — Hero. Promovido da variante A da divergência (spec §3.1), escolhida pelo
 * dono; B e C ficam em `src/variants/` como registro de rejeição, fora do bundle.
 *
 * O hero abre parecendo exatamente o site que uma IA gera: gradiente roxo→azul,
 * badge, headline centralizada, dois botões, três cards. Um segundo depois a
 * máscara de threshold come essa imagem e revela o site real por baixo — chapa
 * escura, campo de limalha de ferro e o título em serifa oversized, rente à
 * esquerda. A tese do projeto é o próprio ato de abertura: o visitante
 * reconhece a média antes de ler uma palavra sobre ela.
 *
 * **Quem desenha:** o motor tem um `composite` só, e a seção que está com a
 * tela na mão o reclama no seu próprio quadro (`setLayers` + `render`). O hero
 * desenha enquanto qualquer parte dele está visível; assim que o rodapé dele
 * passa do topo da viewport, ele para e a próxima seção assume. Duas seções
 * nunca desenham no mesmo quadro — e no quadro exato da troca, a F2 abre na
 * mesma cena que o hero deixou, então a passagem não tem emenda.
 *
 * **Onde desenha:** só no retângulo do próprio hero, via `scissor` (a regra do
 * canvas está escrita em `main.ts`). O `composite` desenha um quad de tela
 * inteira, então sem o recorte o hero pintaria por cima das seções de baixo
 * enquanto sai — inclusive do texto delas. O recorte vale apenas para os
 * passes que vão à **tela**: o `three` usa `renderTarget.scissor` quando há um
 * render target ligado, então as duas camadas continuam sendo renderizadas
 * inteiras nos FBOs, que é o que a máscara precisa amostrar.
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

export interface SectionHandle {
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

/** Menor altura de seção aceita — 0 zeraria o recorte antes da primeira medida. */
const MIN_SECTION_PX = 1;

function applyReveal(reveal: Reveal, curved: number): void {
  const span = reveal.end - reveal.start;
  const raw = span > 0 ? (curved - reveal.start) / span : 1;
  const quantized = Math.round(clamp01(raw) / REVEAL_STEP) * REVEAL_STEP;
  if (quantized === reveal.applied) return;
  reveal.applied = quantized;
  reveal.element.style.setProperty('--hero-reveal', quantized.toFixed(3));
}

interface HeroDom {
  stage: HTMLElement;
  block: HTMLElement;
  replay: HTMLButtonElement;
  reveals: Reveal[];
}

function buildDom(root: HTMLElement, animated: boolean): HeroDom {
  const stage = createElement('div', 'hero-stage');
  const block = createElement('div', 'hero-block');

  const index = createElement('p', 'hero-index t-mono hero-reveal', SECTION_INDEX);
  const title = createElement('h1', 'hero-title t-display hero-reveal', site.title);
  // O `index.html` aponta `aria-labelledby` para este id; a seção substitui o
  // placeholder, então precisa reassumir o rótulo da seção.
  title.id = 'hero-title';
  const rule = createElement('div', 'hero-rule');
  const lines = createElement('div', 'hero-lines');
  const tagline = createElement('p', 'hero-tagline hero-reveal', site.tagline);
  const goal = createElement('p', 'hero-goal hero-reveal', site.sucesso);
  const replay = createElement('button', 'hero-replay hero-reveal', LABEL_REPLAY);
  replay.type = 'button';

  lines.append(tagline, goal);
  block.append(index, title, rule, lines, replay);
  stage.append(block);
  // Troca o conteúdo estático do `index.html` (o placeholder que existe para a
  // página fazer sentido sem JS) pelo palco de verdade.
  root.replaceChildren(stage);

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
    replay.style.setProperty('--hero-reveal', '1');
  }

  return { stage, block, replay, reveals };
}

/** Medida do bloco de texto que só muda em resize ou troca de fonte. */
interface BlockBox {
  left: number;
  width: number;
  height: number;
}

export function mountSection(root: HTMLElement, engine: Engine): SectionHandle {
  const { gl, ticker, beats, pointer, composite, reducedMotion } = engine;
  const { renderer } = gl;
  const animated = !reducedMotion;

  root.classList.add('hero-root');
  const { stage, block, replay, reveals } = buildDom(root, animated);

  const average = createAverageScene();
  const field = createFieldScene(gl.tier, animated);

  /**
   * Enquanto o rodapé do hero não passa do topo da viewport, a tela é dele.
   * `start: 'top'` + `end: 'exit'` faz o progresso ir de 0 (hero encostado no
   * topo) a 1 (hero inteiro acima da viewport) — 1 é exatamente o instante em
   * que a próxima seção passa a cobrir a tela.
   */
  const exitBeat = beats.register(root, { start: 'top', end: 'exit' });

  /**
   * Beat do bloco de texto. A janela 'enter'→'exit' cobre todo o tempo em que
   * ele está visível e é **linear no scroll**, então dá para inverter e obter a
   * posição do bloco sem ler layout dentro do quadro (ver `applySafeArea`).
   */
  const blockBeat = beats.register(block, { start: 'enter', end: 'exit' });

  const box: BlockBox = { left: 0, width: 0, height: 0 };

  /**
   * Altura do hero, em px. Vem de um `ResizeObserver`, nunca do quadro: o
   * retângulo de recorte é **derivado** dela mais o progresso do beat, e ler
   * layout dentro do ticker seria reflow forçado (as seções que rodam antes já
   * escreveram no DOM).
   */
  let sectionHeight = MIN_SECTION_PX;
  /** Aspecto da viewport, atualizado no resize e lido por quadro pela câmera. */
  let aspect = 1;

  /** Sob movimento reduzido a timeline já nasce no fim: nada anima sozinho. */
  let clock = animated ? 0 : TIMELINE_END_S;
  let showingAverage = false;
  let animatingFlag: boolean | null = null;
  let disposed = false;

  function measureBlock(): void {
    if (disposed) return;
    const rect = block.getBoundingClientRect();
    box.left = rect.left;
    box.width = rect.width;
    box.height = rect.height;
  }

  /**
   * Reserva no campo de limalha a área escurecida atrás do texto.
   *
   * O retângulo é reconstruído a cada quadro a partir do beat, e não medido no
   * resize: o hero **rola junto com a página**, e uma medida presa ao resize
   * deixaria a mancha escura parada no meio da tela enquanto o texto sobe.
   * Como a janela do beat vai de 'enter' a 'exit', o vão dela é `vh + altura` e
   * `progress = (vh - top) / (vh + altura)`; invertendo, `top` sai de graça.
   */
  function applySafeArea(): void {
    const { w, h } = gl.size;
    const top = h - blockBeat.progress * (h + box.height);
    field.setSafeArea({ left: box.left, top, width: box.width, height: box.height }, w, h);
  }

  function applyViewport(): void {
    aspect = gl.size.h > 0 ? gl.size.w / gl.size.h : 1;
    average.setAspect(aspect);
    field.resize(gl.size.w, gl.size.h);
    measureBlock();
    applySafeArea();
    // Em `demand` (movimento reduzido) ninguém agendaria o quadro do redesenho.
    ticker.invalidate();
  }

  const stopResize = gl.onResize(applyViewport);
  applyViewport();

  const sectionObserver = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (entry === undefined) return;
    sectionHeight = Math.max(entry.contentRect.height, MIN_SECTION_PX);
  });
  sectionObserver.observe(root);

  // A caixa do texto depende da métrica da fonte de display; medir antes de ela
  // carregar reservaria uma área menor que o título final.
  void document.fonts.ready.then(() => {
    measureBlock();
    ticker.invalidate();
  });

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

  /**
   * Desenha o composite recortado no retângulo do hero.
   *
   * O rodapé sai da inversão do beat: a janela `top`→`exit` mede exatamente a
   * altura da seção, então `progress` 0 põe o rodapé em `sectionHeight` e 1 o
   * põe em 0. O topo é sempre o topo da viewport — o hero é a primeira seção do
   * documento e nunca começa abaixo dela.
   */
  function drawClipped(): void {
    const canvasHeight = gl.size.h;
    const bottom = Math.round(
      Math.min(canvasHeight, sectionHeight * (1 - exitBeat.progress)),
    );
    if (bottom <= 0) return;

    const previousScissorTest = renderer.getScissorTest();
    renderer.setScissorTest(true);
    renderer.setScissor(0, canvasHeight - bottom, gl.size.w, bottom);
    composite.render();
    renderer.setScissorTest(previousScissorTest);
  }

  const stopTicker = ticker.subscribe((dt, elapsed) => {
    // Fora da tela o hero não desenha nem escreve no DOM: o relógio dele fica
    // onde parou e a seção seguinte é dona do canvas.
    if (exitBeat.progress >= 1) return;

    if (animated) clock = Math.min(clock + dt, TIMELINE_END_S);

    // `pointer.setCamera` é estado global do motor: outra seção com câmera
    // própria pode tê-lo mudado no último resize. Reafirmar aqui, no quadro em
    // que o raio é lido, faz a ordem de montagem parar de importar. Custa um
    // `tan` — menos que o `if` que perguntaria se mudou.
    pointer.setCamera(FIELD_FOV, aspect);

    const progress = clamp01((clock - AVERAGE_HOLD_S) / WIPE_DURATION_S);

    // Nos extremos o composite desenha uma camada direto na tela, e aí ela
    // precisa entregar sRGB em vez de linear (ver `setDirectToScreen`).
    average.setDirectToScreen(progress <= 0);
    field.setDirectToScreen(progress >= 1);
    applySafeArea();
    field.update(dt, elapsed, pointer);

    const curved = Math.pow(progress, DEFAULT_CURVE);
    for (const reveal of reveals) applyReveal(reveal, curved);

    const animating = progress > 0 && progress < 1;
    if (animating !== animatingFlag) {
      animatingFlag = animating;
      stage.dataset['animating'] = String(animating);
    }

    composite.setLayers(average, field);
    composite.progress = progress;
    drawClipped();
  });

  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      stopTicker();
      stopResize();
      sectionObserver.disconnect();
      exitBeat.dispose();
      blockBeat.dispose();
      replay.removeEventListener('click', handleReplay);
      stage.remove();
      root.classList.remove('hero-root');
      average.dispose();
      field.dispose();
    },
  };
}
