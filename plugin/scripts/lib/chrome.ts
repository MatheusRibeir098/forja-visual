/// <reference lib="dom" />
// Parte deste arquivo roda dentro da página (page.evaluate), então precisa da lib DOM em
// cima do tsconfig de Node — declarada aqui em vez de alargar o projeto inteiro.

/**
 * Subir um Chrome que realmente usa a GPU — e um preview de qualquer projeto.
 *
 * Lição herdada do protótipo 01: o Chrome headless cai em silêncio para o SwiftShader (um
 * rasterizador de CPU) e mesmo assim reporta taxas de quadro plausíveis. Uma medição tirada
 * ali é pior do que nenhuma medição, então todo script que mede renderização passa por
 * `launchRealGpu()` e confere `renderer` antes de acreditar em qualquer número.
 *
 * Combinações medidas na máquina de referência (Arch Linux, Chrome 151, Intel RPL-U, 2026-08):
 *   headless + sem flags           -> ANGLE (Google, ... SwiftShader driver)        [inválido]
 *   headless + --use-gl=angle
 *              --use-angle=gl      -> ANGLE (Intel, Mesa Intel(R) Graphics (RPL-U)) [válido]
 *   com janela + sem flags         -> ANGLE (Intel, Mesa Intel(R) Graphics (RPL-U)) [válido]
 * Ou seja: headless com o backend ANGLE/GL basta aqui; o caminho com janela abaixo existe
 * para máquinas onde não bastar (precisa de DISPLAY — **não há xvfb** na máquina de
 * referência, então não conte com `xvfb-run`).
 *
 * Nada neste arquivo conhece um projeto específico: a raiz, a porta e o comando de preview
 * chegam por parâmetro.
 */
import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Clip } from './report';

/**
 * Tipos estruturais mínimos do Playwright.
 *
 * Por que não `import type { Page } from 'playwright-core'`: estes scripts moram no plugin e
 * medem projetos que estão em outro lugar do disco. O TypeScript resolve tipos a partir da
 * pasta **do arquivo**, então importar os tipos do Playwright exigiria um `node_modules`
 * dentro do plugin. Declarar a superfície usada — sete métodos — mantém os medidores
 * verificáveis em qualquer projeto que os rode.
 */
export interface ScreenshotOptions {
  readonly clip?: Clip;
}

export interface Page {
  goto(
    url: string,
    options?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit' },
  ): Promise<unknown>;
  evaluate<Result>(fn: () => Result | Promise<Result>): Promise<Result>;
  evaluate<Result, Arg>(fn: (arg: Arg) => Result | Promise<Result>, arg: Arg): Promise<Result>;
  screenshot(options?: ScreenshotOptions): Promise<Buffer>;
  waitForTimeout(ms: number): Promise<void>;
  close(): Promise<void>;
}

export interface BrowserContext {
  newPage(): Promise<Page>;
  addInitScript(script: { content: string }): Promise<void>;
  close(): Promise<void>;
}

export interface ContextOptions {
  readonly viewport?: { readonly width: number; readonly height: number };
  readonly deviceScaleFactor?: number;
  readonly reducedMotion?: 'reduce' | 'no-preference';
}

export interface Browser {
  newContext(options?: ContextOptions): Promise<BrowserContext>;
  newPage(): Promise<Page>;
  close(): Promise<void>;
}

interface ChromiumLauncher {
  launch(options: {
    executablePath: string;
    headless: boolean;
    args: readonly string[];
  }): Promise<Browser>;
}

/** Strings de renderer que significam "quem desenhou foi a CPU" — FPS medido aqui é ficção. */
const SOFTWARE_RENDERER_PATTERN = /SwiftShader|llvmpipe|Mesa OffScreen|Software|Disabled/i;

/** ANGLE sobre GL de desktop é a combinação que alcança o driver real sem janela. */
const REAL_GPU_ARGS = [
  '--use-gl=angle',
  '--use-angle=gl',
  '--enable-gpu',
  '--ignore-gpu-blocklist',
  '--enable-gpu-rasterization',
];

/** Caminho de software deliberado, usado por `--force-swiftshader` para provar a guarda. */
const SOFTWARE_GPU_ARGS = ['--use-gl=angle', '--use-angle=swiftshader'];

