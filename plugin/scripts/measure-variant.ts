/// <reference lib="dom" />
// Parte deste arquivo roda dentro da página (page.evaluate), então precisa da lib DOM em
// cima do tsconfig de Node — declarada aqui em vez de alargar o projeto inteiro.

/**
 * Os três números que separam uma variante das irmãs — medidos do pixel e do DOM.
 *
 * ── Por que este script existe ────────────────────────────────────────────────────────
 * Os checks de colisão 4, 5 e 6 da fase de divergência comparam `bgLuminance`,
 * `motionCoverage` e `typeScaleRatio` entre as três variantes. O método de cada um estava
 * descrito em prosa, e cada subagente de variante implementaria o seu: três implementações
 * diferentes do mesmo número, no exato ponto onde a comparação precisa ser exata. Comparar
 * números obtidos por métodos diferentes é comparar maçã com laranja — e a divergência
 * voltaria a falhar em silêncio, que é o defeito que a ferramenta existe para corrigir.
 * Aqui há **uma** implementação, e nenhum valor vem de declaração do agente que construiu.
 *
 * ── O que cada número é, e como é obtido ──────────────────────────────────────────────
 * **bgLuminance** — mediana da luminância relativa (Rec. 709, linearizada) do **fundo**,
 * não da tela. Duas fotos idênticas em enquadramento, com a página congelada: A como está e
 * B com a tinta de todo texto tornada transparente. B **é** o fundo — inclusive o que está
 * debaixo do glifo — então a mediana sai dele. Média da tela mentiria: texto claro sobre
 * fundo escuro a puxa para cima e uma variante escura seria lida como média. O relatório
 * imprime os dois valores lado a lado, justamente para essa diferença ficar visível.
 *
 * **motionCoverage** — fração de pixels cuja luma muda entre dois quadros distantes no
 * tempo, sem input nenhum. É diferença entre quadros, não contagem de elementos animados:
 * dez animações que ninguém vê dão cobertura baixa, e uma que toma a tela dá cobertura
 * alta. São três pares, com intervalos **diferentes de propósito** (1000, 1400 e 900 ms):
 * numa página de teste com um pulso de 3 s, o par de 1000 ms mediu 0,0000 e o de 1400 ms
 * mediu 0,0175 — dois quadros a 1 s de distância caem no mesmo ponto do ciclo com facilidade
 * demais. O primeiro par mantém o método literal da §5.2 do `divergencia.md`; o número
 * reportado é a mediana dos três, com o espalhamento ao lado. Além do limiar brando
 * (2/255, o da referência), sai um `strongMotionCoverage` com limiar duro: grão/dither
 * de tela cheia muda todo pixel em 1–2 níveis e satura o limiar brando — sem o segundo
 * número, "a página inteira treme 1 nível" e "a tela inteira se move" viram o mesmo 1,0.
 *
 * **typeScaleRatio** — maior ÷ menor `font-size` computado entre os nós de texto que estão
 * **na tela e visíveis** (`checkVisibility`, cor com alfa > 0). Do DOM, não do CSS-fonte:
 * `clamp()`, `vw` e herança só viram número depois de renderizados.
 *
 * ── Em que estado se mede, e por quê ──────────────────────────────────────────────────
 * **No repouso, depois da revelação de entrada, com a rolagem em 0 e sem input.** Um hero
 * abre com animação: no primeiro quadro o fundo ainda não é o fundo (costuma estar preto,
 * ou coberto por uma cortina) e metade do texto não tem glifo. Medir ali daria um número
 * que não descreve nem a variante nem o que o dono vai ver. Então esperamos `--settle`
 * (padrão 2500 ms, ajustável) antes de qualquer foto — e, como evidência de que isso
 * importa, o relatório traz também a mediana da tela no primeiro quadro após `load`
 * (`frameLuminanceAtLoad`): se ela for muito diferente da de repouso, a espera foi o que
 * separou o número certo do errado. Rolagem fica em 0 de propósito: `motionCoverage` mede
 * o que a página faz sozinha, e rolar mediria a resposta a um input.
 *
 * As duas fotos que isolam o fundo são tiradas com a página **congelada** (rAF desligado,
 * Web Animations pausada). Como o congelamento não alcança `setTimeout`/`setInterval`,
 * `<video>` nem GIF, uma terceira foto idêntica confere se ela parou mesmo: se não parou, a
 * medição sai `inconclusivo` (código 3) em vez de devolver um fundo de outro instante.
 *
 * ── O que este script NÃO faz ─────────────────────────────────────────────────────────
 * Ele **não decide colisão**. Duas variantes podem ter o mesmo número por acaso; comparar
 * as três e aplicar os limiares do `divergencia.md` é do orquestrador. A única comparação
 * daqui é contra a faixa que o próprio chamador passou em `--bg-min`/`--bg-max` (a faixa
 * pré-atribuída àquela variante) — sem faixa passada, não há reprovação possível.
 *
 *   tsx measure-variant.ts --project=. --url=http://localhost:5173/dev/a.html --id=A
 *   tsx measure-variant.ts --url=http://localhost:5173/dev/b.html --id=B --bg-min=.25 --bg-max=.45
 *
 * Argumentos: --project --url --port --dist --config --out --json
 *             --id=A --viewport=1280x720 --settle --gaps=1000,1400,900
 *             --type-scope=viewport|document
 *             --bg-min --bg-max --reduced-motion --shot=caminho.png --force-swiftshader
 * Saídas: 0 ok · 1 fora da faixa atribuída · 2 medição inválida (GPU de software) ·
 *         3 inconclusivo · 4 nada mensurável.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  CANVAS_CONVENTION_SELECTOR,
  isSoftwareRenderer,
  launchRealGpu,
  startPreview,
  tagWebglCanvases,
  WEBGL_CANVAS_ATTRIBUTE,
} from './lib/chrome';
import type { Browser } from './lib/chrome';
import {
  argFlag,
  argNumber,
  argString,
  nowIso,
  parseArgs,
  parseNumberList,
  readNumber,
  readNumberArray,
  readString,
  resolveTarget,
  round,
  section,
} from './lib/config';
import type { ConfigRecord, ParsedArgs } from './lib/config';
import { formatEnvironment, probeEnvironment } from './lib/env';
import { freezePage, unfreezePage } from './lib/page-state';
import { emitMeasurement } from './lib/report';
import type { MotionPair, TypeSample, VariantMeasurement } from './lib/report';

const EXIT_OUT_OF_BAND = 1;
const EXIT_INVALID_MEASUREMENT = 2;
const EXIT_INCONCLUSIVE = 3;
const EXIT_NOTHING_MEASURABLE = 4;

const DEFAULT_VIEWPORT = { width: 1280, height: 720 };
/**
 * Quanto se espera pela revelação de entrada antes da primeira foto. 2,5 s cobre com folga a
 * abertura típica de um hero (0,8–2 s de coreografia). Não é um número medido em site algum
 * — nenhum site desta ferramenta existe ainda —, é uma convenção conservadora: o relatório
 * imprime `frameLuminanceAtLoad` ao lado do valor de repouso justamente para quem lê poder
 * ver se ela foi suficiente, e `--settle` a ajusta.
 */
