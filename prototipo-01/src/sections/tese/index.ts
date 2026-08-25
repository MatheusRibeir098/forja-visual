import { site } from '@/content/site';
import { tese } from '@/content/tese';
// A F2 é, por definição da spec (§3, F2), a mesma cena da variante vencedora
// contra a caricatura do hero médio. Importar os construtores de cena do hero é
// deliberado: não é estado nem layout compartilhado — são dois builders de
// three.js sem DOM, e reimplementá-los aqui daria duas verdades sobre o mesmo
// material. Cada seção instancia os seus: no quadro da troca de tela as duas
// precisam de `setDirectToScreen` independentes.
import { createAverageScene } from '@/sections/hero/sceneAverage';
import { FIELD_FOV, createFieldScene } from '@/sections/hero/sceneField';
import type { Engine } from '@/engine';
import './style.css';

/**
 * F2 — A Tese: "por que sites de IA parecem iguais".
 *
 * Mesma técnica do hero (I.1 composite + III.1 máscara de threshold) em outro
 * registro. No hero a máscara corre no **tempo** e destrói a média sozinha; aqui
 * ela corre no **scroll** — o beat ancorado no DOM (V.2) é o único motor, e o
 * usuário pode parar no meio, voltar e ver a borda desandar.
 *
 * **Direção da transição.** A camada A é "o específico" (o campo de limalha que
 * o hero deixou na tela) e a B é "a média" (a caricatura do hero genérico). Ou
 * seja: quanto mais o visitante rola, mais a página *desaba* para a média,
 * terminando exatamente sobre o parágrafo que diz que é para lá que tudo tende
 * sozinho. A ordem inversa (média → específico) repetiria o gesto do hero e
 * ainda abriria com um corte, porque o hero entrega a tela no específico e a F2
 * começa de onde ele parou — no quadro da troca as duas seções desenham a mesma
 * cena, com o mesmo relógio e a mesma câmera, e a passagem não tem emenda.
 *
 * O texto **não** entra no canvas nem depende dele para ser lido: cada bloco
 * mora numa chapa opaca da cor do fundo da cena, então o contraste é o mesmo
 * com a máscara em 0, em 0,5 ou em 1.
 *
 * ── ONDE ESTA SEÇÃO DESENHA ────────────────────────────────────────────────
 * Só dentro do **próprio retângulo**, via `scissor` (a regra do canvas está em
 * `main.ts`). O `composite` termina num quad de tela inteira; sem o recorte, a
 * F2 pintaria por cima das seções vizinhas. O recorte só afeta os passes que
 * vão à tela — com um render target ligado o `three` usa `renderTarget.scissor`,
 * então as duas camadas continuam inteiras nos FBOs que a máscara amostra.
 *
 * E a seção desenha **enquanto estiver visível**, não só durante a janela da
 * máscara: fora dela o progresso está cravado em 0 (o campo, igual ao que o
 * hero deixou) ou em 1 (a média), e é justamente esse pedaço que costura a
 * passagem com o hero. Se ela só desenhasse na janela, a faixa entre o rodapé
 * do hero e o topo da F2 ficaria sem dono — e sem dono, no canvas opaco deste
 * projeto, quer dizer preta.
 */

const SECTION_ID = 'tese';

/** Dois dígitos: a numeração da capa é `02`, nunca `2`. */
const MARK_DIGITS = 2;

/**
 * Passo de quantização do progresso escrito no DOM. 1/200 sobre a régua de
 * 40vh do medidor dá ~1,4 px de deslocamento em 720 de altura — abaixo do que
 * o olho separa — e corta as escritas de custom property por quadro.
 */
const METER_STEP = 1 / 200;

export interface SectionHandle {
  dispose(): void;
}

/** Menor altura de seção aceita — 0 zeraria o recorte antes da primeira medida. */
const MIN_SECTION_PX = 1;

/**
 * Y de um retângulo CSS (origem em cima) no sistema do WebGL (origem embaixo),
 * que é o que `setScissor` espera.
 */