const CHROME_CANDIDATES = [
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/opt/google/chrome/chrome',
  '/snap/bin/chromium',
];

/** Resolve o Chrome do sistema. `CHROME_PATH` ganha, para a CI apontar para outro lugar. */
export function findChromeBinary(): string {
  const fromEnv = process.env['CHROME_PATH'];
  const candidates = fromEnv ? [fromEnv, ...CHROME_CANDIDATES] : CHROME_CANDIDATES;

  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Não instalado neste caminho; tenta o próximo.
    }
  }

  throw new Error(
    'Chrome não encontrado. Instale o Chrome/Chromium ou aponte CHROME_PATH para o binário.\n' +
      `Procurei em: ${candidates.join(', ')}`,
  );
}

/**
 * Carrega o `playwright-core` **do projeto medido** e, se não houver, do próprio plugin.
 *
 * O site gerado é quem tem a dependência (o `visual-tester` roda a partir dele); o plugin
 * pode nem ter `node_modules`. O especificador vai numa variável de propósito: com literal,
 * o TypeScript tentaria resolver o módulo em tempo de verificação e reclamaria em toda
 * máquina onde o plugin não tem a dependência instalada.
 */
export async function loadChromium(projectRoot: string): Promise<ChromiumLauncher> {
  const specifier = 'playwright-core';
  const attempts: string[] = [];

  try {
    const requireFromProject = createRequire(join(projectRoot, 'package.json'));
    const resolved = requireFromProject.resolve(specifier);
    const loaded: unknown = await import(pathToFileURL(resolved).href);
    return extractChromium(loaded);
  } catch (cause) {
    attempts.push(`a partir de ${projectRoot}: ${String(cause)}`);
  }

  try {
    const loaded: unknown = await import(specifier);
    return extractChromium(loaded);
  } catch (cause) {
    attempts.push(`a partir do plugin: ${String(cause)}`);
  }

  throw new Error(
    'playwright-core não encontrado. Adicione-o ao projeto medido:\n' +
      '  pnpm add -D playwright-core\n' +
      attempts.map((line) => `  · ${line}`).join('\n'),
  );
}

function extractChromium(module: unknown): ChromiumLauncher {
  const candidate =
    typeof module === 'object' && module !== null
      ? (module as { chromium?: unknown; default?: { chromium?: unknown } })
      : null;
  const chromium = candidate?.chromium ?? candidate?.default?.chromium;
  if (chromium === undefined || chromium === null) {
    throw new Error('o módulo carregado não expõe `chromium`.');
  }
  return chromium as ChromiumLauncher;
}

export function isSoftwareRenderer(renderer: string): boolean {
  return SOFTWARE_RENDERER_PATTERN.test(renderer);
}

/** Lê `WEBGL_debug_renderer_info` num contexto descartável da página atual. */
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
  /** Qual estratégia de lançamento produziu este browser — os scripts imprimem. */
  readonly mode: 'headless-angle-gl' | 'headed-angle-gl' | 'forced-software';
}

export interface LaunchOptions {
  readonly projectRoot: string;
  /** Pede SwiftShader de propósito, para conferir que a guarda de software dispara. */
  readonly forceSoftware?: boolean;
  readonly extraArgs?: readonly string[];
}

/**
 * Sobe o Chrome e reporta com qual renderer ele ficou. Nunca lança por renderer de software
 * — quem decide se isso é fatal (FPS) ou tolerável (contraste) é quem chamou.
 */