const DEFAULT_SETTLE_MS = 2_500;
/**
 * Intervalos entre os quatro quadros de movimento — três pares, com intervalos **diferentes
 * de propósito**.
 *
 * Motivo medido (2026-08-25, página de teste com um pulso `ease-in-out` de 3 s em
 * `alternate`): o par de 1000 ms devolveu cobertura **0,0000** e o de 1400 ms, 0,0175, na
 * mesma página. Dois quadros a 1 s podem cair no mesmo ponto do ciclo, ou nos dois extremos
 * chatos de um `ease-in-out`, e a página é lida como parada. Com três pares o número é uma
 * mediana de verdade, e um par azarado de fase não decide sozinho.
 */
const DEFAULT_GAPS_MS = [1_000, 1_400, 900];
/** Limiar da §5.2: luma (8 bits) que mudou mais que 2/255 conta como pixel que se moveu. */
const MOTION_SOFT_THRESHOLD = 2;
/** Limiar duro: separa movimento visível de grão/dither que treme 1–2 níveis na tela toda. */
const MOTION_STRONG_THRESHOLD = 16;
/** Espalhamento entre pares acima do qual o número de movimento não é reprodutível. */
const MOTION_SPREAD_LIMIT = 0.25;
/** Diferença mínima por canal para um pixel contar como tinta (mesmo valor do contraste). */
const INK_THRESHOLD = 12;
/** Bins do histograma: 4096 dão resolução de 0,00024 — sobra para faixas que começam em 0,02. */
const LUMINANCE_BINS = 4_096;
const PALETTE_SIZE = 3;
/**
 * Distância mínima (soma das diferenças por canal, 0–765) entre dois tokens da paleta. Sem
 * ela, um gradiente suave enche os três primeiros baldes com tons vizinhos da mesma cor e a
 * "paleta" descreve a rampa, não a imagem.
 */
const PALETTE_MIN_DISTANCE = 24;
/**
 * Fração de pixels que pode diferir entre duas fotos idênticas com a página **congelada**.
 *
 * Medido em 2026-08-25 numa página de teste que acende a tela inteira em instantes
 * sorteados por `setTimeout`: `freezePage()` desliga o `requestAnimationFrame` e pausa a Web
 * Animations API, mas **não** para `setTimeout`/`setInterval`, `<video>` ou GIF. Quando a
 * página muda entre a foto com tinta e a foto sem tinta, a diferença entre elas deixa de ser
 * o glifo e o fundo medido é de outro instante — naquele teste, `inkPixelFraction` deu 100%
 * e as duas medianas ficaram a 0,80 de distância. Aqui isso vira `inconclusivo`, não um
 * número errado com cara de certo.
 */
const FROZEN_DRIFT_LIMIT = 0.02;
/**
 * Fração de tela a partir da qual a "tinta" isolada não pode ser texto.
 *
 * Segundo sinal do mesmo defeito, independente da deriva: a página de teste com mais tinta
 * possível (Arial Black, 300 px, doze `M` maiúsculos ocupando a tela) mediu **37,46%** —
 * glifo não passa disso porque letra é feita de vão. Quando o valor vai a 60% ou mais, o que
 * mudou entre as duas fotos foi a página, não o texto. Medido em 2026-08-25: a página que
 * acende a tela por `setTimeout` deu 100,00% nessa mesma leitura.
 */
const INK_FRACTION_SANITY_LIMIT = 0.6;
/** Abaixo disso não há glifo nenhum pintado: o texto existe no DOM e não está na tela. */
const NO_INK_LIMIT = 0.001;
/** Espera curta depois de mexer no estilo, para o repaint entrar na próxima foto. */
const REPAINT_MS = 40;
const TEXT_SAMPLE_LENGTH = 40;
const HIDDEN_ATTRIBUTE = 'data-forge-variant-hidden';
/** Elementos cujo texto existe no DOM e nunca é pintado como texto na tela. */
const NON_RENDERED_TAGS = 'SCRIPT,STYLE,NOSCRIPT,TEMPLATE,TITLE,HEAD,META,LINK,OPTION';

interface TypeReading {
  readonly selector: string;
  readonly text: string;
  readonly fontSizePx: number;
  readonly fontFamily: string;
}

