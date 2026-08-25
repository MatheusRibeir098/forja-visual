/// <reference lib="dom" />
// Parts of this file run inside the page (page.evaluate), so it needs the DOM lib on
// top of tsconfig.node.json — scoped here instead of widening the whole Node project.

/**
 * Measures frame pacing *and* GPU time per frame during an automated scroll, on a real GPU.
 *
 * The whole point of this script is the guard at the top: headless Chrome happily
 * renders through SwiftShader and reports a smooth-looking frame rate that has nothing
 * to do with what a user gets. If the renderer is software we exit 2 ("measurement
 * invalid") instead of exiting 0 with a comfortable lie.
 *
 * Frame pacing alone only tells you whether vsync was hit — it says nothing about how
 * much of the 16.67ms budget a frame actually spends on the GPU. So this script also
 * wraps each frame's draws in an `EXT_disjoint_timer_query_webgl2` query (begin/end,
 * not the timestamp counter flavor — ANGLE's timestamp queries are the flaky ones) and
 * reports GPU ms per frame, so a future post-processing pass knows how much headroom
 * it is spending against.
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

/** What a vsync-locked 60Hz compositor budgets for a whole frame's GPU work. */
const VSYNC_BUDGET_MS = 1000 / 60;

/**
 * How many `EXT_disjoint_timer_query_webgl2` queries can be in flight at once. A
 * query's result is never ready in the same frame it was recorded — the GPU runs
 * async relative to the JS thread — so one slot is not enough: while frame N's query
 * is still waiting on the driver, frame N+1's query needs to already be open.
 */
const GPU_QUERY_RING_SIZE = 4;

/** Extra rAF ticks kept alive after the sample window closes, to flush the last queries. */
const GPU_QUERY_DRAIN_FRAMES = 12;

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

/** Shape of `EXT_disjoint_timer_query_webgl2` — TypeScript's DOM lib does not know it. */
interface DisjointTimerQueryExt {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

interface FrameSampleOptions {
  readonly durationMs: number;
  readonly ringSize: number;
  readonly drainFrames: number;
}

interface FrameSampleResult {
  readonly timestamps: number[];
  /** GPU ms per frame, already filtered of disjoint intervals. */
  readonly gpuFrameMs: number[];
  /** How many query intervals were thrown away because the driver reported disjoint. */
  readonly gpuDisjointCount: number;
  /** Whether the timer query extension existed on this canvas's WebGL2 context. */
  readonly gpuTimerAvailable: boolean;
}

/**
 * Records one rAF timestamp per frame while scrolling ~1 viewport per second, and — when
 * the extension is available — one GPU timer query per frame.
 *
 * The app's own render loop (the site's single `requestAnimationFrame`) already ran by
 * the time our `await` resolves each iteration: our callback was registered after the
 * app's was already pending for the same frame, so it always runs later in that frame's
 * callback batch. That ordering is exactly what makes `endQuery` right after `await`
 * bracket *this* frame's draws, and the following `beginQuery` bracket the *next* one —
 * no changes to the app's render loop needed, we just read the same WebGL2 context the
 * app already created (`canvas.getContext('webgl2')` a second time returns the same
 * context object, per spec).
 *
 * Written as a single loop with no named inner functions, on purpose: tsx compiles with
 * esbuild's `keepNames`, and a named inner function/const-arrow would drag a `__name(...)`
 * helper into the source Playwright serializes into the page, where it does not exist.
 */
const collectFrameSamples = async (options: FrameSampleOptions): Promise<FrameSampleResult> => {
  const { durationMs, ringSize, drainFrames } = options;

  // The stylesheet asks for smooth scrolling; that would animate our scroll target and
  // measure the easing instead of the page. Force instant jumps for the run.
  const previousBehavior = document.documentElement.style.scrollBehavior;
  document.documentElement.style.scrollBehavior = 'auto';

  const timestamps: number[] = [];
  const gpuFrameMs: number[] = [];
  let gpuDisjointCount = 0;

  const canvasEl = document.getElementById('gl');
  const gl: WebGL2RenderingContext | null =
    canvasEl instanceof HTMLCanvasElement ? canvasEl.getContext('webgl2') : null;
  const ext: DisjointTimerQueryExt | null =
    gl === null
      ? null
      : (gl.getExtension('EXT_disjoint_timer_query_webgl2') as DisjointTimerQueryExt | null);
  const gpuTimerAvailable = gl !== null && ext !== null;

  const queries: WebGLQuery[] =
    gl !== null && gpuTimerAvailable ? Array.from({ length: ringSize }, () => gl.createQuery()) : [];
  let writeIndex = 0;
  let readIndex = 0;
  let pendingCount = 0;
  let hasOpenQuery = false;

  const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const pixelsPerMs = window.innerHeight / 1000;
  const start = performance.now();
  let elapsed = 0;
  let drainFramesLeft = drainFrames;

  // Two phases sharing one rAF-driven loop: while `elapsed < durationMs` we scroll and
  // record fps timestamps; once the window closes we keep ticking rAF for
  // `drainFramesLeft` more frames purely so the last GPU queries can resolve.
  while (elapsed < durationMs || drainFramesLeft > 0) {
    const inSampleWindow = elapsed < durationMs;
    const now = await new Promise<number>((resolve) => requestAnimationFrame(resolve));

    if (inSampleWindow) {
      timestamps.push(now);
    } else {
      drainFramesLeft -= 1;
    }
    elapsed = now - start;

    if (gl !== null && ext !== null) {
      if (hasOpenQuery) {
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        pendingCount += 1;
        hasOpenQuery = false;
      }

      // Results come back in submission order, so the first not-yet-available query
      // means every later one in the ring is not ready either — stop there.
      while (pendingCount > 0) {
        const query = queries[readIndex];
        if (query === undefined) break;
        if (gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE) !== true) break;

        if (gl.getParameter(ext.GPU_DISJOINT_EXT) === true) {
          gpuDisjointCount += 1;
        } else {
          const elapsedNs = gl.getQueryParameter(query, gl.QUERY_RESULT) as number;
          gpuFrameMs.push(elapsedNs / 1_000_000);
        }
        readIndex = (readIndex + 1) % ringSize;
        pendingCount -= 1;
      }

      // Only open a new query while still sampling, and only if the ring has a free
      // slot — a full ring means the driver is behind on readback; skip this frame
      // rather than clobber an unread result.
      if (inSampleWindow && pendingCount < ringSize) {
        const query = queries[writeIndex];
        if (query !== undefined) {
          gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
          hasOpenQuery = true;
          writeIndex = (writeIndex + 1) % ringSize;
        }
      }
    }

    if (inSampleWindow && maxScroll > 0) {
      window.scrollTo(0, Math.min(maxScroll, elapsed * pixelsPerMs));
    }
  }

