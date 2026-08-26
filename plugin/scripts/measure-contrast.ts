/// <reference lib="dom" />
// Parte deste arquivo roda dentro da página (page.evaluate), então precisa da lib DOM em
// cima do tsconfig de Node — declarada aqui em vez de alargar o projeto inteiro.

/**
 * Contraste WCAG medido **por pixel** e **ao longo da animação** — nunca dos tokens de CSS,
 * nunca de um instante só.
 *
 * ── A regra ───────────────────────────────────────────────────────────────────────────
 * **Contraste é propriedade de toda a faixa de animação, nunca de um instante.** Depois que
 * a entrada assenta, o texto precisa estar legível em **qualquer** momento do ciclo — não em
 * média, não no melhor caso. O número que decide é o **pior** da faixa.
 *
 * Isso não é preciosismo: um site construído com a ferramenta tinha uma seção a 1,13:1 —
 * texto claro sobre fundo claro — e passou pela medição, porque o medidor fotografava a
 * página congelada sob `prefers-reduced-motion: reduce` e ali a animação parava numa pose
 * segura. A §5.1 da spec tirou o movimento reduzido dos sites gerados; a premissa que
 * sustentava aquele congelamento caiu junto.
 *
 * Os dois erros possíveis são opostos e os dois são reais:
 *   · fotografar durante a revelação de entrada  → reprova texto que **vai** ficar legível
 *   · fotografar só uma pose congelada           → aprova texto que **fica** ilegível
 * A saída não é escolher um lado: é esperar a entrada assentar e então **amostrar a faixa**.
 *
 * ── Como a tinta é isolada, e por que assim ───────────────────────────────────────────
 * (preservado da versão anterior — é o que separa "texto invisível" de "contraste ruim")
 * Para cada faixa da página tiramos três fotos idênticas em enquadramento:
 *
 *   A  — a página como está
 *   A' — a página de novo, sem mexer em nada
 *   B  — a mesma página com a tinta dos elementos daquela faixa tornada transparente
 *
 * `A − B` = exatamente os pixels que o glifo pintou. `A − A'` = os pixels que se mexeram
 * sozinhos, e esses saem da conta. Daí vêm três coisas:
 *
 *   1. **Texto invisível deixa de virar contraste ruim.** Zero glifo é zero diferença entre
 *      A e B: o elemento sai como `nao-desenhado`, com a razão prevista pelo CSS ao lado, e
 *      **não reprova o build**.
 *   2. **O fundo medido é o fundo real de debaixo do glifo** — ele está literalmente visível
 *      na foto B.
 *   3. **Fundo que se mexe é diagnosticado**, não medido errado: vira `fundo-instavel`.
 *
 * ── O que mudou: o congelamento virou obturador ───────────────────────────────────────
 * Congelar continua sendo obrigatório, porque a trinca A/A'/B só se compara se as três fotos
 * forem do **mesmo instante**. O que mudou é o papel: antes o congelamento **escolhia a
 * pose** (uma só, a que desse); agora ele é o **obturador** de cada amostra. A página roda,
 * congela, é fotografada, descongela, roda mais um passo, congela de novo — `--phases`
 * instantes espalhados por um ciclo. O pior de todos é o número do portão, e o relatório diz
 * **em que instante** ele aconteceu; o print do pior caso é tirado ali, naquele instante,
 * e não reproduzido depois.
 *
 * A entrada é separada do regime por espera ativa: antes de amostrar, a faixa é observada
 * até nenhuma animação **de duração finita** estar rodando nela (`--entry-max` de teto).
 * Ciclos infinitos não contam como entrada — são justamente o que precisa ser amostrado.
 *
 * O `--no-freeze` da versão anterior **saiu**. Ele existia para diagnosticar fundo instável,
 * e o que fazia de fato era comparar três fotos de instantes diferentes e imprimir o
 * resultado com cara de medida: na página de teste que oscila entre 1,05:1 e 15:1 ele
 * devolvia "13,26:1 · OK". Diagnosticar fundo que não para virou trabalho de quem sabe fazer
 * isso — a conferência de congelamento por faixa, que marca `fundo-instavel` e sai com 2.
 *
 *   tsx measure-contrast.ts --project=/caminho/do/site
 *   tsx measure-contrast.ts --url=http://localhost:5173 --min=7 --phases=6
 *
 * Argumentos: --project --url --port --dist --config --out --json
 *             --min --selectors --viewport=1280x720 --settle --reveal --shot
 *             --phases --cycle --entry-max --no-refine --no-skip-static --reduced-motion
 * Saídas: 0 ok · 1 abaixo do piso · 2 medição inválida · 3 inconclusivo ·
 *         4 nada mensurável.
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
import type { ConfigRecord, ParsedArgs } from './lib/config';
import { emitMeasurement } from './lib/report';
import type {
  Clip,
  ContrastMeasurement,
  ContrastSample,
  ContrastStatus,
  ContrastVerdict,
} from './lib/report';

const EXIT_BELOW_FLOOR = 1;
const EXIT_INVALID_MEASUREMENT = 2;
const EXIT_INCONCLUSIVE = 3;
const EXIT_NOTHING_MEASURABLE = 4;

const DEFAULT_MIN_CONTRAST = 7;
const DEFAULT_SELECTORS =
  'h1,h2,h3,h4,h5,h6,p,li,a,blockquote,figcaption,dt,dd,summary,label,button,th,td,span,strong,em,small,code';
const DEFAULT_VIEWPORT = { width: 1280, height: 720 };
const DEFAULT_SETTLE_MS = 900;
const DEFAULT_REVEAL_MS = 400;
const DEFAULT_SHOT = '.forge-visual/screenshots/contrast-worst.png';

/**
 * Quantos instantes por faixa.
 *
 * Quatro, espalhados por igual, deixam qualquer extremo da animação a no máximo ⅛ de ciclo
 * da amostra mais próxima — para um vaivém suave, o pior amostrado fica dentro de ~29% da
 * amplitude do pior real, o que um piso de 7:1 absorve com folga. Menos que isso e o método
 * vira de novo uma pose; muito mais e cada faixa passa a custar um ciclo inteiro de espera
 * por amostra ganha. Quem quiser resolução fina sobe com `--phases`, e a faixa que decide o
 * portão ainda ganha uma segunda passada (ver `--no-refine`).
 */