interface CanvasReading {
  readonly selector: string | null;
  readonly followsConvention: boolean | null;
}

interface PairReading {
  readonly coverage: number;
  readonly strongCoverage: number;
}

interface FrameAnalysis {
  readonly bgLuminance: number;
  readonly frameLuminance: number;
  readonly frameLuminanceAtLoad: number;
  readonly inkPixelFraction: number;
  readonly frozenDrift: number;
  readonly palette: string[];
  readonly pairs: PairReading[];
  readonly imageWidth: number;
  readonly imageHeight: number;
}

/* ────────────────────────────── código que roda na página ────────────────────────────── */
/*
 * Todas as funções abaixo são serializadas para dentro do navegador. Elas são escritas como
 * uma arrow só, sem função nomeada dentro: o tsx compila com `keepNames` do esbuild, e uma
 * função interna nomeada arrastaria um helper `__name(...)` para o código enviado à página,
 * onde ele não existe.
 */

/**
 * Torna transparente a tinta de **todo** texto da página, sem mexer em layout nem em fundo.
 * O que sobra na foto seguinte é o fundo real, inclusive o que estava debaixo do glifo.
 */
const hideAllText = (options: { attribute: string; skipTags: string }): void => {
  const skip = new Set(options.skipTags.split(','));
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const targets = new Set<HTMLElement | SVGElement>();

  let node = walker.nextNode();
  while (node !== null) {
    // `parentElement` é tipado como HTMLElement, mas o pai de um texto dentro de <svg> é um
    // SVGElement de verdade — e ele também pinta glifo, então precisa entrar.
    const parent: Element | null = node.parentElement;
    const hasText = (node.textContent ?? '').trim().length > 0;
    if (
      hasText &&
      (parent instanceof HTMLElement || parent instanceof SVGElement) &&
      !skip.has(parent.tagName.toUpperCase())
    ) {
      targets.add(parent);
    }
    node = walker.nextNode();
  }

  for (const element of targets) {
    const style = getComputedStyle(element);
    // `background-clip: text` pinta o fundo *através* do glifo: cor transparente não apaga
    // nada ali, então o jeito de tirar essa tinta é esconder o elemento.
    const clipsToText =
      style.getPropertyValue('-webkit-background-clip') === 'text' ||
      style.getPropertyValue('background-clip') === 'text';
    // Guarda o style inline exato para devolver depois: o site pode ter cor inline própria,
    // e um `removeProperty` cego apagaria o estilo dele em vez do nosso.
    element.setAttribute(options.attribute, element.style.cssText);
    element.style.setProperty('transition', 'none', 'important');
    if (clipsToText) {
      element.style.setProperty('visibility', 'hidden', 'important');
    } else {
      element.style.setProperty('color', 'transparent', 'important');
      element.style.setProperty('-webkit-text-fill-color', 'transparent', 'important');
      element.style.setProperty('text-shadow', 'none', 'important');
    }
  }
};

const restoreAllText = (options: { attribute: string }): void => {
  for (const element of Array.from(document.querySelectorAll(`[${options.attribute}]`))) {
    if (!(element instanceof HTMLElement || element instanceof SVGElement)) continue;
    element.style.cssText = element.getAttribute(options.attribute) ?? '';
    element.removeAttribute(options.attribute);
  }
};

/**
 * `font-size` computado de cada trecho de texto que está de fato desenhado na tela. Um
 * registro por elemento: o tamanho é propriedade do elemento, não de cada nó de texto dele.
 */
const readTypeScale = (options: {
  viewportOnly: boolean;
  sampleLength: number;
  skipTags: string;
}): TypeReading[] => {
  const skip = new Set(options.skipTags.split(','));
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set<Element>();
  const readings: TypeReading[] = [];

  let node = walker.nextNode();
  while (node !== null) {
    const current = node;
    node = walker.nextNode();

    const text = (current.textContent ?? '').trim();
    const parent = current.parentElement;
    if (text.length === 0 || parent === null) continue;
    if (skip.has(parent.tagName.toUpperCase()) || seen.has(parent)) continue;

    const style = getComputedStyle(parent);
    // `checkVisibility` resolve a cadeia inteira de ancestrais (display, visibility,
    // opacity, content-visibility) — é o que separa "existe no DOM" de "está na tela".
    // Tipado à mão porque a lib DOM do TypeScript ainda não descreve todas as opções.
    const probe = parent as Element & {
      checkVisibility?: (options?: Record<string, boolean>) => boolean;
    };
    const visible =
      typeof probe.checkVisibility === 'function'
        ? probe.checkVisibility({
            opacityProperty: true,
            visibilityProperty: true,
            contentVisibilityAuto: true,
          })
        : style.display !== 'none' && style.visibility !== 'hidden';
    if (!visible) continue;

    // Texto com cor totalmente transparente é decoração/acessibilidade, não escala visível.
    const colorParts = style.color.match(/[\d.]+/g) ?? [];
    if (colorParts.length > 3 && Number(colorParts[3]) === 0) continue;

    const range = document.createRange();
    range.selectNodeContents(current);
    let drawn = false;
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width < 1 || rect.height < 1) continue;
      const offscreen =
        rect.bottom <= 0 ||
        rect.right <= 0 ||
        rect.top >= window.innerHeight ||
        rect.left >= window.innerWidth;
      if (options.viewportOnly && offscreen) continue;
      drawn = true;
      break;
    }
    if (!drawn) continue;

    const fontSizePx = Number.parseFloat(style.fontSize);
    if (!Number.isFinite(fontSizePx) || fontSizePx <= 0) continue;

    const id = parent.id ? `#${parent.id}` : '';
    const cls = parent.classList.length > 0 ? `.${parent.classList[0]}` : '';
    seen.add(parent);
    readings.push({
      selector: `${parent.tagName.toLowerCase()}${id}${cls}`,
      text: text.slice(0, options.sampleLength),
      fontSizePx,
      fontFamily: (style.fontFamily.split(',')[0] ?? '').replace(/["']/g, '').trim(),
    });
  }

  return readings;
};