  if (gl !== null) {
    for (const query of queries) gl.deleteQuery(query);
  }

  document.documentElement.style.scrollBehavior = previousBehavior;
  return { timestamps, gpuFrameMs, gpuDisjointCount, gpuTimerAvailable };
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

    const sample = await page.evaluate(collectFrameSamples, {
      durationMs: SAMPLE_DURATION_MS,
      ringSize: GPU_QUERY_RING_SIZE,
      drainFrames: GPU_QUERY_DRAIN_FRAMES,
    });

    const instantFps = sample.timestamps
      .slice(WARMUP_FRAMES)
      .map((timestamp, index, list) =>
        index === 0 ? null : 1000 / (timestamp - (list[index - 1] ?? timestamp)),
      )
      .filter((fps): fps is number => fps !== null && Number.isFinite(fps));
    const sortedFps = [...instantFps].sort((a, b) => a - b);

    const sortedGpuMs = [...sample.gpuFrameMs].sort((a, b) => a - b);
    const hasGpuSamples = sample.gpuTimerAvailable && sortedGpuMs.length > 0;
    const gpuFrameMsMedian = hasGpuSamples ? round(median(sortedGpuMs)) : null;
    const gpuFrameMsP95 = hasGpuSamples ? round(percentile(sortedGpuMs, 0.95)) : null;
    const gpuHeadroomMs = gpuFrameMsP95 === null ? null : round(VSYNC_BUDGET_MS - gpuFrameMsP95);

    return {
      fpsMedian: round(median(sortedFps)),
      fpsP5: round(percentile(sortedFps, 0.05)),
      renderer,
      tier: config.tier,
      durationS: SAMPLE_DURATION_MS / 1000,
      viewport: `${config.width}x${config.height}@${config.deviceScaleFactor}x`,
      measuredAt: nowIso(),
      gpuFrameMsMedian,
      gpuFrameMsP95,
      gpuHeadroomMs,
      gpuDisjointSamples: sample.gpuDisjointCount,
      gpuTimerAvailable: sample.gpuTimerAvailable,
    };
  } finally {
    await context.close();
  }
}

/** One-line GPU summary for `report()`, kept separate so `report()` stays readable. */
function formatGpuSummary(measurement: FpsMeasurement): string {
  if (measurement.gpuTimerAvailable !== true) {
    return 'GPU: EXT_disjoint_timer_query_webgl2 indisponível neste ambiente — sem tempo de GPU.';
  }

  const { gpuFrameMsMedian, gpuFrameMsP95, gpuHeadroomMs, gpuDisjointSamples } = measurement;
  if (
    typeof gpuFrameMsMedian !== 'number' ||
    typeof gpuFrameMsP95 !== 'number' ||
    typeof gpuHeadroomMs !== 'number'
  ) {
    return 'GPU: extensão presente, mas nenhuma amostra válida sobrou (tudo disjoint?).';
  }

  const discarded =
    typeof gpuDisjointSamples === 'number' && gpuDisjointSamples > 0
      ? ` · ${gpuDisjointSamples} amostra(s) descartada(s) por disjoint`
      : '';

  return (
    `GPU: mediana ${gpuFrameMsMedian.toFixed(2)} ms · p95 ${gpuFrameMsP95.toFixed(2)} ms · ` +
    `folga até ${VSYNC_BUDGET_MS.toFixed(2)} ms → ${gpuHeadroomMs.toFixed(2)} ms${discarded}`
  );
}

function report(measurement: FpsMeasurement, minFps: number): boolean {
  const ok = measurement.fpsMedian >= minFps - VSYNC_TOLERANCE_FPS;
  console.info(
    `  tier ${measurement.tier.padEnd(4)} ${measurement.viewport.padEnd(14)} ` +
      `mediana ${measurement.fpsMedian.toFixed(1)} fps · p5 ${measurement.fpsP5.toFixed(1)} fps ` +
      `· piso ${minFps} → ${ok ? 'OK' : 'ABAIXO DO ORÇAMENTO'}`,
  );
  console.info(`           ${formatGpuSummary(measurement)}`);
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
