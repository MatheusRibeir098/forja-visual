/// <reference lib="dom" />
// Parts of this file run inside the page (page.evaluate), so it needs the DOM lib on
// top of tsconfig.node.json — scoped here instead of widening the whole Node project.

/**
 * Launching a Chrome that actually uses the GPU.
 *
 * Lesson carried over from portfolio-3d: headless Chrome silently falls back to
 * SwiftShader (a CPU rasterizer) and still reports plausible-looking frame rates.
 * A measurement taken there is worse than no measurement, so every script that
 * measures rendering goes through `launchRealGpu()` and checks `renderer` first.
 *
 * Measured on this machine (Arch Linux, Chrome 151, Intel RPL-U, 2026-08):
 *   headless + no flags            -> ANGLE (Google, ... SwiftShader driver)      [invalid]
 *   headless + --use-gl=angle
 *              --use-angle=gl      -> ANGLE (Intel, Mesa Intel(R) Graphics (RPL-U)) [valid]
 *   headed  + no flags             -> ANGLE (Intel, Mesa Intel(R) Graphics (RPL-U)) [valid]
 * So headless with the ANGLE/GL backend is enough here; the headed fallback below
 * exists for machines where it is not.
 */
import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';

export const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Renderer strings that mean "the CPU drew this" — any FPS taken here is fiction. */
const SOFTWARE_RENDERER_PATTERN = /SwiftShader|llvmpipe|Mesa OffScreen|Software|Disabled/i;

/** ANGLE over desktop GL is the combination that reaches the real driver headlessly. */
const REAL_GPU_ARGS = [
  '--use-gl=angle',
  '--use-angle=gl',
  '--enable-gpu',
  '--ignore-gpu-blocklist',
  '--enable-gpu-rasterization',
];

/** Deliberate software path, used by `--force-swiftshader` to prove the guard works. */
const SOFTWARE_GPU_ARGS = ['--use-gl=angle', '--use-angle=swiftshader'];

const CHROME_CANDIDATES = [
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/opt/google/chrome/chrome',
  '/snap/bin/chromium',
];

/** Resolves the system Chrome. `CHROME_PATH` wins, so CI can point somewhere else. */
export function findChromeBinary(): string {
  const fromEnv = process.env['CHROME_PATH'];
  const candidates = fromEnv ? [fromEnv, ...CHROME_CANDIDATES] : CHROME_CANDIDATES;

  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not installed at this path; try the next one.
    }
  }

  throw new Error(
    `Chrome não encontrado. Instale o Chrome/Chromium ou aponte CHROME_PATH para o binário.\n` +
      `Procurei em: ${candidates.join(', ')}`,
  );
}

export function isSoftwareRenderer(renderer: string): boolean {
  return SOFTWARE_RENDERER_PATTERN.test(renderer);
}

/** Reads `WEBGL_debug_renderer_info` from a throwaway context on the current page. */
export async function getRendererName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return 'no-webgl';
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const param = debugInfo ? debugInfo.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    return String(gl.getParameter(param));
  });
}

async function probeRenderer(browser: Browser): Promise<string> {
  const page = await browser.newPage();
  try {
    return await getRendererName(page);
  } finally {
    await page.close();
  }
}

export interface GpuBrowser {
  readonly browser: Browser;
  readonly renderer: string;
  /** Which launch strategy produced this browser — printed by the scripts. */
  readonly mode: 'headless-angle-gl' | 'headed-angle-gl' | 'forced-software';
}

export interface LaunchOptions {
  /** Ask for SwiftShader on purpose, to check that the software guard trips. */
  readonly forceSoftware?: boolean;
  readonly extraArgs?: readonly string[];
}

/**
 * Launches Chrome and reports which renderer it ended up with. Never throws on a
 * software renderer — the caller decides whether that is fatal (FPS) or fine (contrast).
 */
export async function launchRealGpu(options: LaunchOptions = {}): Promise<GpuBrowser> {
  const executablePath = findChromeBinary();
  const extraArgs = [...(options.extraArgs ?? [])];

  if (options.forceSoftware) {
    const browser = await chromium.launch({
      executablePath,
      headless: true,
      args: [...SOFTWARE_GPU_ARGS, ...extraArgs],
    });
    return { browser, renderer: await probeRenderer(browser), mode: 'forced-software' };
  }

  const headlessBrowser = await chromium.launch({
    executablePath,
    headless: true,
    args: [...REAL_GPU_ARGS, ...extraArgs],
  });
  const headlessRenderer = await probeRenderer(headlessBrowser);
  if (!isSoftwareRenderer(headlessRenderer)) {
    return { browser: headlessBrowser, renderer: headlessRenderer, mode: 'headless-angle-gl' };
  }

  // Headless could not reach the driver: retry with a real window (needs DISPLAY,
  // or a wrapper such as `xvfb-run tsx scripts/measure-fps.ts`).
  await headlessBrowser.close();
  const headedBrowser = await chromium.launch({
    executablePath,
    headless: false,
    args: [...REAL_GPU_ARGS, ...extraArgs],
  });
  return {
    browser: headedBrowser,
    renderer: await probeRenderer(headedBrowser),
    mode: 'headed-angle-gl',
  };
}

export interface PreviewServer {
  readonly url: string;
  /** No-op when the port was already served by someone else — we never kill foreign processes. */
  stop(): Promise<void>;
}

const PREVIEW_READY_TIMEOUT_MS = 40_000;
const PREVIEW_POLL_INTERVAL_MS = 250;

async function respondsOk(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'GET' });
    return response.ok;
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Serves `dist/` on `port`. If something already answers there (a preview the developer
 * left open), it is reused as-is and `stop()` does nothing — see skill `safe-operations`.
 */
export async function startPreview(port = 4173): Promise<PreviewServer> {
  const url = `http://localhost:${port}/`;

  if (await respondsOk(url)) {
    console.info(`preview: reaproveitando servidor já ativo em ${url}`);
    return { url, stop: async () => {} };
  }

  const child = spawn(
    'pnpm',
    ['exec', 'vite', 'preview', '--port', String(port), '--strictPort'],
    { cwd: PROJECT_ROOT, stdio: 'ignore', detached: true },
  );

  const stop = async (): Promise<void> => {
    if (child.exitCode !== null || child.pid === undefined) return;
    // Negative pid kills the whole process group: pnpm plus the vite it spawned.
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
    await delay(PREVIEW_POLL_INTERVAL_MS);
  };

  const deadline = Date.now() + PREVIEW_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`preview: o servidor saiu com código ${child.exitCode}`);
    }
    if (await respondsOk(url)) return { url, stop };
    await delay(PREVIEW_POLL_INTERVAL_MS);
  }

  await stop();
  throw new Error(`preview: ${url} não respondeu em ${PREVIEW_READY_TIMEOUT_MS} ms`);
}