/** Qual canvas WebGL a página tem, e se ele segue a convenção `id="gl"` do projeto. */
const findWebglCanvas = (options: {
  attribute: string;
  conventionSelector: string;
}): CanvasReading => {
  let best: HTMLCanvasElement | null = null;
  let bestArea = -1;
  for (const canvas of Array.from(document.querySelectorAll('canvas'))) {
    if (!canvas.hasAttribute(options.attribute)) continue;
    const area = canvas.width * canvas.height;
    if (area <= bestArea) continue;
    bestArea = area;
    best = canvas;
  }
  if (best === null) return { selector: null, followsConvention: null };

  const selector = best.id === '' ? `[${options.attribute}]` : `#${best.id}`;
  return { selector, followsConvention: selector === options.conventionSelector };
};

/**
 * Decodifica as fotos e devolve tudo que sai de pixel: as coberturas de movimento por par,
 * as medianas de luminância (fundo, tela, tela no load), a fração de tinta e a paleta.
 *
 * Uma passada só, com as imagens já decodificadas em memória: são seis quadros de 1280×720,
 * ~22 MB de RGBA — barato perto de fazer seis viagens de CDP com as mesmas imagens.
 */
const analyzeFrames = async (input: {
  atLoad: string;
  motion: readonly string[];
  rest: string;
  restStable: string;
  inkless: string;
  softThreshold: number;
  strongThreshold: number;
  inkThreshold: number;
  luminanceBins: number;
  paletteSize: number;
  paletteMinDistance: number;
}): Promise<FrameAnalysis | null> => {
  const planes: Uint8ClampedArray[] = [];
  let imageWidth = 0;
  let imageHeight = 0;
  const sources = [input.atLoad, ...input.motion, input.rest, input.restStable, input.inkless];
  for (const source of sources) {
    const image = new Image();
    image.src = `data:image/png;base64,${source}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) return null;
    context.drawImage(image, 0, 0);
    planes.push(context.getImageData(0, 0, canvas.width, canvas.height).data);
    imageWidth = canvas.width;
    imageHeight = canvas.height;
  }

  const motionPlanes = planes.slice(1, 1 + input.motion.length);
  const restPlane = planes[1 + input.motion.length];
  const restStablePlane = planes[2 + input.motion.length];
  const inklessPlane = planes[3 + input.motion.length];
  const atLoadPlane = planes[0];
  if (
    restPlane === undefined ||
    restStablePlane === undefined ||
    inklessPlane === undefined ||
    atLoadPlane === undefined
  ) {
    return null;
  }

  // sRGB -> linear como tabela de 256 entradas: um pow() por valor de canal, não por pixel.
  const linear = new Float32Array(256);
  for (let value = 0; value < 256; value += 1) {
    const channel = value / 255;
    linear[value] =
      channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  }

  // Movimento: luma em 8 bits (é nela que o limiar de 2/255 da referência faz sentido).
  const pairs: PairReading[] = [];
  for (let index = 1; index < motionPlanes.length; index += 1) {
    const before = motionPlanes[index - 1];
    const after = motionPlanes[index];
    if (before === undefined || after === undefined) continue;
    let moved = 0;
    let movedStrong = 0;
    let total = 0;
    for (let offset = 0; offset < after.length; offset += 4) {
      const lumaBefore =
        0.2126 * (before[offset] ?? 0) +
        0.7152 * (before[offset + 1] ?? 0) +
        0.0722 * (before[offset + 2] ?? 0);
      const lumaAfter =
        0.2126 * (after[offset] ?? 0) +
        0.7152 * (after[offset + 1] ?? 0) +
        0.0722 * (after[offset + 2] ?? 0);
      total += 1;
      const delta = Math.abs(lumaAfter - lumaBefore);
      if (delta <= input.softThreshold) continue;
      moved += 1;
      if (delta > input.strongThreshold) movedStrong += 1;
    }
    pairs.push({
      coverage: total === 0 ? 0 : moved / total,
      strongCoverage: total === 0 ? 0 : movedStrong / total,
    });
  }

  // Medianas de luminância relativa, por histograma: a mesma passada para os três quadros.
  const medians: number[] = [];
  for (const plane of [atLoadPlane, restPlane, inklessPlane]) {
    const histogram = new Int32Array(input.luminanceBins);
    let counted = 0;
    for (let offset = 0; offset < plane.length; offset += 4) {
      const luminance =
        0.2126 * (linear[plane[offset] ?? 0] ?? 0) +
        0.7152 * (linear[plane[offset + 1] ?? 0] ?? 0) +
        0.0722 * (linear[plane[offset + 2] ?? 0] ?? 0);
      const bin = Math.min(
        input.luminanceBins - 1,
        Math.round(luminance * (input.luminanceBins - 1)),
      );
      histogram[bin] = (histogram[bin] ?? 0) + 1;
      counted += 1;
    }
    let seen = 0;
    let median = 0;
    for (let bin = 0; bin < input.luminanceBins; bin += 1) {
      seen += histogram[bin] ?? 0;
      if (seen * 2 < counted) continue;
      median = bin / (input.luminanceBins - 1);
      break;
    }
    medians.push(median);
  }

  // Tinta = o que existe na foto de repouso e some quando o texto fica transparente. Com a
  // página congelada, essa diferença não tem mais nada dentro além do glifo.
  let inkPixels = 0;
  let driftPixels = 0;
  let totalPixels = 0;
  for (let offset = 0; offset < restPlane.length; offset += 4) {
    totalPixels += 1;
    const painted = Math.max(
      Math.abs((restPlane[offset] ?? 0) - (inklessPlane[offset] ?? 0)),
      Math.abs((restPlane[offset + 1] ?? 0) - (inklessPlane[offset + 1] ?? 0)),
      Math.abs((restPlane[offset + 2] ?? 0) - (inklessPlane[offset + 2] ?? 0)),
    );
    if (painted > input.inkThreshold) inkPixels += 1;
    // Duas fotos idênticas em enquadramento, com a página congelada: o que se mexeu aqui se
    // mexeu sozinho, e contamina a diferença que isola a tinta do fundo.
    const moved = Math.max(
      Math.abs((restPlane[offset] ?? 0) - (restStablePlane[offset] ?? 0)),
      Math.abs((restPlane[offset + 1] ?? 0) - (restStablePlane[offset + 1] ?? 0)),
      Math.abs((restPlane[offset + 2] ?? 0) - (restStablePlane[offset + 2] ?? 0)),
    );
    if (moved > input.inkThreshold) driftPixels += 1;
  }

  // Paleta: quantização de 5 bits por canal sobre o quadro de repouso, do balde mais cheio
  // ao menos cheio, exigindo distância mínima entre os escolhidos.
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  for (let offset = 0; offset < restPlane.length; offset += 4) {
    const r = restPlane[offset] ?? 0;
    const g = restPlane[offset + 1] ?? 0;
    const b = restPlane[offset + 2] ?? 0;
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, { count: 1, r, g, b });
    else {
      bucket.count += 1;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
    }
  }
  const palette: string[] = [];
  const picked: { r: number; g: number; b: number }[] = [];
  for (const bucket of [...buckets.values()].sort((a, b) => b.count - a.count)) {
    if (palette.length >= input.paletteSize) break;
    const r = Math.round(bucket.r / bucket.count);
    const g = Math.round(bucket.g / bucket.count);
    const b = Math.round(bucket.b / bucket.count);
    let tooClose = false;
    for (const other of picked) {
      const distance = Math.abs(other.r - r) + Math.abs(other.g - g) + Math.abs(other.b - b);
      if (distance < input.paletteMinDistance) tooClose = true;
    }
    if (tooClose) continue;
    picked.push({ r, g, b });
    palette.push(`#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`);
  }

  return {
    bgLuminance: medians[2] ?? 0,
    frameLuminance: medians[1] ?? 0,
    frameLuminanceAtLoad: medians[0] ?? 0,
    inkPixelFraction: totalPixels === 0 ? 0 : inkPixels / totalPixels,
    frozenDrift: totalPixels === 0 ? 0 : driftPixels / totalPixels,
    palette,
    pairs,
    imageWidth,
    imageHeight,
  };
};

