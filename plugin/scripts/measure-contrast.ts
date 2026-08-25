/// <reference lib="dom" />
// Parte deste arquivo roda dentro da página (page.evaluate), então precisa da lib DOM em
// cima do tsconfig de Node — declarada aqui em vez de alargar o projeto inteiro.

/**
 * Contraste WCAG medido **por pixel**, a partir de screenshot — nunca dos tokens de CSS.
 *
 * Ler `--fg` contra `--bg` não prova nada: o texto senta sobre gradiente, sobre saída de
 * canvas, sobre estado de hover e atrás de blend. Então cada trecho de texto é fotografado
 * na tela e a tinta é isolada por **diferença**, não por chute de cor.
 *
 * ── Como a tinta é isolada, e por que assim ───────────────────────────────────────────
 * Para cada faixa da página tiramos três fotos idênticas em enquadramento:
 *
 *   A  — a página como está
 *   A' — a página de novo, sem mexer em nada
 *   B  — a mesma página com a tinta dos elementos daquela faixa tornada transparente
 *
 * `A − B` = exatamente os pixels que o glifo pintou. `A − A'` = os pixels que se mexeram
 * sozinhos (animação), e esses saem da conta. Daí vêm três coisas que o medidor anterior
 * não tinha:
 *
 *   1. **Texto invisível deixa de virar contraste ruim.** No protótipo 01 um parágrafo com
 *      `clip-path` fechado — zero glifo desenhado — media 2,86:1, porque o medidor pegava
 *      ruído de fundo e chamava de tinta. Aqui, zero glifo é zero diferença entre A e B:
 *      o elemento sai com status `nao-desenhado`, com a razão prevista pelo CSS ao lado,
 *      e **não reprova o build**. Um site desta ferramenta vai ter animação de revelação;
 *      isso ia acontecer de novo.
 *   2. **O fundo medido é o fundo real de debaixo do glifo** — ele está literalmente
 *      visível na foto B. Nada de "cor modal do recorte".
 *   3. **Fundo que se mexe é diagnosticado**, não medido errado: vira `fundo-instavel`.
 *
 * Por padrão a página é medida com `prefers-reduced-motion: reduce` e com as animações
 * congeladas antes das fotos. Não é conveniência: é o estado em que o site tem de ser
 * legível de qualquer forma, e é o que impede fotografar uma revelação pela metade.
 *
 *   tsx measure-contrast.ts --project=/caminho/do/site
 *   tsx measure-contrast.ts --url=http://localhost:5173 --min=7 --selectors="h1,h2,p,a"
 *
 * Argumentos: --project --url --port --dist --config --out --json
 *             --min --selectors --viewport=1280x720 --settle --reveal --shot --motion --no-freeze
 * Saídas: 0 ok · 1 abaixo do piso · 4 nada mensurável na página.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { launchRealGpu, startPreview } from './lib/chrome';
import type { Browser, BrowserContext, Page } from './lib/chrome';
import { freezePage, unfreezePage } from './lib/page-state';
import {
  argFlag,
  argNumber,
  argString,
  nowIso,
  parseArgs,
  readNumber,
  readString,
  resolveTarget,
  round,
  section,
} from './lib/config';
import { emitMeasurement } from './lib/report';
import type { Clip, ContrastMeasurement, ContrastSample, ContrastStatus } from './lib/report';

const EXIT_BELOW_FLOOR = 1;
const EXIT_NOTHING_MEASURABLE = 4;

const DEFAULT_MIN_CONTRAST = 7;
const DEFAULT_SELECTORS =
  'h1,h2,h3,h4,h5,h6,p,li,a,blockquote,figcaption,dt,dd,summary,label,button,th,td,span,strong,em,small,code';
const DEFAULT_VIEWPORT = { width: 1280, height: 720 };
const DEFAULT_SETTLE_MS = 900;
const DEFAULT_REVEAL_MS = 400;
const DEFAULT_SHOT = '.forge-visual/screenshots/contrast-worst.png';

const TEXT_SAMPLE_LENGTH = 40;
const MIN_CLIP_SIDE_PX = 4;
/** Diferença mínima por canal para um pixel contar como glifo (8 bits). */
const INK_THRESHOLD = 12;
/** Acima disso entre duas fotos idênticas, o pixel se mexeu sozinho. */
const STABLE_THRESHOLD = 6;
/** Fração de pixels instáveis a partir da qual o recorte inteiro é descartado. */
const UNSTABLE_LIMIT = 0.5;
const MIN_GLYPH_PIXELS = 24;
const MIN_GLYPH_COVERAGE = 0.004;
/** Só os pixels acima desta fração da diferença máxima entram como miolo do glifo. */
const CORE_DIFF_FRACTION = 0.6;
const MIN_CORE_PIXELS = 8;
/** Espera curta depois de mexer no estilo, para o repaint entrar na próxima foto. */
const REPAINT_MS = 40;
/** Quantos medidos mais próximos do piso entram no relatório. */
const LOWEST_REPORTED = 5;

