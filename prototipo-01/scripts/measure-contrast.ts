/// <reference lib="dom" />
// Parts of this file run inside the page (page.evaluate), so it needs the DOM lib on
// top of tsconfig.node.json — scoped here instead of widening the whole Node project.

/**
 * Measures WCAG contrast per pixel, from a screenshot — not from the CSS tokens.
 *
 * Reading `--fg` against `--bg` proves nothing: text sits on gradients, on canvas
 * output, on hover states and behind blends. So every visible run of text is captured
 * as a clip, the pixels are split into "ink" and "paper" by nearest reference colour,
 * and the ratio is computed from the median relative luminance of each group.
 *
 *   pnpm tsx scripts/measure-contrast.ts
 *
 * Exit codes: 0 ok · 1 below the 7:1 floor from prompt.md §6.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { launchRealGpu, PROJECT_ROOT, startPreview } from './lib/chrome';
import { nowIso, patchMeasurements } from './lib/measurements';
import type { Clip, ContrastWorstCase } from '../src/generated/types';
import type { Page } from 'playwright-core';

const MIN_CONTRAST = 7;
const VIEWPORT = { width: 1280, height: 720 };
const TEXT_SELECTORS = 'h1,h2,h3,h4,p,li,a,blockquote,figcaption,dt,dd,summary,label';
const WORST_SHOT_PATH = resolve(PROJECT_ROOT, '.forge/screenshots/contrast-worst.png');
const TEXT_SAMPLE_LENGTH = 30;
const MIN_CLIP_SIDE_PX = 4;

interface Candidate {
  readonly index: number;
  readonly selector: string;
  readonly text: string;
  readonly color: string;
}

interface PositionedClip extends Clip {
  readonly ok: boolean;
}

/** Tags every element that renders its own text and returns what we need to clip it. */
const tagTextElements = (options: { selectors: string; sampleLength: number }): Candidate[] => {
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
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    if (Number(style.opacity) === 0) continue;

    const rect = element.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) continue;

    const id = element.id ? `#${element.id}` : '';
    const cls = element.classList.length > 0 ? `.${element.classList[0]}` : '';
    element.setAttribute('data-contrast-idx', String(index));
    found.push({
      index,
      selector: `${element.tagName.toLowerCase()}${id}${cls}`,
      text: ownText.slice(0, options.sampleLength),
      color: style.color,
    });
    index += 1;
  }

  return found;
};

/** Scrolls one tagged element into view and returns its clip, clamped to the viewport. */
const clipForIndex = (index: number): PositionedClip => {
  const element = document.querySelector(`[data-contrast-idx="${index}"]`);
  if (element === null) return { x: 0, y: 0, width: 0, height: 0, ok: false };

  element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  const rect = element.getBoundingClientRect();
  const x = Math.max(0, Math.floor(rect.left));
  const y = Math.max(0, Math.floor(rect.top));
  const right = Math.min(window.innerWidth, Math.ceil(rect.right));
  const bottom = Math.min(window.innerHeight, Math.ceil(rect.bottom));
  const width = right - x;
  const height = bottom - y;
  return { x, y, width, height, ok: width >= 4 && height >= 4 };
};

/**
 * Splits a clip into ink and paper and returns the WCAG ratio of their median
 * luminances. The paper reference is the modal colour of the clip (text never covers
 * most of its own box); the ink reference is the element's computed `color`.
 * Pixels are only counted when they are unambiguously one or the other — antialiased
 * edges sit between the two references and would flatter the result.
 */