/* ─────────────────────────────────── código de Node ─────────────────────────────────── */

interface CaptureOptions {
  readonly viewport: { readonly width: number; readonly height: number };
  readonly settleMs: number;
  readonly gapsMs: readonly number[];
  readonly reducedMotion: boolean;
  readonly typeScopeViewport: boolean;
}

interface VariantReading {
  readonly analysis: FrameAnalysis | null;
  readonly type: readonly TypeReading[];
  readonly canvas: CanvasReading;
  /** Quadro de repouso em base64, para `--shot` gravar sem fotografar de novo. */
  readonly restShot: string;
}

/**
 * Uma passada completa na variante: espera o repouso, fotografa o movimento, congela,
 * fotografa fundo com e sem tinta, e lê a escala tipográfica do DOM.
 */
async function captureVariant(
  browser: Browser,
  url: string,
  options: CaptureOptions,
): Promise<VariantReading> {
  const context = await browser.newContext({
    viewport: options.viewport,
    // dpr 1 de propósito: luminância e diferença entre quadros não melhoram com mais
    // amostras por pixel CSS, e a foto fica 4× menor para atravessar o CDP.
    deviceScaleFactor: 1,
    reducedMotion: options.reducedMotion ? 'reduce' : 'no-preference',
  });
  try {
    await tagWebglCanvases(context);
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));

    // Antes de esperar o repouso: é a evidência de que esperar mudou o número.
    const atLoad = (await page.screenshot()).toString('base64');
    await page.waitForTimeout(options.settleMs);

    // Movimento: nenhuma rolagem, nenhum ponteiro, nenhum clique entre as fotos.
    const motion: string[] = [(await page.screenshot()).toString('base64')];
    for (const gap of options.gapsMs) {
      await page.waitForTimeout(gap);
      motion.push((await page.screenshot()).toString('base64'));
    }

    await page.evaluate(freezePage);
    await page.waitForTimeout(REPAINT_MS);
    const rest = (await page.screenshot()).toString('base64');
    await page.evaluate(hideAllText, {
      attribute: HIDDEN_ATTRIBUTE,
      skipTags: NON_RENDERED_TAGS,
    });
    await page.waitForTimeout(REPAINT_MS);
    const inkless = (await page.screenshot()).toString('base64');
    await page.evaluate(restoreAllText, { attribute: HIDDEN_ATTRIBUTE });
    await page.waitForTimeout(REPAINT_MS);
    // Terceira foto, igual à primeira em enquadramento e com a tinta de volta: ela fecha
    // exatamente a janela usada para isolar tinta de fundo. Se a página mudou aqui dentro,
    // mudou também entre as duas fotos da diferença — e a diferença deixa de ser o glifo.
    const restStable = (await page.screenshot()).toString('base64');
    await page.evaluate(unfreezePage);

    const type = await page.evaluate(readTypeScale, {
      viewportOnly: options.typeScopeViewport,
      sampleLength: TEXT_SAMPLE_LENGTH,
      skipTags: NON_RENDERED_TAGS,
    });
    const canvas = await page.evaluate(findWebglCanvas, {
      attribute: WEBGL_CANVAS_ATTRIBUTE,
      conventionSelector: CANVAS_CONVENTION_SELECTOR,
    });
    const analysis = await page.evaluate(analyzeFrames, {
      atLoad,
      motion,
      rest,
      restStable,
      inkless,
      softThreshold: MOTION_SOFT_THRESHOLD,
      strongThreshold: MOTION_STRONG_THRESHOLD,
      inkThreshold: INK_THRESHOLD,
      luminanceBins: LUMINANCE_BINS,
      paletteSize: PALETTE_SIZE,
      paletteMinDistance: PALETTE_MIN_DISTANCE,
    });

    return { analysis, type, canvas, restShot: rest };
  } finally {
    await context.close();
  }
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function toTypeSample(reading: TypeReading | undefined): TypeSample | null {
  if (reading === undefined) return null;
  return {
    selector: reading.selector,
    text: reading.text,
    fontSizePx: round(reading.fontSizePx),
    fontFamily: reading.fontFamily,
  };
}

