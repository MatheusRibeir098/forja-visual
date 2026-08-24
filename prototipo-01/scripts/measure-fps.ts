/// <reference lib="dom" />
// Parts of this file run inside the page (page.evaluate), so it needs the DOM lib on
// top of tsconfig.node.json — scoped here instead of widening the whole Node project.

/**
 * Measures frame pacing during an automated scroll, on a real GPU.
 *
 * The whole point of this script is the guard at the top: headless Chrome happily
 * renders through SwiftShader and reports a smooth-looking frame rate that has nothing
 * to do with what a user gets. If the renderer is software we exit 2 ("measurement
 * invalid") instead of exiting 0 with a comfortable lie.
 *
 *   pnpm tsx scripts/measure-fps.ts                  # tier high + tier low
 *   pnpm tsx scripts/measure-fps.ts --low            # only the mobile pass
 *   pnpm tsx scripts/measure-fps.ts --min=30         # override the tier-high floor
 *   pnpm tsx scripts/measure-fps.ts --force-swiftshader   # must exit 2
 *
 * Exit codes: 0 ok · 1 below budget · 2 measurement invalid (software renderer).
 */
import { launchRealGpu, isSoftwareRenderer, startPreview } from './lib/chrome';
import { nowIso, patchMeasurements } from './lib/measurements';
import type { FpsMeasurement } from '../src/generated/types';
import type { Browser } from 'playwright-core';

const EXIT_BUDGET = 1;
const EXIT_INVALID_MEASUREMENT = 2;

const SAMPLE_DURATION_MS = 5_000;
/**
 * A vsync-locked 60 Hz compositor lands on 59.9x as often as on 60.0 — timer jitter,
 * not dropped frames. One frame of slack keeps the check honest without flapping.
 */
const VSYNC_TOLERANCE_FPS = 1;
const WARMUP_FRAMES = 5;

interface PassConfig {
  readonly tier: string;
  readonly width: number;
  readonly height: number;
  readonly deviceScaleFactor: number;
  readonly minFps: number;
}

/** dpr 2 is the worst realistic fill rate for a premium desktop, so tier high uses it. */
const HIGH_PASS: PassConfig = {
  tier: 'high',
  width: 1280,
  height: 720,
  deviceScaleFactor: 2,
  minFps: 60,
};

const LOW_PASS: PassConfig = {
  tier: 'low',
  width: 375,
  height: 667,
  deviceScaleFactor: 1,
  minFps: 30,
};

interface Cli {
  readonly forceSoftware: boolean;
  readonly onlyLow: boolean;
  readonly minOverride: number | null;
}

function parseCli(argv: readonly string[]): Cli {
  const minArg = argv.find((arg) => arg.startsWith('--min='));
  const parsed = minArg === undefined ? Number.NaN : Number(minArg.slice('--min='.length));
  return {
    forceSoftware: argv.includes('--force-swiftshader'),
    onlyLow: argv.includes('--low'),
    minOverride: Number.isFinite(parsed) ? parsed : null,
  };
}

function percentile(sortedAsc: readonly number[], fraction: number): number {
  if (sortedAsc.length === 0) return 0;
  const index = Math.min(sortedAsc.length - 1, Math.floor(fraction * sortedAsc.length));
  return sortedAsc[index] ?? 0;
}