const analyzeClip = async (input: {
  base64: string;
  color: string;
}): Promise<number | null> => {
  const image = new Image();
  image.src = `data:image/png;base64,${input.base64}`;
  await image.decode();

  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) return null;
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixelCount = data.length / 4;
  if (pixelCount === 0) return null;

  // sRGB -> linear as a 256-entry table: one pow() per channel value instead of per pixel.
  const linear = new Float32Array(256);
  for (let value = 0; value < 256; value += 1) {
    const channel = value / 255;
    linear[value] =
      channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  }

  const parsed = input.color.match(/[\d.]+/g) ?? [];
  const inkRef = [Number(parsed[0] ?? 0), Number(parsed[1] ?? 0), Number(parsed[2] ?? 0)];

  // Modal colour in 12-bit buckets = the background of this clip.
  const histogram = new Map<number, number>();
  for (let i = 0; i < pixelCount; i += 1) {
    const offset = i * 4;
    const key =
      (((data[offset] ?? 0) >> 4) << 8) |
      (((data[offset + 1] ?? 0) >> 4) << 4) |
      ((data[offset + 2] ?? 0) >> 4);
    histogram.set(key, (histogram.get(key) ?? 0) + 1);
  }
  let modalKey = -1;
  let modalCount = -1;
  for (const [key, count] of histogram) {
    if (count > modalCount) {
      modalCount = count;
      modalKey = key;
    }
  }

  let paperR = 0;
  let paperG = 0;
  let paperB = 0;
  let paperN = 0;
  for (let i = 0; i < pixelCount; i += 1) {
    const offset = i * 4;
    const r = data[offset] ?? 0;
    const g = data[offset + 1] ?? 0;
    const b = data[offset + 2] ?? 0;
    if ((((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4) | 0) !== modalKey) continue;
    paperR += r;
    paperG += g;
    paperB += b;
    paperN += 1;
  }
  if (paperN === 0) return null;
  const paperRef = [paperR / paperN, paperG / paperN, paperB / paperN];

  const referenceDistance = Math.hypot(
    (inkRef[0] ?? 0) - (paperRef[0] ?? 0),
    (inkRef[1] ?? 0) - (paperRef[1] ?? 0),
    (inkRef[2] ?? 0) - (paperRef[2] ?? 0),
  );
  // Ink and paper are the same colour: there is nothing readable to measure here.
  if (referenceDistance < 8) return null;

  const inkDistance = new Float32Array(pixelCount);
  const paperDistance = new Float32Array(pixelCount);
  const luminance = new Float32Array(pixelCount);
  for (let i = 0; i < pixelCount; i += 1) {
    const offset = i * 4;
    const r = data[offset] ?? 0;
    const g = data[offset + 1] ?? 0;
    const b = data[offset + 2] ?? 0;
    inkDistance[i] = Math.hypot(
      r - (inkRef[0] ?? 0),
      g - (inkRef[1] ?? 0),
      b - (inkRef[2] ?? 0),
    );
    paperDistance[i] = Math.hypot(
      r - (paperRef[0] ?? 0),
      g - (paperRef[1] ?? 0),
      b - (paperRef[2] ?? 0),
    );
    luminance[i] =
      0.2126 * (linear[r] ?? 0) + 0.7152 * (linear[g] ?? 0) + 0.0722 * (linear[b] ?? 0);
  }

  // Thin serif strokes may never reach the pure ink colour; relax the purity band until
  // there is a usable sample instead of throwing the element away.
  const MIN_SAMPLE = 8;
  let ink: number[] = [];
  let paper: number[] = [];
  for (const purity of [0.25, 0.5, 0.9]) {
    const band = purity * referenceDistance;
    ink = [];
    paper = [];
    for (let i = 0; i < pixelCount; i += 1) {
      const toInk = inkDistance[i] ?? 0;
      const toPaper = paperDistance[i] ?? 0;
      if (toInk < toPaper && toInk <= band) ink.push(luminance[i] ?? 0);
      else if (toPaper <= toInk && toPaper <= band) paper.push(luminance[i] ?? 0);
    }
    if (ink.length >= MIN_SAMPLE && paper.length >= MIN_SAMPLE) break;
  }
  if (ink.length < MIN_SAMPLE || paper.length < MIN_SAMPLE) return null;

  ink.sort((a, b) => a - b);
  paper.sort((a, b) => a - b);
  const inkMedian = ink[ink.length >> 1] ?? 0;
  const paperMedian = paper[paper.length >> 1] ?? 0;
  const lighter = Math.max(inkMedian, paperMedian);
  const darker = Math.min(inkMedian, paperMedian);
  return (lighter + 0.05) / (darker + 0.05);
};

async function measureCandidate(
  page: Page,
  candidate: Candidate,
): Promise<{ ratio: number; clip: Clip } | null> {
  const clip = await page.evaluate(clipForIndex, candidate.index);
  if (!clip.ok || clip.width < MIN_CLIP_SIDE_PX || clip.height < MIN_CLIP_SIDE_PX) return null;

  const rect: Clip = { x: clip.x, y: clip.y, width: clip.width, height: clip.height };
  const shot = await page.screenshot({ clip: rect });
  const ratio = await page.evaluate(analyzeClip, {
    base64: shot.toString('base64'),
    color: candidate.color,
  });
  if (ratio === null || !Number.isFinite(ratio)) return null;
  return { ratio, clip: rect };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

async function main(): Promise<void> {
  const preview = await startPreview();
  const { browser, renderer } = await launchRealGpu();

  try {
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.goto(preview.url, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);

    const candidates = await page.evaluate(tagTextElements, {
      selectors: TEXT_SELECTORS,
      sampleLength: TEXT_SAMPLE_LENGTH,
    });

    let worst: ContrastWorstCase | null = null;
    let worstIndex = -1;
    let measured = 0;
    for (const candidate of candidates) {
      const result = await measureCandidate(page, candidate);
      if (result === null) continue;
      measured += 1;
      if (worst === null || result.ratio < worst.ratio) {
        worstIndex = candidate.index;
        worst = {
          selector: candidate.selector,
          text: candidate.text,
          ratio: round(result.ratio),
          screenshotClip: result.clip,
        };
      }
    }

    const minContrast = worst === null ? 0 : worst.ratio;
    patchMeasurements({
      contrast: { minContrast, worst, measured, measuredAt: nowIso() },
    });

    console.info(`\ncontraste (por pixel, ${VIEWPORT.width}x${VIEWPORT.height})`);
    console.info(`  renderer     ${renderer}`);
    console.info(`  elementos    ${measured} medidos de ${candidates.length} candidatos`);
    console.info(`  minContrast  ${minContrast.toFixed(2)} : 1  (piso ${MIN_CONTRAST})`);
    if (worst !== null) {
      console.info(`  pior caso    ${worst.selector} — "${worst.text}"`);
      // Re-scroll to the offender so the clip lines up with what we measured.
      await page.evaluate(clipForIndex, worstIndex);
      mkdirSync(dirname(WORST_SHOT_PATH), { recursive: true });
      const shot = await page.screenshot({ clip: worst.screenshotClip });
      writeFileSync(WORST_SHOT_PATH, shot);
      console.info(`  print        .forge/screenshots/contrast-worst.png`);
    }

    if (measured === 0 || minContrast < MIN_CONTRAST) {
      console.error(`\nABAIXO DO PISO: ${minContrast.toFixed(2)} < ${MIN_CONTRAST}`);
      process.exitCode = 1;
    } else {
      console.info('\nOK — todo texto acima de 7:1.');
    }

    await context.close();
  } finally {
    await browser.close();
    await preview.stop();
  }
}

await main();