interface Candidate {
  readonly index: number;
  readonly selector: string;
  readonly text: string;
  readonly color: string;
  /** `color: transparent` some com o glifo; `background-clip: text` exige esconder o elemento. */
  readonly hideStrategy: 'color' | 'visibility';
}

interface RectReading {
  readonly index: number;
  /** Retângulo recortado ao viewport — é o que a análise de pixel usa. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Posição e altura reais no documento, sem recorte: é com elas que a varredura rola. */
  readonly docTop: number;
  readonly docHeight: number;
  readonly fullyVisible: boolean;
}

interface AnalysisItem {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly color: string;
}

/** O que sobra de um elemento medido: o número, o recorte e onde a página estava. */
interface MeasuredEntry {
  readonly result: AnalysisResult;
  readonly clip: Clip;
  /** Rolagem no instante da foto — sem ela o print do pior caso sai de outro pedaço da página. */
  readonly scrollY: number;
}

interface AnalysisResult {
  readonly index: number;
  readonly status: ContrastStatus;
  readonly ratio: number | null;
  readonly cssRatio: number | null;
  readonly glyphCoverage: number;
}

const CANDIDATE_ATTRIBUTE = 'data-forge-contrast';

/* ────────────────────────────── código que roda na página ────────────────────────────── */
/*
 * Todas as funções abaixo são serializadas para dentro do navegador. Elas são escritas como
 * uma arrow só, sem função nomeada dentro: o tsx compila com `keepNames` do esbuild, e uma
 * função interna nomeada arrastaria um helper `__name(...)` para o código enviado à página,
 * onde ele não existe.
 */

/** Marca todo elemento que desenha texto próprio e devolve o que precisamos dele. */
const tagCandidates = (options: {
  selectors: string;
  sampleLength: number;
  attribute: string;
}): Candidate[] => {
  const found: Candidate[] = [];
  let index = 0;

  for (const element of Array.from(document.querySelectorAll(options.selectors))) {
    const ownText = Array.from(element.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent ?? '')
      .join('')
      .trim();
    if (ownText.length === 0) continue;

    const style = getComputedStyle(element);
    // `display:none` e `visibility:hidden` são as duas formas canônicas de "não existe na
    // tela". Opacidade zero NÃO é filtrada aqui de propósito: ela cai no caminho de pixel e
    // é reportada como `nao-desenhado`, que é informação, e não um contraste inventado.
    if (style.display === 'none' || style.visibility === 'hidden') continue;

    const id = element.id ? `#${element.id}` : '';
    const cls = element.classList.length > 0 ? `.${element.classList[0]}` : '';
    const clipsToText =
      style.getPropertyValue('-webkit-background-clip') === 'text' ||
      style.getPropertyValue('background-clip') === 'text';

    element.setAttribute(options.attribute, String(index));
    found.push({
      index,
      selector: `${element.tagName.toLowerCase()}${id}${cls}`,
      text: ownText.slice(0, options.sampleLength),
      color: style.color,
      hideStrategy: clipsToText ? 'visibility' : 'color',
    });
    index += 1;
  }

  return found;
};