function median(sortedAsc: readonly number[]): number {
  if (sortedAsc.length === 0) return 0;
  const middle = sortedAsc.length >> 1;
  if (sortedAsc.length % 2 === 1) return sortedAsc[middle] ?? 0;
  return ((sortedAsc[middle - 1] ?? 0) + (sortedAsc[middle] ?? 0)) / 2;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Records one rAF timestamp per frame while scrolling ~1 viewport per second.
 *
 * Written as an await-loop with no named inner functions on purpose: tsx compiles with
 * esbuild's `keepNames`, and a named inner function would drag a `__name(...)` helper
 * into the source Playwright serializes into the page, where it does not exist.
 */
const collectFrameTimestamps = async (durationMs: number): Promise<number[]> => {
  // The stylesheet asks for smooth scrolling; that would animate our scroll target and
  // measure the easing instead of the page. Force instant jumps for the run.
  const previousBehavior = document.documentElement.style.scrollBehavior;
  document.documentElement.style.scrollBehavior = 'auto';

  const timestamps: number[] = [];
  const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const pixelsPerMs = window.innerHeight / 1000;
  const start = performance.now();
  let elapsed = 0;

  while (elapsed < durationMs) {
    const now = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
    timestamps.push(now);
    elapsed = now - start;
    if (maxScroll > 0) window.scrollTo(0, Math.min(maxScroll, elapsed * pixelsPerMs));
  }

  document.documentElement.style.scrollBehavior = previousBehavior;
  return timestamps;
};

async function runPass(
  browser: Browser,
  url: string,
  renderer: string,
  config: PassConfig,
): Promise<FpsMeasurement> {
  const context = await browser.newContext({
    viewport: { width: config.width, height: config.height },
    deviceScaleFactor: config.deviceScaleFactor,
  });
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(500);

    const timestamps = await page.evaluate(collectFrameTimestamps, SAMPLE_DURATION_MS);
    const instantFps = timestamps
      .slice(WARMUP_FRAMES)
      .map((timestamp, index, list) =>
        index === 0 ? null : 1000 / (timestamp - (list[index - 1] ?? timestamp)),
      )
      .filter((fps): fps is number => fps !== null && Number.isFinite(fps));
    const sorted = [...instantFps].sort((a, b) => a - b);

    return {
      fpsMedian: round(median(sorted)),
      fpsP5: round(percentile(sorted, 0.05)),
      renderer,
      tier: config.tier,
      durationS: SAMPLE_DURATION_MS / 1000,
      viewport: `${config.width}x${config.height}@${config.deviceScaleFactor}x`,
      measuredAt: nowIso(),
    };
  } finally {
    await context.close();
  }
}

function report(measurement: FpsMeasurement, minFps: number): boolean {
  const ok = measurement.fpsMedian >= minFps - VSYNC_TOLERANCE_FPS;
  console.info(
    `  tier ${measurement.tier.padEnd(4)} ${measurement.viewport.padEnd(14)} ` +
      `mediana ${measurement.fpsMedian.toFixed(1)} fps · p5 ${measurement.fpsP5.toFixed(1)} fps ` +
      `· piso ${minFps} → ${ok ? 'OK' : 'ABAIXO DO ORÇAMENTO'}`,
  );
  return ok;
}

async function main(): Promise<void> {
  const cli = parseCli(process.argv.slice(2));
  const preview = await startPreview();
  const { browser, renderer, mode } = await launchRealGpu({ forceSoftware: cli.forceSoftware });

  try {
    console.info(`\nfps: chrome ${mode}\n  renderer: ${renderer}`);

    if (isSoftwareRenderer(renderer)) {
      console.error(
        '\nMEDIÇÃO INVÁLIDA: GPU por software.\n' +
          `  O renderer "${renderer}" é um rasterizador de CPU — o FPS medido aqui não\n` +
          '  descreve nenhum usuário real. Rode numa máquina com driver de GPU acessível\n' +
          '  (ou remova --force-swiftshader).',
      );
      process.exitCode = EXIT_INVALID_MEASUREMENT;
      return;
    }

    const highMin = cli.minOverride ?? HIGH_PASS.minFps;
    let withinBudget = true;

    if (!cli.onlyLow) {
      const high = await runPass(browser, preview.url, renderer, HIGH_PASS);
      withinBudget = report(high, highMin) && withinBudget;
      patchMeasurements({ fps: high });
    }

    const low = await runPass(browser, preview.url, renderer, LOW_PASS);
    withinBudget = report(low, cli.minOverride ?? LOW_PASS.minFps) && withinBudget;
    patchMeasurements({ fpsLow: low });

    if (!withinBudget) process.exitCode = EXIT_BUDGET;
  } finally {
    await browser.close();
    await preview.stop();
  }
}

await main();