/** Famílias renderizadas, da mais usada para a menos — evidência do `typeClass` declarado. */
function rankFontFamilies(readings: readonly TypeReading[]): string[] {
  const counts = new Map<string, number>();
  for (const reading of readings) {
    if (reading.fontFamily === '') continue;
    counts.set(reading.fontFamily, (counts.get(reading.fontFamily) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([family]) => family);
}

function parseViewport(raw: string | undefined): { width: number; height: number } {
  if (raw === undefined) return DEFAULT_VIEWPORT;
  const match = /^(\d+)x(\d+)$/.exec(raw.trim());
  if (match === null) throw new Error(`--viewport=${raw}: use o formato 1280x720.`);
  return { width: Number(match[1]), height: Number(match[2]) };
}

function saveShot(base64: string, path: string): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, Buffer.from(base64, 'base64'));
    console.info(`  print        ${path}`);
  } catch (cause) {
    console.warn(`  aviso: não consegui salvar o print do repouso — ${String(cause)}`);
  }
}

function printReport(measurement: VariantMeasurement): void {
  const band =
    measurement.bgBand === null
      ? 'nenhuma faixa passada'
      : `faixa ${measurement.bgBand.min}–${measurement.bgBand.max} → ${
          measurement.inBand === true ? 'dentro' : 'FORA'
        }`;
  console.info(
    `  bgLuminance  ${measurement.bgLuminance.toFixed(4)}  (${band})\n` +
      `               tela inteira com tinta: ${measurement.frameLuminance.toFixed(4)} · ` +
      `no primeiro quadro após load: ${measurement.frameLuminanceAtLoad.toFixed(4)}\n` +
      `               tinta cobre ${(measurement.inkPixelFraction * 100).toFixed(2)}% da tela · ` +
      `deriva congelada ${(measurement.frozenDrift * 100).toFixed(2)}%`,
  );
  const pairs = measurement.motionPairs
    .map((pair) => `${pair.gapMs} ms → ${pair.coverage.toFixed(4)}`)
    .join(' · ');
  console.info(
    `  motionCoverage ${measurement.motionCoverage.toFixed(4)}  ` +
      `(limiar duro ${measurement.strongMotionCoverage.toFixed(4)})\n` +
      `               pares: ${pairs} · espalhamento ${measurement.motionSpread.toFixed(4)}`,
  );
  const largest = measurement.typeLargest;
  const smallest = measurement.typeSmallest;
  const scope =
    measurement.typeScope === 'viewport' ? 'de texto na tela' : 'de texto no documento';
  console.info(
    `  typeScaleRatio ${measurement.typeScaleRatio === null ? '—' : measurement.typeScaleRatio.toFixed(2)}` +
      `  (${measurement.typeSamples} elemento(s) ${scope})`,
  );
  if (largest !== null && smallest !== null) {
    console.info(
      `               maior ${largest.fontSizePx} px  ${largest.selector} — "${largest.text}"\n` +
        `               menor ${smallest.fontSizePx} px  ${smallest.selector} — "${smallest.text}"`,
    );
  }
  if (measurement.fontFamilies.length > 0) {
    console.info(`  fontes       ${measurement.fontFamilies.join(' · ')}`);
  }
  console.info(`  paleta       ${measurement.palette.join(' · ') || '—'}`);
  const canvas =
    measurement.webglCanvas === null
      ? 'nenhum canvas WebGL na página'
      : `${measurement.webglCanvas}${
          measurement.followsCanvasConvention === true
            ? ' (segue a convenção)'
            : ` ⚠ fora da convenção — o canvas WebGL do site deve ter id="gl"`
        }`;
  console.info(`  canvas       ${canvas}`);
}

interface Options {
  readonly id: string | null;
  readonly capture: CaptureOptions;
  readonly bgBand: { readonly min: number; readonly max: number } | null;
  readonly shotPath: string | null;
}