/**
 * Retângulo dos **trechos de texto** de cada elemento, via `Range` sobre os nós de texto
 * próprios — mais justo que o retângulo do elemento e, principalmente, sem engolir a caixa
 * dos filhos, que têm cor própria e são medidos por conta.
 */
const readRects = (options: {
  indices: readonly number[];
  attribute: string;
}): RectReading[] => {
  const out: RectReading[] = [];

  for (const index of options.indices) {
    const element = document.querySelector(`[${options.attribute}="${index}"]`);
    if (element === null) continue;

    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const node of Array.from(element.childNodes)) {
      if (node.nodeType !== Node.TEXT_NODE) continue;
      if ((node.textContent ?? '').trim().length === 0) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of Array.from(range.getClientRects())) {
        if (rect.width < 1 || rect.height < 1) continue;
        left = Math.min(left, rect.left);
        top = Math.min(top, rect.top);
        right = Math.max(right, rect.right);
        bottom = Math.max(bottom, rect.bottom);
      }
    }
    if (!Number.isFinite(left) || !Number.isFinite(top)) continue;

    const clampedX = Math.max(0, Math.floor(left));
    const clampedY = Math.max(0, Math.floor(top));
    const clampedRight = Math.min(window.innerWidth, Math.ceil(right));
    const clampedBottom = Math.min(window.innerHeight, Math.ceil(bottom));

    out.push({
      index,
      x: clampedX,
      y: clampedY,
      width: clampedRight - clampedX,
      height: clampedBottom - clampedY,
      docTop: top + window.scrollY,
      docHeight: bottom - top,
      fullyVisible: top >= 0 && bottom <= window.innerHeight,
    });
  }

  return out;
};

/** Rola e devolve onde a página realmente parou — o alvo pedido pode ser clampeado. */
const scrollToOffset = (y: number): number => {
  document.documentElement.style.scrollBehavior = 'auto';
  window.scrollTo(0, Math.max(0, y));
  return window.scrollY;
};

/** Apaga a tinta dos elementos da faixa, sem mexer no layout nem no fundo deles. */
const hideInk = (options: {
  items: readonly { index: number; hideStrategy: 'color' | 'visibility' }[];
  attribute: string;
}): void => {
  for (const item of options.items) {
    const element = document.querySelector(`[${options.attribute}="${item.index}"]`);
    if (!(element instanceof HTMLElement)) continue;
    // Guarda o style inline exato para devolver depois: o site pode ter cor inline própria,
    // e um `removeProperty` cego apagaria o estilo dele em vez do nosso.
    element.setAttribute('data-forge-contrast-hidden', element.style.cssText);
    // Transição de cor pintaria a foto B no meio do caminho.
    element.style.setProperty('transition', 'none', 'important');
    if (item.hideStrategy === 'visibility') {
      element.style.setProperty('visibility', 'hidden', 'important');
    } else {
      element.style.setProperty('color', 'transparent', 'important');
      element.style.setProperty('-webkit-text-fill-color', 'transparent', 'important');
    }
  }
};

const restoreInk = (): void => {
  for (const element of Array.from(document.querySelectorAll('[data-forge-contrast-hidden]'))) {
    if (!(element instanceof HTMLElement)) continue;
    element.style.cssText = element.getAttribute('data-forge-contrast-hidden') ?? '';
    element.removeAttribute('data-forge-contrast-hidden');
  }
};

/**
 * Compara as três fotos e devolve, por elemento, a razão WCAG entre o miolo do glifo (foto
 * A) e o fundo que estava exatamente debaixo dele (foto B).
 */