const DEFAULT_PHASES = 4;
/** Janela amostrada quando nenhum laço permanente é detectável (canvas por rAF, p.ex.). */
const DEFAULT_CYCLE_MS = 2000;
/** Laço curto demais não vale uma passada de fotos por amostra; longo demais não cabe. */
const MIN_CYCLE_MS = 600;
const MAX_CYCLE_MS = 4000;
/** Teto de espera pela revelação de entrada de uma faixa. */
const DEFAULT_ENTRY_MAX_MS = 4000;
const ENTRY_POLL_MS = 80;
/**
 * Janela de escuta para decidir se uma faixa está parada. Faixa parada não tem faixa de
 * animação para amostrar, e um instante já a descreve inteira. 150 ms é ~9 quadros a 60 Hz:
 * curto o bastante para não pesar e longo o bastante para um movimento lento aparecer.
 */
const STILL_PROBE_MS = 150;
/** Fração de pixels que pode mudar na janela de escuta e a faixa ainda contar como parada. */
const STILL_PIXEL_TOLERANCE = 0.0005;
/**
 * Janela para confirmar que o congelamento pegou — mais larga que o intervalo entre as fotos
 * da trinca. São três fotos, duas comparações: um movimento periódico que por azar case com
 * um dos intervalos ainda desencontra no outro.
 */
const FROZEN_HOLD_PROBE_MS = 60;
const FROZEN_HOLD_SAMPLES = 3;

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
/**
 * Acima desta fração de elementos que o congelamento não segurou, a página inteira deixa de
 * ser mensurável por diferença de fotos — o resultado é inválido, não é um contraste ruim.
 */
const INVALID_UNSTABLE_FRACTION = 0.5;
/** A partir daqui o que **não** foi medido já é grande demais para chamar a página de OK. */
const INCONCLUSIVE_UNSTABLE_FRACTION = 0.25;

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

interface AnalysisResult {
  readonly index: number;
  readonly status: ContrastStatus;
  readonly ratio: number | null;
  readonly cssRatio: number | null;
  readonly glyphCoverage: number;
}

/** O que uma amostra (um instante de uma faixa) devolveu. */
interface PhaseReading {
  readonly phaseMs: number;
  readonly results: readonly AnalysisResult[];
  readonly clips: ReadonlyMap<number, Clip>;
}

/** O ciclo detectado numa faixa, e de onde veio essa informação. */
interface CycleProbe {
  readonly cycleMs: number;
  readonly longestMs: number;
  readonly loops: number;
  readonly rafCalls: number;
}

const CANDIDATE_ATTRIBUTE = 'data-forge-contrast';

/* ────────────────────────────── código que roda na página ────────────────────────────── */
/*
 * Todas as funções abaixo são serializadas para dentro do navegador. Elas são escritas como
 * uma arrow só, sem função nomeada dentro: o tsx compila com `keepNames` do esbuild, e uma
 * função interna nomeada arrastaria um helper `__name(...)` para o código enviado à página,
 * onde ele não existe.
 */

/** Conta chamadas de `requestAnimationFrame` desde o começo — evidência de laço não-WAAPI. */
const RAF_COUNTER_SCRIPT = `(() => {
  const scope = window;
  if (scope.__forgeRafCalls !== undefined) return;
  scope.__forgeRafCalls = 0;
  const original = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) => {
    scope.__forgeRafCalls += 1;
    return original(callback);
  };
})();`;

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
 *
 * É relido a cada instante amostrado: sob animação o texto se desloca, e um retângulo lido
 * numa pose recortaria pixels de outra.
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

/**
 * Quanto dura o laço permanente mais longo **visível na tela agora**.
 *
 * Só entra o que se repete para sempre na linha do tempo do documento: é isso que define o
 * ciclo em regime. Animação de duração finita é entrada (tratada por `pendingEntry`), e
 * animação presa à rolagem não anda sozinha enquanto a página está parada.
 */
const probeCycle = (options: {
  defaultMs: number;
  minMs: number;
  maxMs: number;
}): CycleProbe => {
  let longest = 0;
  let loops = 0;

  for (const animation of document.getAnimations()) {
    if (animation.playState !== 'running') continue;
    if (animation.timeline !== document.timeline) continue;
    const effect = animation.effect;
    if (effect === null) continue;
    const timing = effect.getComputedTiming();
    if (timing.iterations !== Infinity) continue;
    const duration = typeof timing.duration === 'number' ? timing.duration : 0;
    if (duration <= 0) continue;
    const target = effect instanceof KeyframeEffect ? effect.target : null;
    if (target !== null) {
      const rect = target.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
    }
    const rate = Math.abs(animation.playbackRate);
    loops += 1;
    longest = Math.max(longest, rate === 0 ? duration : duration / rate);
  }

  const scope = window as unknown as { __forgeRafCalls?: number };
  const cycleMs =
    loops === 0
      ? options.defaultMs
      : Math.min(Math.max(longest, options.minMs), options.maxMs);
  return { cycleMs, longestMs: longest, loops, rafCalls: scope.__forgeRafCalls ?? 0 };
};

/**
 * Revelação de entrada ainda em curso na tela: animações de duração **finita** rodando.
 * Transições de CSS entram aqui também — elas são o outro jeito de escrever uma entrada.
 */
const pendingEntry = (): { running: number; remainingMs: number } => {
  let running = 0;
  let remaining = 0;

  for (const animation of document.getAnimations()) {
    if (animation.playState !== 'running') continue;
    if (animation.timeline !== document.timeline) continue;
    const effect = animation.effect;
    if (effect === null) continue;
    const timing = effect.getComputedTiming();
    if (timing.iterations === Infinity) continue;
    const target = effect instanceof KeyframeEffect ? effect.target : null;
    if (target !== null) {
      const rect = target.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
    }
    const endTime = typeof timing.endTime === 'number' ? timing.endTime : 0;
    const current = typeof animation.currentTime === 'number' ? animation.currentTime : 0;
    running += 1;
    remaining = Math.max(remaining, endTime - current);
  }

  return { running, remainingMs: remaining };
};

/**
 * Duas fotos da tela inteira são a mesma imagem?
 *
 * É a única pergunta que não depende de o movimento ter passado por alguma API que dê para
 * espionar. `setInterval`, `<video>` e GIF não aparecem nem na Web Animations API nem no
 * contador de `requestAnimationFrame`; aparecem aqui.
 */