export async function launchRealGpu(options: LaunchOptions): Promise<GpuBrowser> {
  const chromium = await loadChromium(options.projectRoot);
  const executablePath = findChromeBinary();
  const extraArgs = [...(options.extraArgs ?? [])];

  if (options.forceSoftware === true) {
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

  // Headless não chegou ao driver: tenta de novo com janela real (exige DISPLAY).
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

/** Atributo com que marcamos, na página, todo canvas que pediu um contexto WebGL. */
export const WEBGL_CANVAS_ATTRIBUTE = 'data-forge-gl';

/**
 * **Convenção do projeto: o canvas WebGL do site tem `id="gl"`.**
 *
 * Ela existe para que o medidor e o site não precisem combinar nada em cada projeto: o
 * protótipo 01 já usava `#gl`, e fixar isso custa uma linha no HTML e evita `--canvas` em
 * toda invocação. Um site que a siga é medido sem argumento nenhum.
 */
export const CANVAS_CONVENTION_SELECTOR = '#gl';

/**
 * Padrão dos medidores: **a convenção primeiro, a instrumentação como rede**.
 *
 * `[data-forge-gl]` é posto por `tagWebglCanvases()` em qualquer canvas que peça contexto
 * WebGL, então um site que ignore a convenção continua sendo medido — só não é lido pelo
 * nome. Os dois no mesmo seletor porque quem consome escolhe o **maior** canvas entre os
 * casados, e não o primeiro: um site que segue a convenção cai no `#gl` de qualquer forma.
 */
export const DEFAULT_CANVAS_SELECTOR = `${CANVAS_CONVENTION_SELECTOR},[${WEBGL_CANVAS_ATTRIBUTE}]`;

/**
 * Instrumenta `getContext` **antes** do site carregar, para saber qual canvas é o do WebGL.
 *
 * O protótipo 01 podia procurar `#gl` porque o id era dele. Num site qualquer não dá: e
 * chamar `canvas.getContext('webgl2')` para descobrir é pior que inútil — num canvas que
 * ainda não tem contexto, essa chamada **cria** um contexto novo, vazio, e o medidor
 * passaria a cronometrar quadros em que nada é desenhado.
 */
export async function tagWebglCanvases(context: BrowserContext): Promise<void> {
  await context.addInitScript({
    content: `(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        const ctx = original.call(this, type, ...rest);
        if (ctx && typeof type === 'string' && type.indexOf('webgl') === 0) {
          this.setAttribute('${WEBGL_CANVAS_ATTRIBUTE}', type);
        }
        return ctx;
      };
    })();`,
  });
}

export interface PreviewServer {
  readonly url: string;
  /** Não faz nada quando a porta já era servida por outra pessoa — nunca matamos processo alheio. */
  stop(): Promise<void>;
}

const PREVIEW_READY_TIMEOUT_MS = 40_000;
const EXTERNAL_URL_TIMEOUT_MS = 5_000;
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

async function waitUntilOk(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await respondsOk(url)) return true;
    await delay(PREVIEW_POLL_INTERVAL_MS);
  }
  return false;
}

export interface PreviewOptions {
  readonly projectRoot: string;
  /** URL já servida por outra pessoa; quando presente, nada é iniciado. */
  readonly url: string | null;
  readonly port: number;
  /** Comando de preview; `{port}` é substituído pela porta escolhida. */
  readonly command: string;
}

/**
 * Entrega uma URL navegável para o site medido, na seguinte ordem:
 *   1. `--url` — o site já está no ar (inclusive em outra máquina)
 *   2. a porta já responde — reaproveita o preview que o dev deixou aberto, e `stop()` não faz nada
 *   3. roda o comando de preview do projeto e derruba só o que subiu
 */
export async function startPreview(options: PreviewOptions): Promise<PreviewServer> {
  if (options.url !== null) {
    if (!(await waitUntilOk(options.url, EXTERNAL_URL_TIMEOUT_MS))) {
      throw new Error(`preview: ${options.url} não respondeu (passado em --url).`);
    }
    return { url: options.url, stop: async () => {} };
  }

  const url = `http://localhost:${options.port}/`;
  if (await respondsOk(url)) {
    console.info(`preview: reaproveitando servidor já ativo em ${url}`);
    return { url, stop: async () => {} };
  }

  const command = options.command.replace(/\{port\}/g, String(options.port));
  const child = spawn('sh', ['-c', command], {
    cwd: options.projectRoot,
    stdio: 'ignore',
    detached: true,
  });

  const stop = async (): Promise<void> => {
    if (child.exitCode !== null || child.pid === undefined) return;
    // pid negativo mata o grupo inteiro: o shell mais o servidor que ele criou.
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
      throw new Error(
        `preview: \`${command}\` saiu com código ${child.exitCode} em ${options.projectRoot}`,
      );
    }
    if (await respondsOk(url)) return { url, stop };
    await delay(PREVIEW_POLL_INTERVAL_MS);
  }

  await stop();
  throw new Error(`preview: ${url} não respondeu em ${PREVIEW_READY_TIMEOUT_MS} ms`);
}