function readOptions(args: ParsedArgs, config: ConfigRecord, projectRoot: string): Options {
  const gapsRaw = argString(args, 'gaps');
  const gapsMs =
    gapsRaw === undefined
      ? (readNumberArray(config, 'gaps') ?? DEFAULT_GAPS_MS)
      : parseNumberList(gapsRaw, '--gaps');
  const bgMin = argNumber(args, 'bg-min') ?? readNumber(config, 'bgMin');
  const bgMax = argNumber(args, 'bg-max') ?? readNumber(config, 'bgMax');
  if ((bgMin === undefined) !== (bgMax === undefined)) {
    throw new Error('--bg-min e --bg-max andam juntos: passe os dois ou nenhum.');
  }
  const shot = argString(args, 'shot') ?? readString(config, 'shot');

  return {
    id: argString(args, 'id') ?? null,
    capture: {
      viewport: parseViewport(argString(args, 'viewport') ?? readString(config, 'viewport')),
      settleMs:
        argNumber(args, 'settle') ?? readNumber(config, 'settleMs') ?? DEFAULT_SETTLE_MS,
      gapsMs,
      // O padrão é medir com movimento ligado: `motionCoverage` de uma página em
      // reduced-motion mede o estado acessível, não a variante.
      reducedMotion: argFlag(args, 'reduced-motion') ?? false,
      typeScopeViewport:
        (argString(args, 'type-scope') ?? readString(config, 'typeScope') ?? 'viewport') !==
        'document',
    },
    bgBand: bgMin === undefined || bgMax === undefined ? null : { min: bgMin, max: bgMax },
    // Sem print por padrão: imagem é o item mais caro do loop de orquestração, e quem
    // captura print para o dono ver é o `visual-tester`.
    shotPath: shot === undefined ? null : resolve(projectRoot, shot),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const target = resolveTarget(args);
  const config = section(target.config, 'variant');
  const options = readOptions(args, config, target.projectRoot);

  // Cada variante grava num arquivo próprio: três variantes num arquivo só se apagariam, e
  // um card comparado contra o número de outra variante é a eleição fraudada da §7. Por
  // isso o `out` do arquivo de configuração — que é um caminho só, compartilhado pelos
  // outros medidores — é ignorado aqui: só `--out` explícito na linha de comando muda o
  // destino, e quem passa assume ter escolhido o arquivo desta variante.
  const slug = options.id === null ? 'variant' : `variant-${options.id.toLowerCase()}`;
  const explicitOut = argString(args, 'out');
  const emitTarget = {
    outFile:
      argFlag(args, 'out') === false
        ? null
        : explicitOut === undefined
          ? resolve(target.projectRoot, `.forge-visual/medicoes/${slug}.json`)
          : target.outFile,
    printJson: target.printJson,
  };

  // A máquina é amostrada ANTES de subir preview e Chrome: assim o que a amostra mede é o
  // ruído do ambiente, e não o nosso próprio trabalho.
  const environment = await probeEnvironment();

  const preview = await startPreview({
    projectRoot: target.projectRoot,
    url: target.url,
    port: target.port,
    command: target.previewCommand,
  });
  const { browser, renderer, mode } = await launchRealGpu({
    projectRoot: target.projectRoot,
    forceSoftware: argFlag(args, 'force-swiftshader') === true,
  });

  try {
    console.info(
      `\nvariante ${options.id ?? '(sem id)'}: chrome ${mode}\n  renderer     ${renderer}`,
    );
    if (target.configPath !== null) console.info(`  config       ${target.configPath}`);
    console.info(formatEnvironment(environment));

    // Mesma guarda do medidor de FPS: sob SwiftShader o canvas pode nem desenhar, e uma
    // cobertura de movimento tirada dali descreveria o rasterizador, não a variante.
    if (isSoftwareRenderer(renderer)) {
      console.error(
        '\nMEDIÇÃO INVÁLIDA: GPU por software.\n' +
          `  O renderer "${renderer}" é um rasterizador de CPU — o que ele desenha não é o\n` +
          '  que o dono vai ver, e comparar variantes por esses pixels é comparar outra\n' +
          '  coisa. Rode numa máquina com driver de GPU acessível.',
      );
      process.exitCode = EXIT_INVALID_MEASUREMENT;
      return;
    }

    const reading = await captureVariant(browser, preview.url, options.capture);
    const analysis = reading.analysis;
    const sortedType = [...reading.type].sort((a, b) => a.fontSizePx - b.fontSizePx);
    const smallest = sortedType[0];
    const largest = sortedType[sortedType.length - 1];

    if (analysis === null) {
      console.error(
        '\nNADA MENSURÁVEL: não consegui decodificar as fotos da página (canvas 2D indisponível).',
      );
      process.exitCode = EXIT_NOTHING_MEASURABLE;
      return;
    }

    const coverages = analysis.pairs.map((pair) => pair.coverage);
    const motionCoverage = median(coverages);
    const motionSpread =
      coverages.length === 0 ? 0 : Math.max(...coverages) - Math.min(...coverages);
    const motionPairs: MotionPair[] = analysis.pairs.map((pair, index) => ({
      gapMs: options.capture.gapsMs[index] ?? 0,
      coverage: round(pair.coverage, 4),
      strongCoverage: round(pair.strongCoverage, 4),
    }));
    const typeScaleRatio =
      smallest === undefined || largest === undefined || smallest.fontSizePx <= 0
        ? null
        : largest.fontSizePx / smallest.fontSizePx;
    const inBand =
      options.bgBand === null
        ? null
        : analysis.bgLuminance >= options.bgBand.min &&
          analysis.bgLuminance <= options.bgBand.max;
    const unstableMotion = motionSpread > MOTION_SPREAD_LIMIT;
    // A página não parou nem congelada: a foto com tinta e a foto sem tinta são de instantes
    // diferentes, e o fundo isolado entre elas não descreve nenhum dos dois.
    const frozenPageDrifted =
      analysis.frozenDrift > FROZEN_DRIFT_LIMIT ||
      analysis.inkPixelFraction > INK_FRACTION_SANITY_LIMIT;

    const verdict: VariantMeasurement['verdict'] =
      reading.type.length === 0
        ? 'nada-mensuravel'
        : frozenPageDrifted || unstableMotion
          ? 'inconclusivo'
          : inBand === false
            ? 'fora-da-faixa'
            : 'ok';

    const measurement: VariantMeasurement = {
      id: options.id,
      bgLuminance: round(analysis.bgLuminance, 4),
      frameLuminance: round(analysis.frameLuminance, 4),
      frameLuminanceAtLoad: round(analysis.frameLuminanceAtLoad, 4),
      inkPixelFraction: round(analysis.inkPixelFraction, 4),
      frozenDrift: round(analysis.frozenDrift, 4),
      bgBand: options.bgBand,
      inBand,
      motionCoverage: round(motionCoverage, 4),
      strongMotionCoverage: round(median(analysis.pairs.map((pair) => pair.strongCoverage)), 4),
      motionPairs,
      motionSpread: round(motionSpread, 4),
      typeScaleRatio: typeScaleRatio === null ? null : round(typeScaleRatio),
      typeLargest: toTypeSample(largest),
      typeSmallest: toTypeSample(smallest),
      typeSamples: reading.type.length,
      typeScope: options.capture.typeScopeViewport ? 'viewport' : 'document',
      fontFamilies: rankFontFamilies(reading.type),
      palette: analysis.palette,
      webglCanvas: reading.canvas.selector,
      followsCanvasConvention: reading.canvas.followsConvention,
      reducedMotion: options.capture.reducedMotion,
      settleMs: options.capture.settleMs,
      renderer,
      viewport: `${options.capture.viewport.width}x${options.capture.viewport.height}`,
      environment,
      verdict,
      measuredAt: nowIso(),
    };
    emitMeasurement('variant', measurement, emitTarget);

    console.info(
      `\n  medido em repouso (settle ${options.capture.settleMs} ms, rolagem 0, sem input)` +
        `${options.capture.reducedMotion ? ' · prefers-reduced-motion: reduce' : ''}`,
    );
    printReport(measurement);
    if (emitTarget.outFile !== null) console.info(`  saída        ${emitTarget.outFile}`);
    if (options.shotPath !== null) saveShot(reading.restShot, options.shotPath);

    if (verdict === 'nada-mensuravel') {
      console.error(
        '\nNADA MENSURÁVEL: nenhum nó de texto visível na tela — sem eles não há escala\n' +
          '  tipográfica para medir. Se o texto entra por revelação, aumente --settle;\n' +
          '  se ele está dentro do <canvas>, ele viola a proibição de texto em canvas.',
      );
      process.exitCode = EXIT_NOTHING_MEASURABLE;
      return;
    }
    if (verdict === 'inconclusivo') {
      console.error(
        frozenPageDrifted
          ? `\nINCONCLUSIVO: a página não parou congelada — ${(analysis.frozenDrift * 100).toFixed(2)}% da tela mudou entre\n` +
              `  duas fotos idênticas, e a "tinta" isolada cobriu ${(analysis.inkPixelFraction * 100).toFixed(2)}% (texto não passa\n` +
              '  de ~40%). O congelamento desliga requestAnimationFrame e\n' +
              '  pausa a Web Animations API — ele não alcança setTimeout/setInterval, <video> nem\n' +
              '  GIF. Enquanto isso rodar, a foto com tinta e a foto sem tinta são de instantes\n' +
              '  diferentes, e bgLuminance não descreve o fundo de nenhum deles. Corrija a fonte\n' +
              '  do movimento (a regra do projeto é um ticker só) e remeça.'
          : `\nINCONCLUSIVO: a cobertura de movimento variou ${motionSpread.toFixed(4)} entre os pares\n` +
              `  (limite ${MOTION_SPREAD_LIMIT})${environment.contended ? ', com a máquina disputada' : ''}.` +
              ' ANTES de mudar a variante: isole a máquina e\n' +
              '  remeça. Um número que não reproduz não descreve a página — e o check 5 da\n' +
              '  divergência compara justamente este número entre as três.',
      );
      process.exitCode = EXIT_INCONCLUSIVE;
      return;
    }
    if (verdict === 'fora-da-faixa' && options.bgBand !== null) {
      console.error(
        `\nFORA DA FAIXA ATRIBUÍDA: bgLuminance ${measurement.bgLuminance} não está em ` +
          `${options.bgBand.min}–${options.bgBand.max}.\n` +
          '  A faixa é pré-atribuição da divergência: quem re-briefa é o orquestrador.',
      );
      process.exitCode = EXIT_OUT_OF_BAND;
      return;
    }
    if (measurement.inkPixelFraction < NO_INK_LIMIT) {
      console.info(
        `\n  nota: ${reading.type.length} nó(s) de texto visíveis no DOM e nenhum glifo pintado na\n` +
          '        tela. bgLuminance segue válido (fundo é fundo), mas typeScaleRatio descreve\n' +
          '        texto que ninguém vê — algo o cobre, ou a revelação não terminou em\n' +
          `        ${options.capture.settleMs} ms. Confira com measure-contrast antes de comparar.`,
      );
    } else if (motionSpread > motionCoverage && motionCoverage > 0) {
      console.info(
        `\n  nota: os pares discordaram mais (${motionSpread.toFixed(4)}) do que o próprio\n` +
          `        valor (${motionCoverage.toFixed(4)}) — movimento lento e periódico, em que a\n` +
          '        fase do quadro pesa. A mediana dos pares é o número; se ele for decidir o\n' +
          '        check 5, meça de novo com mais pares (--gaps=1000,1400,900,1700).',
      );
    }
    console.info(
      '\nOK — três números medidos. A comparação entre variantes é do orquestrador.',
    );
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