function toGlBottom(topPx: number, heightPx: number, canvasHeightPx: number): number {
  return canvasHeightPx - (topPx + heightPx);
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

/**
 * `02 — A tese`, derivado da posição da seção em `site.sections`. Nada de
 * número cravado: se a ordem do documento mudar, a capa muda junto.
 */
function sectionMark(id: string): string {
  const index = site.sections.findIndex((section) => section.id === id);
  const entry = site.sections[index];
  if (entry === undefined) throw new Error(`forja/tese: "${id}" ausente em site.sections`);
  return `${String(index + 1).padStart(MARK_DIGITS, '0')} — ${entry.label}`;
}

/** Rótulo e medidor: a régua mostra quanto da página já virou média. */
function buildRail(): HTMLElement {
  const rail = createElement('div', 'tese-rail');
  const mark = createElement('p', 'tese-mark t-mono', sectionMark(SECTION_ID));

  const meter = createElement('div', 'tese-meter');
  // O medidor é a mesma informação da máscara, em forma de régua: quem lê o
  // texto não precisa dele, então ele sai da árvore de acessibilidade.
  meter.setAttribute('aria-hidden', 'true');
  meter.append(createElement('div', 'tese-meter-fill'));

  rail.append(mark, meter);
  return rail;
}

function buildQuote(): HTMLElement {
  const figure = createElement('figure', 'tese-plate tese-quote');
  const block = document.createElement('blockquote');
  block.cite = tese.quote.url;
  // A citação é em inglês no original; traduzir mudaria a prova.
  block.lang = 'en';
  block.append(createElement('p', 't-quote', tese.quote.text));

  const caption = createElement('figcaption', 'tese-cite');
  const link = document.createElement('a');
  link.href = tese.quote.url;
  link.rel = 'noreferrer';
  link.textContent = tese.quote.author;
  caption.append(link);

  figure.append(block, caption);
  return figure;
}

function buildColumn(): HTMLElement {
  const column = createElement('div', 'tese-column');

  const title = createElement('h2', 'tese-title t-title', tese.title);
  // O `index.html` aponta `aria-labelledby` para este id; a seção troca o
  // conteúdo do placeholder, então precisa reassumir o rótulo.
  title.id = `${SECTION_ID}-title`;
  const titlePlate = createElement('div', 'tese-plate tese-plate--title');
  titlePlate.append(title);
  column.append(titlePlate);

  for (const paragraph of tese.paragraphs) {
    const plate = createElement('div', 'tese-plate');
    plate.append(createElement('p', 't-body', paragraph));
    column.append(plate);
  }

  column.append(buildQuote());

  const corollary = createElement('div', 'tese-plate tese-corollary');
  corollary.append(
    createElement('h3', 't-subheading', tese.corollary.title),
    createElement('p', 't-body', tese.corollary.body),
  );
  column.append(corollary);

  return column;
}

export function mountSection(root: HTMLElement, engine: Engine): SectionHandle {
  const { gl, ticker, beats, pointer, composite, reducedMotion } = engine;
  const { renderer } = gl;

  root.replaceChildren();
  root.classList.add('tese-root');

  const rail = buildRail();
  const meterFill = rail.querySelector<HTMLElement>('.tese-meter-fill');
  root.append(rail, buildColumn());

  const field = createFieldScene(gl.tier, !reducedMotion);
  const average = createAverageScene();

  // Sem reserva de área escura atrás do texto: as chapas são opacas, o campo
  // não precisa abrir espaço para elas.
  field.setSafeArea(null, gl.size.w, gl.size.h);

  /**
   * A janela do beat é exatamente o tempo em que a seção cobre a viewport
   * inteira: `start: 'top'` fecha o momento em que o topo dela encosta no topo
   * da tela (o mesmo instante em que o hero termina de sair) e `end: 'bottom'`,
   * o momento em que o rodapé dela encosta no fundo. Fora dessa janela existe
   * outra seção na tela, e o canvas é dela.
   */
  const maskBeat = beats.register(root, { start: 'top', end: 'bottom' });

  /**
   * Segundo beat, só para o recorte: `enter`→`exit` cobre **todo** o tempo em
   * que a seção tem um pixel na tela e é linear no scroll, então dá para
   * invertê-lo e obter o topo da seção sem ler layout dentro do quadro. A janela
   * vale `altura + viewport`, logo `top = V − p·(H + V)`.
   */
  const visibleBeat = beats.register(root, { start: 'enter', end: 'exit' });

  let appliedMeter = -1;
  let drawing = false;
  let disposed = false;
  /** Altura da seção, do `ResizeObserver` — nunca de um rect por quadro. */
  let sectionHeight = MIN_SECTION_PX;
  /** Aspecto da viewport, atualizado no resize e lido por quadro pela câmera. */
  let aspect = 1;

  function applyMeter(progress: number): void {
    const quantized = Math.round(progress / METER_STEP) * METER_STEP;
    if (quantized === appliedMeter || meterFill === null) return;
    appliedMeter = quantized;
    meterFill.style.setProperty('--tese-progress', quantized.toFixed(3));
  }

  function applyViewport(): void {
    aspect = gl.size.h > 0 ? gl.size.w / gl.size.h : 1;
    average.setAspect(aspect);
    field.resize(gl.size.w, gl.size.h);
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

  /**
   * Desenha o composite recortado no retângulo visível da seção. Devolve o
   * `scissorTest` como encontrou: o estado do renderer é global e a seção
   * seguinte no mesmo quadro herdaria o recorte.
   */
  function drawClipped(): void {
    const canvasHeight = gl.size.h;
    const sectionTop = canvasHeight - visibleBeat.progress * (sectionHeight + canvasHeight);
    const top = Math.max(0, Math.round(sectionTop));
    const bottom = Math.min(canvasHeight, Math.round(sectionTop + sectionHeight));
    const height = bottom - top;
    if (height <= 0) return;

    const previousScissorTest = renderer.getScissorTest();
    renderer.setScissorTest(true);
    renderer.setScissor(0, toGlBottom(top, height, canvasHeight), gl.size.w, height);
    composite.render();
    renderer.setScissorTest(previousScissorTest);
  }

  const stopTicker = ticker.subscribe((dt, elapsed) => {
    const progress = maskBeat.progress;
    applyMeter(progress);

    // Fora da tela não há retângulo para desenhar, e a cena fica exatamente
    // onde parou. `visibleBeat` é 0 antes de entrar e 1 depois de sair.
    const visible = visibleBeat.progress > 0 && visibleBeat.progress < 1;
    if (!visible) {
      drawing = false;
      return;
    }

    if (!drawing) {
      drawing = true;
      // Ao começar a desenhar, o ímã já nasce onde o cursor está: sem isto ele
      // partiria do centro e correria até lá em ~0,25 s (o damp medido em
      // `damp.test.ts`), à vista de todos — e, pior, o pedaço da tela que ainda
      // é do hero mostraria o mesmo campo em outra posição.
      field.snapToPointer(pointer);
    }

    // Estado global do motor: outra seção com câmera própria pode ter chamado
    // `setCamera` no último resize. Reafirmar no quadro em que o raio é lido faz
    // a ordem de montagem parar de importar.
    pointer.setCamera(FIELD_FOV, aspect);
    field.update(dt, elapsed, pointer);

    // Nos extremos o composite manda uma camada só direto para a tela, e aí ela
    // precisa entregar sRGB em vez de linear (ver `setDirectToScreen`).
    field.setDirectToScreen(progress <= 0);
    average.setDirectToScreen(progress >= 1);

    composite.setLayers(field, average);
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
      maskBeat.dispose();
      visibleBeat.dispose();
      root.classList.remove('tese-root');
      root.replaceChildren();
      field.dispose();
      average.dispose();
    },
  };
}