const analyzeShots = async (input: {
  shotA: string;
  shotStable: string;
  shotHidden: string;
  items: readonly AnalysisItem[];
  inkThreshold: number;
  stableThreshold: number;
  unstableLimit: number;
  minGlyphPixels: number;
  minGlyphCoverage: number;
  coreDiffFraction: number;
  minCorePixels: number;
}): Promise<AnalysisResult[]> => {
  const planes: Uint8ClampedArray[] = [];
  let imageWidth = 0;
  let imageHeight = 0;
  for (const source of [input.shotA, input.shotStable, input.shotHidden]) {
    const image = new Image();
    image.src = `data:image/png;base64,${source}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) return [];
    context.drawImage(image, 0, 0);
    planes.push(context.getImageData(0, 0, canvas.width, canvas.height).data);
    imageWidth = canvas.width;
    imageHeight = canvas.height;
  }
  const [dataA, dataStable, dataHidden] = planes;
  if (dataA === undefined || dataStable === undefined || dataHidden === undefined) return [];

  // sRGB -> linear como tabela de 256 entradas: um pow() por valor de canal, não por pixel.
  const linear = new Float32Array(256);
  for (let value = 0; value < 256; value += 1) {
    const channel = value / 255;
    linear[value] =
      channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  }

  const results: AnalysisResult[] = [];
  for (const item of input.items) {
    const diffs: number[] = [];
    const inkLuminance: number[] = [];
    const paperLuminance: number[] = [];
    const allPaper: number[] = [];
    let unstable = 0;
    let total = 0;

    // O retângulo vem em px CSS e a foto é do viewport: recorta o que porventura passar da
    // borda (barra de rolagem, arredondamento) em vez de ler fora do buffer.
    const rowLimit = Math.min(item.height, imageHeight - item.y);
    const columnLimit = Math.min(item.width, imageWidth - item.x);
    for (let row = 0; row < rowLimit; row += 1) {
      for (let column = 0; column < columnLimit; column += 1) {
        const offset = ((item.y + row) * imageWidth + (item.x + column)) * 4;
        const ar = dataA[offset] ?? 0;
        const ag = dataA[offset + 1] ?? 0;
        const ab = dataA[offset + 2] ?? 0;
        const hr = dataHidden[offset] ?? 0;
        const hg = dataHidden[offset + 1] ?? 0;
        const hb = dataHidden[offset + 2] ?? 0;
        total += 1;

        const paper =
          0.2126 * (linear[hr] ?? 0) + 0.7152 * (linear[hg] ?? 0) + 0.0722 * (linear[hb] ?? 0);
        if (total % 4 === 0) allPaper.push(paper);

        const moved = Math.max(
          Math.abs(ar - (dataStable[offset] ?? 0)),
          Math.abs(ag - (dataStable[offset + 1] ?? 0)),
          Math.abs(ab - (dataStable[offset + 2] ?? 0)),
        );
        if (moved > input.stableThreshold) {
          unstable += 1;
          continue;
        }

        const painted = Math.max(Math.abs(ar - hr), Math.abs(ag - hg), Math.abs(ab - hb));
        if (painted <= input.inkThreshold) continue;
        diffs.push(painted);
        inkLuminance.push(
          0.2126 * (linear[ar] ?? 0) + 0.7152 * (linear[ag] ?? 0) + 0.0722 * (linear[ab] ?? 0),
        );
        paperLuminance.push(paper);
      }
    }

    const coverage = total === 0 ? 0 : diffs.length / total;
    allPaper.sort((a, b) => a - b);
    const paperAllMedian = allPaper[allPaper.length >> 1] ?? 0;

    const parsed = item.color.match(/[\d.]+/g) ?? [];
    const cssLuminance =
      0.2126 * (linear[Math.round(Number(parsed[0] ?? 0))] ?? 0) +
      0.7152 * (linear[Math.round(Number(parsed[1] ?? 0))] ?? 0) +
      0.0722 * (linear[Math.round(Number(parsed[2] ?? 0))] ?? 0);
    const cssRatio =
      (Math.max(cssLuminance, paperAllMedian) + 0.05) /
      (Math.min(cssLuminance, paperAllMedian) + 0.05);

    if (total > 0 && unstable / total > input.unstableLimit) {
      results.push({
        index: item.index,
        status: 'fundo-instavel',
        ratio: null,
        cssRatio,
        glyphCoverage: coverage,
      });
      continue;
    }
    if (diffs.length < input.minGlyphPixels || coverage < input.minGlyphCoverage) {
      results.push({
        index: item.index,
        status: 'nao-desenhado',
        ratio: null,
        cssRatio,
        glyphCoverage: coverage,
      });
      continue;
    }

    // Só o miolo do glifo: as bordas antialiasadas ficam entre tinta e papel e adoçariam o
    // resultado. `maxDiff` é a diferença do pixel mais puro do recorte.
    let maxDiff = 0;
    for (const diff of diffs) maxDiff = Math.max(maxDiff, diff);
    const band = maxDiff * input.coreDiffFraction;
    const coreInk: number[] = [];
    const corePaper: number[] = [];
    for (let i = 0; i < diffs.length; i += 1) {
      if ((diffs[i] ?? 0) < band) continue;
      coreInk.push(inkLuminance[i] ?? 0);
      corePaper.push(paperLuminance[i] ?? 0);
    }
    if (coreInk.length < input.minCorePixels) {
      results.push({
        index: item.index,
        status: 'amostra-insuficiente',
        ratio: null,
        cssRatio,
        glyphCoverage: coverage,
      });
      continue;
    }

    coreInk.sort((a, b) => a - b);
    corePaper.sort((a, b) => a - b);
    const inkMedian = coreInk[coreInk.length >> 1] ?? 0;
    const paperMedian = corePaper[corePaper.length >> 1] ?? 0;
    const ratio =
      (Math.max(inkMedian, paperMedian) + 0.05) / (Math.min(inkMedian, paperMedian) + 0.05);
    results.push({
      index: item.index,
      status: 'medido',
      ratio,
      cssRatio,
      glyphCoverage: coverage,
    });
  }

  return results;
};

/* ─────────────────────────────────── código de Node ─────────────────────────────────── */

interface SweepOptions {
  readonly revealMs: number;
  readonly viewportHeight: number;
  /** Congelar animações antes de fotografar. Desligar serve para diagnóstico. */
  readonly freeze: boolean;
}

/** Uma parada da varredura: fotografa a faixa atual e devolve o que deu para medir nela. */
async function measureStep(
  page: Page,
  candidates: ReadonlyMap<number, Candidate>,
  rects: readonly RectReading[],
): Promise<{ results: AnalysisResult[]; clips: Map<number, Clip> }> {
  const items: AnalysisItem[] = [];
  const clips = new Map<number, Clip>();
  for (const rect of rects) {
    const candidate = candidates.get(rect.index);
    if (candidate === undefined) continue;
    items.push({
      index: rect.index,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      color: candidate.color,
    });
    clips.set(rect.index, { x: rect.x, y: rect.y, width: rect.width, height: rect.height });
  }
  if (items.length === 0) return { results: [], clips };

  const shotA = (await page.screenshot()).toString('base64');
  const shotStable = (await page.screenshot()).toString('base64');

  await page.evaluate(hideInk, {
    items: items.map((item) => ({
      index: item.index,
      hideStrategy: candidates.get(item.index)?.hideStrategy ?? 'color',
    })),
    attribute: CANDIDATE_ATTRIBUTE,
  });
  await page.waitForTimeout(REPAINT_MS);
  const shotHidden = (await page.screenshot()).toString('base64');
  await page.evaluate(restoreInk);

  const results = await page.evaluate(analyzeShots, {
    shotA,
    shotStable,
    shotHidden,
    items,
    inkThreshold: INK_THRESHOLD,
    stableThreshold: STABLE_THRESHOLD,
    unstableLimit: UNSTABLE_LIMIT,
    minGlyphPixels: MIN_GLYPH_PIXELS,
    minGlyphCoverage: MIN_GLYPH_COVERAGE,
    coreDiffFraction: CORE_DIFF_FRACTION,
    minCorePixels: MIN_CORE_PIXELS,
  });
  return { results, clips };
}

/**
 * Varre a página de cima para baixo. Cada parada centraliza o primeiro elemento ainda não
 * medido e aproveita a mesma trinca de fotos para **todos** os que couberem na tela ali —
 * três screenshots por faixa, não por elemento.
 */
async function sweep(
  page: Page,
  candidates: ReadonlyMap<number, Candidate>,
  order: readonly RectReading[],
  options: SweepOptions,
): Promise<Map<number, MeasuredEntry>> {
  const measured = new Map<number, MeasuredEntry>();
  const pending = new Set(order.map((rect) => rect.index));

  for (const anchor of order) {
    if (!pending.has(anchor.index)) continue;

    if (options.freeze) await page.evaluate(unfreezePage);
    // Centraliza pela altura REAL do elemento: a altura recortada de uma leitura feita com
    // ele fora da tela é negativa e mandaria a rolagem para o lugar errado.
    const scrollY = await page.evaluate(
      scrollToOffset,
      anchor.docTop - (options.viewportHeight - anchor.docHeight) / 2,
    );
    await page.waitForTimeout(options.revealMs);
    if (options.freeze) await page.evaluate(freezePage);

    const visible = (
      await page.evaluate(readRects, { indices: [...pending], attribute: CANDIDATE_ATTRIBUTE })
    ).filter(
      (rect) =>
        (rect.fullyVisible || rect.index === anchor.index) &&
        rect.width >= MIN_CLIP_SIDE_PX &&
        rect.height >= MIN_CLIP_SIDE_PX,
    );

    const { results, clips } = await measureStep(page, candidates, visible);
    for (const result of results) {
      const clip = clips.get(result.index);
      if (clip === undefined) continue;
      measured.set(result.index, { result, clip, scrollY });
      pending.delete(result.index);
    }

    // O elemento âncora sai da fila mesmo se não deu para medir (maior que a tela, por
    // exemplo): senão a varredura volta para ele para sempre.
    pending.delete(anchor.index);
  }

  if (options.freeze) await page.evaluate(unfreezePage);
  return measured;
}

function toSample(candidate: Candidate, result: AnalysisResult, clip: Clip): ContrastSample {
  return {
    selector: candidate.selector,
    text: candidate.text,
    status: result.status,
    ratio: result.ratio === null ? null : round(result.ratio),
    cssRatio: result.cssRatio === null ? null : round(result.cssRatio),
    glyphCoverage: round(result.glyphCoverage, 4),
    clip,
  };
}

function parseViewport(raw: string | undefined): { width: number; height: number } {
  if (raw === undefined) return DEFAULT_VIEWPORT;
  const match = /^(\d+)x(\d+)$/.exec(raw.trim());
  if (match === null) throw new Error(`--viewport=${raw}: use o formato 1280x720.`);
  return { width: Number(match[1]), height: Number(match[2]) };
}

function printNotDrawn(samples: readonly ContrastSample[], floor: number): void {
  if (samples.length === 0) return;
  console.info(
    `\n  ${samples.length} elemento(s) com texto no DOM e nenhum glifo na tela — ` +
      'não reprovam (não há pixel para medir), mas veja se deveriam estar visíveis:',
  );
  for (const sample of samples.slice(0, 10)) {
    const prediction =
      sample.cssRatio === null
        ? ''
        : ` · CSS prevê ${sample.cssRatio.toFixed(2)}:1${sample.cssRatio < floor ? ' ⚠ abaixo do piso quando aparecer' : ''}`;
    console.info(`    ${sample.selector} — "${sample.text}"${prediction}`);
  }
}

async function measurePage(
  browser: Browser,
  url: string,
  options: {
    viewport: { width: number; height: number };
    selectors: string;
    settleMs: number;
    revealMs: number;
    reducedMotion: boolean;
    freeze: boolean;
  },
): Promise<{
  samples: ContrastSample[];
  /** Rolagem em que cada amostra foi fotografada, para reproduzir o enquadramento. */
  scrollOf: ReadonlyMap<ContrastSample, number>;
  candidates: number;
  page: Page;
  context: BrowserContext;
}> {
  const context = await browser.newContext({
    viewport: options.viewport,
    deviceScaleFactor: 1,
    reducedMotion: options.reducedMotion ? 'reduce' : 'no-preference',
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(options.settleMs);

  const candidates = await page.evaluate(tagCandidates, {
    selectors: options.selectors,
    sampleLength: TEXT_SAMPLE_LENGTH,
    attribute: CANDIDATE_ATTRIBUTE,
  });
  const byIndex = new Map(candidates.map((candidate) => [candidate.index, candidate]));

  const order = (
    await page.evaluate(readRects, {
      indices: candidates.map((candidate) => candidate.index),
      attribute: CANDIDATE_ATTRIBUTE,
    })
  ).sort((a, b) => a.docTop - b.docTop);

  const measured = await sweep(page, byIndex, order, {
    revealMs: options.revealMs,
    viewportHeight: options.viewport.height,
    freeze: options.freeze,
  });

  const samples: ContrastSample[] = [];
  const scrollOf = new Map<ContrastSample, number>();
  for (const [index, entry] of measured) {
    const candidate = byIndex.get(index);
    if (candidate === undefined) continue;
    const sample = toSample(candidate, entry.result, entry.clip);
    samples.push(sample);
    scrollOf.set(sample, entry.scrollY);
  }
  return { samples, scrollOf, candidates: candidates.length, page, context };
}

async function saveWorstShot(
  page: Page,
  worst: ContrastSample,
  scrollY: number,
  path: string,
): Promise<void> {
  try {
    await page.evaluate(scrollToOffset, scrollY);
    const shot = await page.screenshot({ clip: worst.clip });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, shot);
    console.info(`  print        ${path}`);
  } catch (cause) {
    console.warn(`  aviso: não consegui salvar o print do pior caso — ${String(cause)}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const target = resolveTarget(args);
  const config = section(target.config, 'contrast');

  const floor = argNumber(args, 'min') ?? readNumber(config, 'min') ?? DEFAULT_MIN_CONTRAST;
  const selectors =
    argString(args, 'selectors') ?? readString(config, 'selectors') ?? DEFAULT_SELECTORS;
  const viewport = parseViewport(argString(args, 'viewport') ?? readString(config, 'viewport'));
  const settleMs =
    argNumber(args, 'settle') ?? readNumber(config, 'settleMs') ?? DEFAULT_SETTLE_MS;
  const revealMs =
    argNumber(args, 'reveal') ?? readNumber(config, 'revealMs') ?? DEFAULT_REVEAL_MS;
  const shotPath = resolve(
    target.projectRoot,
    argString(args, 'shot') ?? readString(config, 'shot') ?? DEFAULT_SHOT,
  );
  // `--motion` desliga o padrão de medir com reduced-motion; `--no-freeze` desliga o
  // congelamento das animações (serve para ver se um fundo é mesmo instável).
  const reducedMotion = argFlag(args, 'motion') !== true;
  const freeze = argFlag(args, 'freeze') ?? true;

  const preview = await startPreview({
    projectRoot: target.projectRoot,
    url: target.url,
    port: target.port,
    command: target.previewCommand,
  });
  const { browser, renderer } = await launchRealGpu({ projectRoot: target.projectRoot });

  try {
    const measurement = await measurePage(browser, preview.url, {
      viewport,
      selectors,
      settleMs,
      revealMs,
      reducedMotion,
      freeze,
    });

    const measured = measurement.samples.filter((sample) => sample.status === 'medido');
    const notDrawn = measurement.samples.filter((sample) => sample.status === 'nao-desenhado');
    const unstable = measurement.samples.filter((sample) => sample.status === 'fundo-instavel');
    const worst = measured.reduce<ContrastSample | null>(
      (lowest, sample) =>
        lowest === null || (sample.ratio ?? Infinity) < (lowest.ratio ?? Infinity)
          ? sample
          : lowest,
      null,
    );
    const minContrast = worst?.ratio ?? 0;
    const lowest = [...measured]
      .sort((a, b) => (a.ratio ?? Infinity) - (b.ratio ?? Infinity))
      .slice(0, LOWEST_REPORTED);

    const report: ContrastMeasurement = {
      minContrast,
      floor,
      worst,
      lowest,
      measured: measured.length,
      candidates: measurement.candidates,
      notDrawn,
      unstable,
      renderer,
      viewport: `${viewport.width}x${viewport.height}`,
      measuredAt: nowIso(),
    };
    emitMeasurement('contrast', report, target);

    console.info(`\ncontraste (por pixel, ${viewport.width}x${viewport.height})`);
    if (target.configPath !== null) console.info(`  config       ${target.configPath}`);
    console.info(`  renderer     ${renderer}`);
    console.info(`  reduced-motion ${reducedMotion ? 'sim' : 'não'}`);
    console.info(
      `  elementos    ${measured.length} medidos · ${notDrawn.length} sem glifo · ` +
        `${unstable.length} com fundo instável · ${measurement.candidates} candidatos`,
    );
    console.info(`  minContrast  ${minContrast.toFixed(2)} : 1  (piso ${floor})`);
    if (worst !== null) {
      console.info(`  pior caso    ${worst.selector} — "${worst.text}"`);
      await saveWorstShot(
        measurement.page,
        worst,
        measurement.scrollOf.get(worst) ?? 0,
        shotPath,
      );
    }
    if (lowest.length > 1) {
      console.info('\n  medidos mais próximos do piso:');
      for (const sample of lowest) {
        console.info(
          `    ${(sample.ratio ?? 0).toFixed(2).padStart(6)} : 1  ${sample.selector} — "${sample.text}"`,
        );
      }
    }
    printNotDrawn(notDrawn, floor);
    if (unstable.length > 0) {
      console.info(
        `\n  ${unstable.length} elemento(s) sobre fundo que não parou entre duas fotos — ` +
          'não foram medidos. Rode com --reveal maior se forem entrada animada.',
      );
    }

    if (measured.length === 0) {
      const reason =
        unstable.length > 0
          ? 'o fundo não parou entre duas fotos idênticas — congele a página ou aumente --reveal'
          : 'nenhum elemento desenhou glifo na tela';
      console.error(`\nNADA MENSURÁVEL: ${reason}.`);
      process.exitCode = EXIT_NOTHING_MEASURABLE;
    } else if (minContrast < floor) {
      console.error(`\nABAIXO DO PISO: ${minContrast.toFixed(2)} < ${floor}`);
      process.exitCode = EXIT_BELOW_FLOOR;
    } else {
      console.info(`\nOK — todo texto desenhado acima de ${floor}:1.`);
    }

    await measurement.context.close();
  } finally {
    await browser.close();
    await preview.stop();
  }
}

// Sem top-level await: assim os medidores rodam igual mesmo se alguém os copiar para uma
// pasta que não seja um pacote ESM.
main().catch((cause: unknown) => {
  console.error(`\nERRO: ${cause instanceof Error ? cause.message : String(cause)}`);
  process.exitCode = EXIT_NOTHING_MEASURABLE;
});