const framesMatch = async (input: {
  before: string;
  after: string;
  threshold: number;
  tolerance: number;
}): Promise<boolean> => {
  const planes: Uint8ClampedArray[] = [];
  let width = 0;
  let height = 0;
  for (const source of [input.before, input.after]) {
    const image = new Image();
    image.src = `data:image/png;base64,${source}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) return false;
    context.drawImage(image, 0, 0);
    planes.push(context.getImageData(0, 0, canvas.width, canvas.height).data);
    width = canvas.width;
    height = canvas.height;
  }
  const [before, after] = planes;
  if (before === undefined || after === undefined) return false;

  const pixels = width * height;
  const budget = Math.floor(pixels * input.tolerance);
  let moved = 0;
  // Um pixel em cada quatro: um movimento que só toca 1/4 dos pixels de uma tela inteira
  // não é o tipo de coisa que muda o contraste de um trecho de texto.
  for (let offset = 0; offset < before.length; offset += 16) {
    const delta = Math.max(
      Math.abs((before[offset] ?? 0) - (after[offset] ?? 0)),
      Math.abs((before[offset + 1] ?? 0) - (after[offset + 1] ?? 0)),
      Math.abs((before[offset + 2] ?? 0) - (after[offset + 2] ?? 0)),
    );
    if (delta <= input.threshold) continue;
    moved += 4;
    if (moved > budget) return false;
  }
  return true;
};

/** Quantos quadros a página pediu até agora — o contador instalado por `RAF_COUNTER_SCRIPT`. */
const readRafCalls = (): number => {
  const scope = window as unknown as { __forgeRafCalls?: number };
  return scope.__forgeRafCalls ?? 0;
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
  readonly entryMaxMs: number;
  readonly viewportHeight: number;
  readonly phases: number;
  /** Janela pedida por configuração; `null` deixa o ciclo ser detectado por faixa. */
  readonly cycleMs: number | null;
  /** Segunda passada na faixa que decide o portão, com os instantes intercalados. */
  readonly refine: boolean;
  /** Gastar um instante só nas faixas em que nada se mexe. */
  readonly skipStill: boolean;
}

/** O que sobrou de um elemento depois de visto em vários instantes. */
interface ElementTrack {
  worstRatio: number | null;
  worstPhaseMs: number | null;
  worstClip: Clip | null;
  worstCoverage: number;
  bestRatio: number | null;
  phasesMeasured: number;
  cssRatio: number | null;
  statusCounts: Map<ContrastStatus, number>;
  entrySettled: boolean;
  cycleMs: number;
  scrollY: number;
  /** Âncora da faixa em que ele apareceu — é por ela que a segunda passada volta. */
  anchorIndex: number;
}

/** O print do pior caso, tirado no instante em que o pior caso aconteceu. */
interface WorstShot {
  readonly index: number;
  readonly ratio: number;
  readonly phaseMs: number;
  readonly buffer: Buffer;
}

interface BandOutcome {
  readonly touched: ReadonlySet<number>;
  readonly entrySettled: boolean;
  readonly cycle: CycleProbe;
  readonly scrollY: number;
  /** Nada se mexia nesta faixa: um instante bastou. */
  readonly still: boolean;
  /** O congelamento segurou a faixa; `false` invalida tudo que se mediria nela. */
  readonly frozenHeld: boolean;
}

interface SweepOutcome {
  readonly tracks: ReadonlyMap<number, ElementTrack>;
  readonly worstShot: WorstShot | null;
  readonly bands: number;
  readonly unsettledBands: number;
  readonly stillBands: number;
  /** Faixas que continuaram se mexendo mesmo congeladas — nenhum número saiu delas. */
  readonly driftingBands: number;
  readonly sampledCycleMs: number;
  readonly rafDriven: boolean;
  readonly refinedBand: boolean;
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

/** Fotografa a faixa no instante em que ela está agora (a página precisa estar parada). */
async function capturePhase(
  page: Page,
  candidates: ReadonlyMap<number, Candidate>,
  targets: readonly number[],
  anchorIndex: number,
  phaseMs: number,
): Promise<PhaseReading> {
  const visible = (
    await page.evaluate(readRects, { indices: targets, attribute: CANDIDATE_ATTRIBUTE })
  ).filter(
    (rect) =>
      (rect.fullyVisible || rect.index === anchorIndex) &&
      rect.width >= MIN_CLIP_SIDE_PX &&
      rect.height >= MIN_CLIP_SIDE_PX,
  );

  const { results, clips } = await measureStep(page, candidates, visible);
  return { phaseMs, results, clips };
}

/**
 * Espera a revelação de entrada da faixa terminar.
 *
 * Só animação de duração finita conta: um laço infinito nunca "termina" e é exatamente o que
 * as amostras existem para pegar. `revealMs` é piso, não teto — ele cobre a revelação feita
 * na unha com `requestAnimationFrame`, que a Web Animations API não enxerga.
 */
async function settleEntry(
  page: Page,
  options: { revealMs: number; entryMaxMs: number },
): Promise<boolean> {
  const start = Date.now();

  while (Date.now() - start < options.entryMaxMs) {
    const state = await page.evaluate(pendingEntry);
    const elapsed = Date.now() - start;
    if (state.running === 0 && elapsed >= options.revealMs) return true;
    const nextPoll =
      state.running === 0 ? options.revealMs - elapsed : Math.min(ENTRY_POLL_MS, state.remainingMs);
    await page.waitForTimeout(Math.max(16, nextPoll));
  }

  return false;
}

/** Instantes espalhados por igual dentro de um ciclo, opcionalmente deslocados de meio passo. */
function phaseOffsets(cycleMs: number, phases: number, halfStep: boolean): number[] {
  const step = cycleMs / phases;
  const shift = halfStep ? step / 2 : 0;
  const offsets: number[] = [];
  for (let i = 0; i < phases; i += 1) offsets.push(Math.round(i * step + shift));
  return offsets;
}

function emptyTrack(anchorIndex: number, cycleMs: number, scrollY: number): ElementTrack {
  return {
    worstRatio: null,
    worstPhaseMs: null,
    worstClip: null,
    worstCoverage: 0,
    bestRatio: null,
    phasesMeasured: 0,
    cssRatio: null,
    statusCounts: new Map<ContrastStatus, number>(),
    entrySettled: true,
    cycleMs,
    scrollY,
    anchorIndex,
  };
}

/** Junta um instante ao histórico de cada elemento: o pior manda, o melhor fica de contexto. */
function mergePhase(
  tracks: Map<number, ElementTrack>,
  reading: PhaseReading,
  context: { anchorIndex: number; cycleMs: number; scrollY: number; entrySettled: boolean },
): void {
  for (const result of reading.results) {
    const track =
      tracks.get(result.index) ??
      emptyTrack(context.anchorIndex, context.cycleMs, context.scrollY);
    track.statusCounts.set(result.status, (track.statusCounts.get(result.status) ?? 0) + 1);
    track.entrySettled = track.entrySettled && context.entrySettled;
    if (result.cssRatio !== null) track.cssRatio = result.cssRatio;

    if (result.status === 'medido' && result.ratio !== null) {
      track.phasesMeasured += 1;
      track.bestRatio = Math.max(track.bestRatio ?? result.ratio, result.ratio);
      if (track.worstRatio === null || result.ratio < track.worstRatio) {
        track.worstRatio = result.ratio;
        track.worstPhaseMs = reading.phaseMs;
        track.worstClip = reading.clips.get(result.index) ?? track.worstClip;
        track.worstCoverage = result.glyphCoverage;
        track.anchorIndex = context.anchorIndex;
        track.scrollY = context.scrollY;
        track.cycleMs = context.cycleMs;
      }
    }
    tracks.set(result.index, track);
  }
}

/** O medido mais baixo de um instante — candidato a dono do print do pior caso. */
function lowestMeasured(results: readonly AnalysisResult[]): AnalysisResult | null {
  let lowest: AnalysisResult | null = null;
  for (const result of results) {
    if (result.status !== 'medido' || result.ratio === null) continue;
    if (lowest === null || result.ratio < (lowest.ratio ?? Infinity)) lowest = result;
  }
  return lowest;
}

/**
 * Tira o print do pior caso **no instante em que ele está acontecendo**, com a página ainda
 * parada naquele quadro. Reproduzir o instante depois seria adivinhação: o ciclo não volta
 * para a mesma fase só porque a rolagem voltou.
 */
async function keepWorstShot(
  page: Page,
  reading: PhaseReading,
  current: WorstShot | null,
): Promise<WorstShot | null> {
  const contender = lowestMeasured(reading.results);
  if (contender === null || contender.ratio === null) return current;
  if (current !== null && contender.ratio >= current.ratio) return current;
  const clip = reading.clips.get(contender.index);
  if (clip === undefined) return current;

  try {
    const buffer = await page.screenshot({ clip });
    return { index: contender.index, ratio: contender.ratio, phaseMs: reading.phaseMs, buffer };
  } catch (cause) {
    console.warn(`  aviso: não consegui fotografar o pior caso — ${String(cause)}`);
    return current;
  }
}

/**
 * A faixa está parada?
 *
 * Três sinais, do mais barato ao mais caro, e o primeiro que disser "não" encerra: nenhum
 * laço permanente que a Web Animations API conheça, nenhum quadro pedido por
 * `requestAnimationFrame` na janela de escuta, e — a prova que não depende de API nenhuma —
 * duas fotos da tela inteira separadas por essa janela sendo a mesma imagem.
 *
 * Quando os três dão negativo não existe faixa de animação para percorrer, e um instante
 * descreve a faixa inteira. É o que devolve o custo de uma página estática ao que era antes
 * de o medidor passar a amostrar a animação.
 *
 * Limite que fica de pé: movimento **mais lento** que a janela de escuta passa por parado.
 * `--no-skip-static` desliga o atalho e força os `--phases` instantes em toda faixa.
 */
async function isStill(page: Page, probe: CycleProbe): Promise<boolean> {
  if (probe.loops > 0) return false;
  const before = (await page.screenshot()).toString('base64');
  await page.waitForTimeout(STILL_PROBE_MS);
  if ((await page.evaluate(readRafCalls)) !== probe.rafCalls) return false;
  const after = (await page.screenshot()).toString('base64');
  return page.evaluate(framesMatch, {
    before,
    after,
    threshold: STABLE_THRESHOLD,
    tolerance: STILL_PIXEL_TOLERANCE,
  });
}

/**
 * O congelamento pegou nesta faixa?
 *
 * Duas fotos da tela com a página já parada, separadas por mais tempo do que a trinca
 * A/A'/B leva para ser tirada. Se elas diferem, o movimento vem de um caminho que o
 * congelamento não alcança (`setTimeout`/`setInterval`, `<video>`, GIF) — e aí as três fotos
 * da isolação de tinta são de instantes diferentes. Um número tirado dali não descreve
 * contraste nenhum; melhor não ter número.
 */
async function frozenHolds(page: Page): Promise<boolean> {
  let previous = (await page.screenshot()).toString('base64');

  for (let sample = 1; sample < FROZEN_HOLD_SAMPLES; sample += 1) {
    await page.waitForTimeout(FROZEN_HOLD_PROBE_MS);
    const current = (await page.screenshot()).toString('base64');
    const same = await page.evaluate(framesMatch, {
      before: previous,
      after: current,
      threshold: STABLE_THRESHOLD,
      tolerance: STILL_PIXEL_TOLERANCE,
    });
    if (!same) return false;
    previous = current;
  }

  return true;
}

/** Registra a faixa inteira como não isolável, em vez de deixar sair número inventado. */
async function markBandUnstable(
  page: Page,
  tracks: Map<number, ElementTrack>,
  band: { anchor: RectReading; targets: readonly number[] },
  context: { anchorIndex: number; cycleMs: number; scrollY: number; entrySettled: boolean },
): Promise<Set<number>> {
  const visible = await page.evaluate(readRects, {
    indices: band.targets,
    attribute: CANDIDATE_ATTRIBUTE,
  });
  const results: AnalysisResult[] = visible
    .filter((rect) => rect.fullyVisible || rect.index === band.anchor.index)
    .map((rect) => ({
      index: rect.index,
      status: 'fundo-instavel' as const,
      ratio: null,
      cssRatio: null,
      glyphCoverage: 0,
    }));
  mergePhase(tracks, { phaseMs: 0, results, clips: new Map<number, Clip>() }, context);
  return new Set(results.map((result) => result.index));
}

/** Onde a faixa está e como ela se comporta, antes de qualquer foto. */
interface BandSetup {
  readonly scrollY: number;
  readonly entrySettled: boolean;
  readonly cycle: CycleProbe;
  readonly still: boolean;
}

/** Rola até a faixa, espera a revelação assentar e descobre o ciclo dela. */
async function prepareBand(
  page: Page,
  band: { anchor: RectReading },
  options: SweepOptions,
): Promise<BandSetup> {
  await page.evaluate(unfreezePage);
  // Centraliza pela altura REAL do elemento: a altura recortada de uma leitura feita com
  // ele fora da tela é negativa e mandaria a rolagem para o lugar errado.
  const scrollY = await page.evaluate(
    scrollToOffset,
    band.anchor.docTop - (options.viewportHeight - band.anchor.docHeight) / 2,
  );
  const entrySettled = await settleEntry(page, options);
  const probe = await page.evaluate(probeCycle, {
    defaultMs: options.cycleMs ?? DEFAULT_CYCLE_MS,
    minMs: MIN_CYCLE_MS,
    maxMs: MAX_CYCLE_MS,
  });
  const still = options.skipStill && entrySettled && (await isStill(page, probe));

  return {
    scrollY,
    entrySettled,
    cycle: { ...probe, cycleMs: options.cycleMs ?? probe.cycleMs },
    still,
  };
}

/**
 * Leva a página de um instante ao seguinte e a para ali.
 *
 * O passo é tempo de relógio com a página **rodando**: é o único jeito que vale para
 * qualquer fonte de movimento — a Web Animations API dá para adiantar pela linha do tempo,
 * um laço de `requestAnimationFrame` sobre canvas não dá.
 */
async function seekPhase(page: Page, from: number, to: number): Promise<void> {
  if (to > from) {
    await page.evaluate(unfreezePage);
    await page.waitForTimeout(to - from);
  }
  await page.evaluate(freezePage);
}

/**
 * Mede uma faixa: rola até ela, espera a entrada assentar e fotografa os instantes pedidos.
 *
 * Entre um instante e o outro a página **volta a rodar** pelo tempo do passo — é isso que faz
 * a amostra ser da faixa de animação e não da mesma pose repetida. O congelamento entra só na
 * hora da foto.
 */
async function runBand(
  page: Page,
  candidates: ReadonlyMap<number, Candidate>,
  tracks: Map<number, ElementTrack>,
  band: { anchor: RectReading; targets: readonly number[]; halfStep: boolean },
  options: SweepOptions,
  shot: { current: WorstShot | null },
): Promise<BandOutcome> {
  const setup = await prepareBand(page, band, options);
  const cycleMs = setup.cycle.cycleMs;
  const context = {
    anchorIndex: band.anchor.index,
    cycleMs,
    scrollY: setup.scrollY,
    entrySettled: setup.entrySettled,
  };
  const touched = new Set<number>();
  let elapsed = 0;
  let frozenHeld = true;
  let checked = false;

  for (const offset of phaseOffsets(cycleMs, setup.still ? 1 : options.phases, band.halfStep)) {
    await seekPhase(page, elapsed, offset);
    elapsed = Math.max(elapsed, offset);

    // Uma vez por faixa, e só onde havia movimento: faixa parada já provou que não se mexe.
    if (!checked && !setup.still) {
      checked = true;
      frozenHeld = await frozenHolds(page);
      if (!frozenHeld) {
        for (const index of await markBandUnstable(page, tracks, band, context)) {
          touched.add(index);
        }
        break;
      }
    }

    const reading = await capturePhase(page, candidates, band.targets, band.anchor.index, offset);
    mergePhase(tracks, reading, context);
    shot.current = await keepWorstShot(page, reading, shot.current);
    for (const result of reading.results) touched.add(result.index);
  }

  await page.evaluate(unfreezePage);
  return { ...setup, touched, frozenHeld };
}

/** O elemento medido mais baixo de toda a varredura — o que decide o portão. */
function worstTrack(tracks: ReadonlyMap<number, ElementTrack>): [number, ElementTrack] | null {
  let worst: [number, ElementTrack] | null = null;
  for (const entry of tracks) {
    const ratio = entry[1].worstRatio;
    if (ratio === null) continue;
    if (worst === null || ratio < (worst[1].worstRatio ?? Infinity)) worst = entry;
  }
  return worst;
}

/**
 * Varre a página de cima para baixo. Cada parada centraliza o primeiro elemento ainda não
 * medido e aproveita as mesmas fotos para **todos** os que couberem na tela ali — três
 * screenshots por instante de faixa, não por elemento.
 *
 * No fim, a faixa que produziu o pior número ganha uma segunda passada com os instantes
 * intercalados (meio passo adiante). Custo: uma faixa a mais. Ganho: o número que decide o
 * portão passa a ter o dobro de resolução temporal, e o instante reportado erra pela metade.
 */
async function sweep(
  page: Page,
  candidates: ReadonlyMap<number, Candidate>,
  order: readonly RectReading[],
  options: SweepOptions,
): Promise<SweepOutcome> {
  const tracks = new Map<number, ElementTrack>();
  const pending = new Set(order.map((rect) => rect.index));
  const anchors = new Map(order.map((rect) => [rect.index, rect]));
  const shot = { current: null as WorstShot | null };
  const still = new Set<number>();
  let bands = 0;
  let driftingBands = 0;
  let unsettledBands = 0;
  let sampledCycleMs = 0;
  let rafDriven = false;

  for (const anchor of order) {
    if (!pending.has(anchor.index)) continue;
    bands += 1;
    const outcome = await runBand(
      page,
      candidates,
      tracks,
      { anchor, targets: [...pending], halfStep: false },
      options,
      shot,
    );
    if (!outcome.entrySettled) unsettledBands += 1;
    if (!outcome.frozenHeld) driftingBands += 1;
    if (outcome.still) still.add(anchor.index);
    sampledCycleMs = Math.max(sampledCycleMs, outcome.cycle.cycleMs);
    rafDriven = rafDriven || outcome.cycle.rafCalls > 0;

    for (const index of outcome.touched) pending.delete(index);
    // O elemento âncora sai da fila mesmo se não deu para medir (maior que a tela, por
    // exemplo): senão a varredura volta para ele para sempre.
    pending.delete(anchor.index);
  }

  const refinedBand =
    options.refine && (await refineWorstBand(page, candidates, tracks, anchors, still, options, shot));
  return {
    tracks,
    worstShot: shot.current,
    bands,
    unsettledBands,
    stillBands: still.size,
    driftingBands,
    sampledCycleMs,
    rafDriven,
    refinedBand,
  };
}

/** Segunda passada, só na faixa do pior caso, com os instantes no meio dos primeiros. */
async function refineWorstBand(
  page: Page,
  candidates: ReadonlyMap<number, Candidate>,
  tracks: Map<number, ElementTrack>,
  anchors: ReadonlyMap<number, RectReading>,
  stillBands: ReadonlySet<number>,
  options: SweepOptions,
  shot: { current: WorstShot | null },
): Promise<boolean> {
  const worst = worstTrack(tracks);
  if (worst === null) return false;
  // Faixa parada não tem meio-passo: os instantes intercalados seriam a mesma foto.
  if (stillBands.has(worst[1].anchorIndex)) return false;
  const anchor = anchors.get(worst[1].anchorIndex);
  if (anchor === undefined) return false;

  const targets = [...tracks]
    .filter((entry) => entry[1].anchorIndex === worst[1].anchorIndex)
    .map((entry) => entry[0]);
  await runBand(page, candidates, tracks, { anchor, targets, halfStep: true }, options, shot);
  return true;
}

/** Quando nenhum instante rendeu número, o status que melhor descreve o que aconteceu. */
function dominantStatus(counts: ReadonlyMap<ContrastStatus, number>): ContrastStatus {
  const priority: readonly ContrastStatus[] = [
    'fundo-instavel',
    'amostra-insuficiente',
    'nao-desenhado',
  ];
  let best: ContrastStatus = 'nao-desenhado';
  let bestCount = -1;
  for (const status of priority) {
    const count = counts.get(status) ?? 0;
    if (count > bestCount) {
      best = status;
      bestCount = count;
    }
  }
  return best;
}

function toSample(candidate: Candidate, track: ElementTrack): ContrastSample {
  const measured = track.worstRatio !== null;
  return {
    selector: candidate.selector,
    text: candidate.text,
    status: measured ? 'medido' : dominantStatus(track.statusCounts),
    ratio: track.worstRatio === null ? null : round(track.worstRatio),
    bestRatio: track.bestRatio === null ? null : round(track.bestRatio),
    worstPhaseMs: track.worstPhaseMs,
    cycleMs: track.cycleMs,
    phasesMeasured: track.phasesMeasured,
    entrySettled: track.entrySettled,
    cssRatio: track.cssRatio === null ? null : round(track.cssRatio),
    glyphCoverage: round(track.worstCoverage, 4),
    clip: track.worstClip ?? { x: 0, y: 0, width: 0, height: 0 },
  };
}

function parseViewport(raw: string | undefined): { width: number; height: number } {
  if (raw === undefined) return DEFAULT_VIEWPORT;
  const match = /^(\d+)x(\d+)$/.exec(raw.trim());
  if (match === null) throw new Error(`--viewport=${raw}: use o formato 1280x720.`);
  return { width: Number(match[1]), height: Number(match[2]) };
}

/**
 * A §5.1 tirou `prefers-reduced-motion` dos sites gerados: eles animam sempre. Medir com
 * movimento reduzido, então, mede um estado que nenhum visitante vê — por isso o padrão
 * agora é medir **com movimento**. O contrário continua disponível para diagnóstico.
 */
function resolveReducedMotion(args: ParsedArgs, config: ConfigRecord): boolean {
  const explicit = argFlag(args, 'reduced-motion');
  if (explicit !== undefined) return explicit;
  // `--motion` / `--no-motion` da versão anterior deste medidor.
  const legacy = argFlag(args, 'motion');
  if (legacy !== undefined) return !legacy;
  const fromConfig = config['reducedMotion'];
  return typeof fromConfig === 'boolean' ? fromConfig : false;
}

function describeInstant(sample: ContrastSample): string {
  if (sample.worstPhaseMs === null || sample.cycleMs === null) return '';
  return ` em t=+${sample.worstPhaseMs} ms de um ciclo de ${sample.cycleMs} ms`;
}

function printNotDrawn(samples: readonly ContrastSample[], floor: number): void {
  if (samples.length === 0) return;
  console.info(
    `\n  ${samples.length} elemento(s) com texto no DOM e nenhum glifo na tela em nenhum ` +
      'instante amostrado — não reprovam (não há pixel para medir), mas veja se deveriam\n' +
      '  estar visíveis:',
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
    reducedMotion: boolean;
    sweep: SweepOptions;
  },
): Promise<{
  samples: ContrastSample[];
  outcome: SweepOutcome;
  candidates: number;
  context: BrowserContext;
}> {
  const context = await browser.newContext({
    viewport: options.viewport,
    deviceScaleFactor: 1,
    reducedMotion: options.reducedMotion ? 'reduce' : 'no-preference',
  });
  await context.addInitScript({ content: RAF_COUNTER_SCRIPT });
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

  const outcome = await sweep(page, byIndex, order, options.sweep);

  const samples: ContrastSample[] = [];
  for (const [index, track] of outcome.tracks) {
    const candidate = byIndex.get(index);
    if (candidate === undefined) continue;
    samples.push(toSample(candidate, track));
  }
  return { samples, outcome, candidates: candidates.length, context };
}

interface Verdict {
  readonly verdict: ContrastVerdict;
  readonly exitCode: number;
}

/**
 * O que reprova, e o que apenas não dá para afirmar.
 *
 * A regra de fundo é a mesma da medição: **não aprovar o que não foi visto**. Texto abaixo do
 * piso numa faixa cuja entrada assentou é defeito (1). O mesmo texto numa faixa que ainda
 * estava entrando quando o teto de espera estourou é inconclusivo (3) — pode ser o meio de
 * uma revelação, e reprovar aí é o erro oposto. Página que nem congelada para de se mexer não
 * rende medição nenhuma (2), e página sem glifo não rende número (4).
 */
function decideVerdict(input: {
  measured: readonly ContrastSample[];
  unstable: readonly ContrastSample[];
  floor: number;
  measurable: number;
}): Verdict {
  const unstableFraction = input.measurable === 0 ? 0 : input.unstable.length / input.measurable;

  if (input.measured.length === 0) {
    return unstableFraction > INVALID_UNSTABLE_FRACTION
      ? { verdict: 'medicao-invalida', exitCode: EXIT_INVALID_MEASUREMENT }
      : { verdict: 'nada-mensuravel', exitCode: EXIT_NOTHING_MEASURABLE };
  }

  const below = input.measured.filter((sample) => (sample.ratio ?? Infinity) < input.floor);
  if (below.some((sample) => sample.entrySettled)) {
    return { verdict: 'abaixo-do-piso', exitCode: EXIT_BELOW_FLOOR };
  }
  if (below.length > 0 || unstableFraction > INCONCLUSIVE_UNSTABLE_FRACTION) {
    return { verdict: 'inconclusivo', exitCode: EXIT_INCONCLUSIVE };
  }
  return { verdict: 'ok', exitCode: 0 };
}

/** Grava o print do pior caso e devolve o caminho — `null` quando não deu para gravar. */
function saveWorstShot(shot: WorstShot, path: string): string | null {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, shot.buffer);
    return path;
  } catch (cause) {
    console.warn(`  aviso: não consegui salvar o print do pior caso — ${String(cause)}`);
    return null;
  }
}

function printReport(report: ContrastMeasurement, configPath: string | null): void {
  console.info(`\ncontraste (por pixel, ao longo da animação, ${report.viewport})`);
  if (configPath !== null) console.info(`  config       ${configPath}`);
  console.info(`  renderer     ${report.renderer}`);
  console.info(
    `  amostragem   ${report.phases} instante(s) por faixa · ciclo ${report.sampledCycleMs} ms · ` +
      `${report.bands} faixa(s)${report.refinedBand ? ' + 1 refinada' : ''}` +
      `${report.stillBands > 0 ? ` · ${report.stillBands} parada(s), 1 instante` : ''}`,
  );
  console.info(
    `  movimento    ${report.reducedMotion ? 'reduzido (prefers-reduced-motion: reduce)' : 'ligado, como o visitante vê'}` +
      `${report.rafDriven ? ' · página anima por requestAnimationFrame' : ''}`,
  );
  const scarce =
    report.candidates - report.measured - report.notDrawn.length - report.unstable.length;
  console.info(
    `  elementos    ${report.measured} medidos · ${report.notDrawn.length} sem glifo · ` +
      `${report.unstable.length} com fundo instável · ` +
      `${scarce > 0 ? `${scarce} com glifo de menos para medir · ` : ''}` +
      `${report.candidates} candidatos`,
  );
  console.info(`  minContrast  ${report.minContrast.toFixed(2)} : 1  (piso ${report.floor})`);
  console.info(`  custo        ${(report.durationMs / 1000).toFixed(1)} s`);
}

function printWorst(worst: ContrastSample): void {
  console.info(`  pior caso    ${worst.selector} — "${worst.text}"`);
  console.info(
    `               ${(worst.ratio ?? 0).toFixed(2)}:1${describeInstant(worst)}` +
      (worst.bestRatio === null ? '' : ` · melhor instante do ciclo: ${worst.bestRatio.toFixed(2)}:1`),
  );
}

function printLowest(lowest: readonly ContrastSample[]): void {
  if (lowest.length <= 1) return;
  console.info('\n  medidos mais próximos do piso (pior instante de cada um):');
  for (const sample of lowest) {
    const instant = sample.worstPhaseMs === null ? '' : `  t=+${sample.worstPhaseMs} ms`;
    console.info(
      `    ${(sample.ratio ?? 0).toFixed(2).padStart(6)} : 1  ${sample.selector} — "${sample.text}"${instant}`,
    );
  }
}

/* ────────────────────────────────── linha de comando ────────────────────────────────── */

interface Settings {
  readonly floor: number;
  readonly selectors: string;
  readonly viewport: { width: number; height: number };
  readonly settleMs: number;
  readonly shotPath: string;
  readonly reducedMotion: boolean;
  readonly sweep: SweepOptions;
}

function readSettings(
  args: ParsedArgs,
  config: ConfigRecord,
  projectRoot: string,
): Settings {
  const viewport = parseViewport(argString(args, 'viewport') ?? readString(config, 'viewport'));
  const phases = Math.max(
    1,
    Math.round(argNumber(args, 'phases') ?? readNumber(config, 'phases') ?? DEFAULT_PHASES),
  );
  const cycleMs = argNumber(args, 'cycle') ?? readNumber(config, 'cycleMs') ?? null;

  return {
    floor: argNumber(args, 'min') ?? readNumber(config, 'min') ?? DEFAULT_MIN_CONTRAST,
    selectors: argString(args, 'selectors') ?? readString(config, 'selectors') ?? DEFAULT_SELECTORS,
    viewport,
    settleMs: argNumber(args, 'settle') ?? readNumber(config, 'settleMs') ?? DEFAULT_SETTLE_MS,
    shotPath: resolve(
      projectRoot,
      argString(args, 'shot') ?? readString(config, 'shot') ?? DEFAULT_SHOT,
    ),
    reducedMotion: resolveReducedMotion(args, config),
    sweep: {
      revealMs: argNumber(args, 'reveal') ?? readNumber(config, 'revealMs') ?? DEFAULT_REVEAL_MS,
      entryMaxMs:
        argNumber(args, 'entry-max') ?? readNumber(config, 'entryMaxMs') ?? DEFAULT_ENTRY_MAX_MS,
      viewportHeight: viewport.height,
      phases,
      cycleMs,
      refine: (argFlag(args, 'refine') ?? true) && phases > 1,
      skipStill: argFlag(args, 'skip-static') ?? true,
    },
  };
}

function explainVerdict(report: ContrastMeasurement, unstableFraction: number): void {
  if (report.verdict === 'ok') {
    const moving = report.bands - report.stillBands;
    console.info(
      `\nOK — todo texto desenhado acima de ${report.floor}:1` +
        (moving === 0
          ? ', em todas as faixas (nenhuma se mexia).'
          : ` em ${report.phases} instante(s) de cada uma das ${moving} faixa(s) com movimento.`),
    );
    return;
  }
  if (report.verdict === 'abaixo-do-piso') {
    const worst = report.worst;
    console.error(
      `\nABAIXO DO PISO: ${report.minContrast.toFixed(2)} < ${report.floor}` +
        (worst === null ? '' : ` — ${worst.selector}${describeInstant(worst)}.`) +
        '\n  Contraste é propriedade de toda a faixa de animação: legível numa pose e ilegível' +
        '\n  em outra do mesmo ciclo continua sendo ilegível. Veja o print do pior caso.',
    );
    return;
  }
  if (report.verdict === 'inconclusivo') {
    console.error(
      '\nINCONCLUSIVO: não dá para afirmar que a página passa.' +
        (report.unsettledBands > 0
          ? `\n  ${report.unsettledBands} faixa(s) ainda estavam entrando quando o teto de espera` +
            ' estourou — o que ficou\n  abaixo do piso ali pode ser meio de revelação. Suba --entry-max e remeça.'
          : '') +
        (unstableFraction > INCONCLUSIVE_UNSTABLE_FRACTION
          ? `\n  ${(unstableFraction * 100).toFixed(0)}% dos elementos ficaram sobre fundo que não parou nem` +
            ' congelado. O congelamento\n  desliga requestAnimationFrame e pausa a Web Animations API — ele não alcança' +
            '\n  setTimeout/setInterval, <video> nem GIF. Corrija a fonte do movimento e remeça.'
          : ''),
    );
    return;
  }
  if (report.verdict === 'medicao-invalida') {
    console.error(
      '\nMEDIÇÃO INVÁLIDA: a maioria do texto está sobre fundo que não parou entre duas fotos' +
        '\n  idênticas, mesmo com a página congelada. Sem duas fotos do mesmo instante não há' +
        '\n  como separar tinta de fundo, e qualquer número aqui seria invenção.',
    );
    return;
  }
  console.error(
    '\nNADA MENSURÁVEL: nenhum elemento desenhou glifo na tela em nenhum instante amostrado.' +
      '\n  Se o texto entra por revelação, suba --settle/--reveal; se ele está dentro do' +
      '\n  <canvas>, ele viola a proibição de texto em canvas.',
  );
}

/** O relatório fechado, mais o código de saída que ele implica. */
interface Summary {
  readonly report: ContrastMeasurement;
  readonly exitCode: number;
  readonly unstableFraction: number;
  readonly lowest: readonly ContrastSample[];
  readonly notDrawn: readonly ContrastSample[];
  /** Instante do print gravado; separado de `worst.worstPhaseMs` porque a foto é daquele. */
  readonly worstPhaseMs: number | null;
}

/** Classifica as amostras, decide o veredito e monta o objeto que vai para disco. */
function summarize(input: {
  samples: readonly ContrastSample[];
  outcome: SweepOutcome;
  candidates: number;
  settings: Settings;
  renderer: string;
  durationMs: number;
}): Summary {
  const measured = input.samples.filter((sample) => sample.status === 'medido');
  const notDrawn = input.samples.filter((sample) => sample.status === 'nao-desenhado');
  const unstable = input.samples.filter((sample) => sample.status === 'fundo-instavel');
  const lowest = [...measured]
    .sort((a, b) => (a.ratio ?? Infinity) - (b.ratio ?? Infinity))
    .slice(0, LOWEST_REPORTED);
  const worst = lowest[0] ?? null;
  const measurable = measured.length + unstable.length;
  const { verdict, exitCode } = decideVerdict({
    measured,
    unstable,
    floor: input.settings.floor,
    measurable,
  });

  return {
    exitCode,
    lowest,
    notDrawn,
    worstPhaseMs: input.outcome.worstShot?.phaseMs ?? null,
    unstableFraction: measurable === 0 ? 0 : unstable.length / measurable,
    report: {
      minContrast: worst?.ratio ?? 0,
      floor: input.settings.floor,
      worst,
      lowest,
      measured: measured.length,
      candidates: input.candidates,
      notDrawn,
      unstable,
      phases: input.settings.sweep.phases,
      sampledCycleMs: input.outcome.sampledCycleMs,
      bands: input.outcome.bands,
      refinedBand: input.outcome.refinedBand,
      unsettledBands: input.outcome.unsettledBands,
      stillBands: input.outcome.stillBands,
      driftingBands: input.outcome.driftingBands,
      reducedMotion: input.settings.reducedMotion,
      rafDriven: input.outcome.rafDriven,
      renderer: input.renderer,
      viewport: `${input.settings.viewport.width}x${input.settings.viewport.height}`,
      durationMs: input.durationMs,
      verdict,
      measuredAt: nowIso(),
    },
  };
}

function printSummary(
  summary: Summary,
  context: { configPath: string | null; floor: number; shotPath: string | null },
): void {
  const { report } = summary;
  printReport(report, context.configPath);
  if (report.worst !== null) printWorst(report.worst);
  if (context.shotPath !== null && summary.worstPhaseMs !== null) {
    console.info(`  print        ${context.shotPath}  (t=+${summary.worstPhaseMs} ms)`);
  }
  printLowest(summary.lowest);
  printNotDrawn(summary.notDrawn, context.floor);
  if (report.unstable.length > 0) {
    const drifting =
      report.driftingBands > 0
        ? ` (${report.driftingBands} faixa(s) seguiram se mexendo mesmo congeladas)`
        : '';
    console.info(
      `\n  ${report.unstable.length} elemento(s) sobre fundo que não parou entre duas fotos — ` +
        `não foram medidos${drifting}.`,
    );
  }
  explainVerdict(report, summary.unstableFraction);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const target = resolveTarget(args);
  const settings = readSettings(args, section(target.config, 'contrast'), target.projectRoot);

  const preview = await startPreview({
    projectRoot: target.projectRoot,
    url: target.url,
    port: target.port,
    command: target.previewCommand,
  });
  const { browser, renderer } = await launchRealGpu({ projectRoot: target.projectRoot });
  const startedAt = Date.now();

  try {
    const measurement = await measurePage(browser, preview.url, {
      viewport: settings.viewport,
      selectors: settings.selectors,
      settleMs: settings.settleMs,
      reducedMotion: settings.reducedMotion,
      sweep: settings.sweep,
    });
    const summary = summarize({
      samples: measurement.samples,
      outcome: measurement.outcome,
      candidates: measurement.candidates,
      settings,
      renderer,
      durationMs: Date.now() - startedAt,
    });

    emitMeasurement('contrast', summary.report, target);
    const shot = measurement.outcome.worstShot;
    printSummary(summary, {
      configPath: target.configPath,
      floor: settings.floor,
      shotPath: shot === null ? null : saveWorstShot(shot, settings.shotPath),
    });
    process.exitCode = summary.exitCode;

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
  process.exitCode = EXIT_INVALID_MEASUREMENT;
});
