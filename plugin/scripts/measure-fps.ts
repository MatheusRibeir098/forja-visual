/// <reference lib="dom" />
// Parte deste arquivo roda dentro da página (page.evaluate), então precisa da lib DOM em
// cima do tsconfig de Node — declarada aqui em vez de alargar o projeto inteiro.

/**
 * Cadência de quadro **e** tempo de GPU por quadro durante uma rolagem automatizada, em GPU real.
 *
 * ── A guarda que é o motivo do script existir ─────────────────────────────────────────
 * O Chrome headless desenha alegremente pelo SwiftShader e reporta uma taxa de quadros
 * bonita que não tem relação com o que um usuário vê. Se o renderer for de software, este
 * script **aborta** com código 2 ("medição inválida") em vez de sair com 0 e uma mentira
 * confortável. As flags que alcançam o driver real estão em `lib/chrome.ts`.
 *
 * ── O sinal de ambiente, e por que ele está aqui ──────────────────────────────────────
 * No protótipo 01 o p5 do tier desktop caiu para 30 fps em ~40% das execuções e dois devs
 * gastaram 20 minutos cada cortando efeitos para consertar. Não era o efeito: era o Spotify
 * do dono, a 48% de CPU e com processo de GPU próprio, disputando a placa integrada. A
 * mediana nunca se moveu. Então, antes de subir qualquer coisa, medimos a máquina ociosa e
 * imprimimos quem mais está usando CPU; e quando a medição **falha**, ela é repetida
 * automaticamente antes de virar veredito. Falha que não se repete, ou falha com a máquina
 * disputada, sai como `inconclusivo` (código 3) em vez de "seu efeito está pesado". O 3
 * **continua sendo vermelho** — o portão não afrouxa; o que muda é o diagnóstico e o que se
 * pede a seguir: isolar a máquina e remedir, antes de cortar efeito.
 *
 * ── Tempo de GPU ──────────────────────────────────────────────────────────────────────
 * Cadência sozinha só diz se o vsync foi batido; não diz quanto dos 16,67 ms o quadro gastou
 * na GPU. Então cada quadro é cercado por uma query `EXT_disjoint_timer_query_webgl2`
 * (begin/end, não o contador de timestamp — no ANGLE é o timestamp que é instável), e o
 * script reporta ms de GPU por quadro, para quem for acrescentar um passe saber contra
 * quanta folga está gastando.
 *
 *   tsx measure-fps.ts --project=/caminho/do/site
 *   tsx measure-fps.ts --url=http://localhost:4173 --only=high --min=60 --runs=3
 *   tsx measure-fps.ts --force-swiftshader          # tem de sair com 2
 *
 * Argumentos: --project --url --port --config --out --json
 *             --min --min-low --only=high|low --runs --duration
 *             --canvas (padrão `#gl,[data-forge-gl]` — a convenção do projeto é `id="gl"`)
 *             --high-viewport=1280x720@2 --low-viewport=375x667@1 --force-swiftshader --no-confirm
 * Saídas: 0 ok · 1 abaixo do piso · 2 medição inválida (GPU de software) · 3 inconclusivo.
 */
import {
  DEFAULT_CANVAS_SELECTOR,
  launchRealGpu,
  isSoftwareRenderer,
  startPreview,
  tagWebglCanvases,
} from './lib/chrome';
import type { Browser } from './lib/chrome';
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
import { formatEnvironment, probeEnvironment } from './lib/env';
import type { EnvironmentSnapshot } from './lib/env';
import { emitMeasurement } from './lib/report';
import type { FpsMeasurement, FpsRun } from './lib/report';

const EXIT_BUDGET = 1;
const EXIT_INVALID_MEASUREMENT = 2;
const EXIT_INCONCLUSIVE = 3;

const DEFAULT_SAMPLE_DURATION_MS = 5_000;
/**
 * Um compositor travado em 60 Hz cai em 59,9x com a mesma frequência com que cai em 60,0 —
 * é jitter de relógio, não quadro perdido. Um quadro de folga mantém o teste honesto sem
 * ficar piscando entre passar e reprovar.
 */
const VSYNC_TOLERANCE_FPS = 1;
const WARMUP_FRAMES = 5;
/** O que um compositor travado em 60 Hz reserva para o trabalho de GPU do quadro inteiro. */
const VSYNC_BUDGET_MS = 1000 / 60;

/**
 * Quantas queries `EXT_disjoint_timer_query_webgl2` podem estar em voo ao mesmo tempo. O
 * resultado de uma query nunca fica pronto no quadro em que foi gravada — a GPU roda assíncrona
 * em relação à thread de JS — então um slot só não basta: enquanto a query do quadro N ainda
 * espera o driver, a do quadro N+1 já precisa estar aberta.
 */
const GPU_QUERY_RING_SIZE = 4;
/** Quadros de rAF mantidos vivos depois da janela de amostra, para drenar as últimas queries. */
const GPU_QUERY_DRAIN_FRAMES = 12;

/** Quantas execuções extras uma reprovação dispara antes de virar veredito. */
const CONFIRMATION_RUNS = 3;
/** Espalhamento de mediana entre execuções acima do qual a medição não é reprodutível. */
const MEDIAN_SPREAD_LIMIT = 5;

interface PassConfig {
  readonly tier: string;
  readonly width: number;
  readonly height: number;
  readonly deviceScaleFactor: number;
  readonly minFps: number;
}

/** dpr 2 é a pior taxa de preenchimento realista num desktop bom, então o tier high usa ela. */
const DEFAULT_HIGH = { width: 1280, height: 720, deviceScaleFactor: 2, minFps: 60 };
const DEFAULT_LOW = { width: 375, height: 667, deviceScaleFactor: 1, minFps: 30 };

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

function spread(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return round(Math.max(...values) - Math.min(...values));
}

/** Forma de `EXT_disjoint_timer_query_webgl2` — a lib DOM do TypeScript não a conhece. */
interface DisjointTimerQueryExt {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

interface FrameSampleOptions {
  readonly durationMs: number;
  readonly ringSize: number;
  readonly drainFrames: number;
  /** Seletor do canvas WebGL do site; `null` mede só cadência, sem tempo de GPU. */
  readonly canvasSelector: string | null;
}

interface FrameSampleResult {
  readonly timestamps: number[];
  /** ms de GPU por quadro, já filtrados dos intervalos marcados como disjoint. */
  readonly gpuFrameMs: number[];
  readonly gpuDisjointCount: number;
  readonly gpuTimerAvailable: boolean;
  /** Qual canvas acabou sendo cronometrado — entra no relatório. */
  readonly canvasFound: boolean;
}

/**
 * Grava um timestamp de rAF por quadro enquanto rola ~1 viewport por segundo e, quando a
 * extensão existe, uma query de tempo de GPU por quadro.
 *
 * O laço de render do site (o único `requestAnimationFrame` dele) já rodou quando o nosso
 * `await` resolve a cada iteração: nossa callback foi registrada depois que a do site já
 * estava pendente para o mesmo quadro, então ela sempre roda mais tarde na fila daquele
 * quadro. É essa ordem que faz o `endQuery` logo após o `await` cercar os desenhos **deste**
 * quadro, e o `beginQuery` seguinte cercar o **próximo** — sem tocar no laço do site, só
 * lendo o mesmo contexto WebGL2 que ele já criou (`getContext('webgl2')` uma segunda vez
 * devolve o mesmo objeto de contexto, por spec).
 *
 * Escrito como um laço só, sem função interna nomeada, de propósito: o tsx compila com
 * `keepNames` do esbuild, e uma função/const-arrow nomeada arrastaria um helper `__name(...)`
 * para o código que o Playwright serializa dentro da página, onde ele não existe.
 */
const collectFrameSamples = async (options: FrameSampleOptions): Promise<FrameSampleResult> => {
  const { durationMs, ringSize, drainFrames, canvasSelector } = options;

  // A folha de estilo pode pedir rolagem suave; isso animaria o alvo do scroll e mediria a
  // suavização em vez da página. Força saltos instantâneos durante a execução.
  const previousBehavior = document.documentElement.style.scrollBehavior;
  document.documentElement.style.scrollBehavior = 'auto';

  const timestamps: number[] = [];
  const gpuFrameMs: number[] = [];
  let gpuDisjointCount = 0;

  // Maior canvas entre os que pediram contexto WebGL — o site pode ter vários.
  let canvasEl: HTMLCanvasElement | null = null;
  if (canvasSelector !== null) {
    let bestArea = -1;
    for (const node of Array.from(document.querySelectorAll(canvasSelector))) {
      if (!(node instanceof HTMLCanvasElement)) continue;
      const area = node.width * node.height;
      if (area <= bestArea) continue;
      bestArea = area;
      canvasEl = node;
    }
  }

  const gl: WebGL2RenderingContext | null =
    canvasEl === null ? null : canvasEl.getContext('webgl2');
  const ext: DisjointTimerQueryExt | null =
    gl === null
      ? null
      : (gl.getExtension('EXT_disjoint_timer_query_webgl2') as DisjointTimerQueryExt | null);
  const gpuTimerAvailable = gl !== null && ext !== null;

  const queries: WebGLQuery[] =
    gl !== null && gpuTimerAvailable
      ? Array.from({ length: ringSize }, () => gl.createQuery())
      : [];
  let writeIndex = 0;
  let readIndex = 0;
  let pendingCount = 0;
  let hasOpenQuery = false;

  const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const pixelsPerMs = window.innerHeight / 1000;
  const start = performance.now();
  let elapsed = 0;
  let drainFramesLeft = drainFrames;

  // Duas fases num laço só de rAF: enquanto `elapsed < durationMs` rolamos e gravamos
  // timestamps; fechada a janela, seguimos pedindo quadros por `drainFramesLeft` apenas para
  // as últimas queries de GPU poderem resolver.
  while (elapsed < durationMs || drainFramesLeft > 0) {
    const inSampleWindow = elapsed < durationMs;
    const now = await new Promise<number>((resolve) => requestAnimationFrame(resolve));

    if (inSampleWindow) timestamps.push(now);
    else drainFramesLeft -= 1;
    elapsed = now - start;

    if (gl !== null && ext !== null) {
      if (hasOpenQuery) {
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        pendingCount += 1;
        hasOpenQuery = false;
      }

      // Os resultados voltam na ordem de submissão, então a primeira query ainda indisponível
      // significa que nenhuma depois dela está pronta — para por ali.
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

      // Só abre query nova enquanto ainda estamos amostrando, e só se o anel tiver vaga — anel
      // cheio significa driver atrasado na leitura; melhor pular o quadro que sobrescrever
      // resultado não lido.
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
  return {
    timestamps,
    gpuFrameMs,
    gpuDisjointCount,
    gpuTimerAvailable,
    canvasFound: gl !== null,
  };
};

interface RunOutcome extends FpsRun {
  readonly gpuDisjointCount: number;
  readonly gpuTimerAvailable: boolean;
  readonly canvasFound: boolean;
}

/** Uma execução completa: contexto novo, página nova, cinco segundos de rolagem. */
async function runOnce(
  browser: Browser,
  url: string,
  config: PassConfig,
  durationMs: number,
  canvasSelector: string | null,
): Promise<RunOutcome> {
  const context = await browser.newContext({
    viewport: { width: config.width, height: config.height },
    deviceScaleFactor: config.deviceScaleFactor,
  });
  try {
    await tagWebglCanvases(context);
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(500);

    const sample = await page.evaluate(collectFrameSamples, {
      durationMs,
      ringSize: GPU_QUERY_RING_SIZE,
      drainFrames: GPU_QUERY_DRAIN_FRAMES,
      canvasSelector,
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

    return {
      fpsMedian: round(median(sortedFps)),
      fpsP5: round(percentile(sortedFps, 0.05)),
      gpuFrameMsMedian: hasGpuSamples ? round(median(sortedGpuMs)) : null,
      gpuFrameMsP95: hasGpuSamples ? round(percentile(sortedGpuMs, 0.95)) : null,
      gpuDisjointCount: sample.gpuDisjointCount,
      gpuTimerAvailable: sample.gpuTimerAvailable,
      canvasFound: sample.canvasFound,
    };
  } finally {
    await context.close();
  }
}

interface PassOptions {
  readonly durationMs: number;
  readonly canvasSelector: string | null;
  readonly requestedRuns: number;
  readonly confirmOnFailure: boolean;
  readonly renderer: string;
  readonly environment: EnvironmentSnapshot;
}

function passes(fpsMedian: number, minFps: number): boolean {
  return fpsMedian >= minFps - VSYNC_TOLERANCE_FPS;
}

/**
 * Roda o passe e decide o veredito. Uma reprovação na primeira execução **não** é veredito:
 * ela dispara execuções de confirmação, porque a única falha cara do protótipo 01 foi
 * exatamente uma cauda que não se repetia e que ninguém remediu antes de cortar efeito.
 */
async function runPass(
  browser: Browser,
  url: string,
  config: PassConfig,
  options: PassOptions,
): Promise<FpsMeasurement> {
  const runs: RunOutcome[] = [];
  const target = Math.max(1, options.requestedRuns);

  for (let attempt = 0; attempt < target; attempt += 1) {
    runs.push(await runOnce(browser, url, config, options.durationMs, options.canvasSelector));
  }
  const firstFailed = !passes(runs[0]?.fpsMedian ?? 0, config.minFps);
  if (firstFailed && options.confirmOnFailure && target < CONFIRMATION_RUNS) {
    console.info(
      `  tier ${config.tier}: primeira execução abaixo do piso — repetindo para ver se reproduz…`,
    );
    while (runs.length < CONFIRMATION_RUNS) {
      runs.push(
        await runOnce(browser, url, config, options.durationMs, options.canvasSelector),
      );
    }
  }

  const medians = runs.map((run) => run.fpsMedian);
  const sortedMedians = [...medians].sort((a, b) => a - b);
  const fpsMedian = round(median(sortedMedians));
  const medianSpread = spread(medians);
  const someRunPassed = medians.some((value) => passes(value, config.minFps));
  const allRunsPassed = medians.every((value) => passes(value, config.minFps));

  const gpuMedians = runs
    .map((run) => run.gpuFrameMsMedian)
    .filter((value): value is number => value !== null);
  const gpuP95s = runs
    .map((run) => run.gpuFrameMsP95)
    .filter((value): value is number => value !== null);
  const gpuFrameMsMedian =
    gpuMedians.length === 0 ? null : round(median([...gpuMedians].sort((a, b) => a - b)));
  const gpuFrameMsP95 = gpuP95s.length === 0 ? null : round(Math.max(...gpuP95s));

  // Reprovou mas não reproduziu, ou reprovou com a máquina disputada: o número não descreve
  // o site. Isso continua saindo diferente de zero — só sai com um diagnóstico diferente.
  const inconclusive =
    !allRunsPassed &&
    (someRunPassed || medianSpread > MEDIAN_SPREAD_LIMIT || options.environment.contended);

  return {
    fpsMedian,
    fpsP5: round(median([...runs.map((run) => run.fpsP5)].sort((a, b) => a - b))),
    renderer: options.renderer,
    tier: config.tier,
    minFps: config.minFps,
    durationS: options.durationMs / 1000,
    viewport: `${config.width}x${config.height}@${config.deviceScaleFactor}x`,
    runs: runs.map((run) => ({
      fpsMedian: run.fpsMedian,
      fpsP5: run.fpsP5,
      gpuFrameMsMedian: run.gpuFrameMsMedian,
      gpuFrameMsP95: run.gpuFrameMsP95,
    })),
    medianSpread,
    p5Spread: spread(runs.map((run) => run.fpsP5)),
    gpuFrameMsMedian,
    gpuFrameMsP95,
    gpuHeadroomMs: gpuFrameMsP95 === null ? null : round(VSYNC_BUDGET_MS - gpuFrameMsP95),
    gpuDisjointSamples: runs.reduce((sum, run) => sum + run.gpuDisjointCount, 0),
    gpuTimerAvailable: runs.some((run) => run.gpuTimerAvailable),
    canvasSelector: runs.some((run) => run.canvasFound) ? options.canvasSelector : null,
    environment: {
      cpuCount: options.environment.cpuCount,
      loadPerCore: options.environment.loadPerCore,
      foreignBusyCores: options.environment.foreignBusyCores,
      topProcesses: options.environment.topProcesses,
      contended: options.environment.contended,
      reasons: options.environment.reasons,
    },
    verdict: allRunsPassed ? 'ok' : inconclusive ? 'inconclusivo' : 'abaixo-do-piso',
    measuredAt: nowIso(),
  };
}

/** Resumo de GPU em uma linha, separado para o relatório continuar legível. */
function formatGpuSummary(measurement: FpsMeasurement): string {
  if (!measurement.gpuTimerAvailable) {
    return measurement.canvasSelector === null
      ? 'GPU: nenhum canvas WebGL encontrado na página — só cadência de quadro.'
      : 'GPU: EXT_disjoint_timer_query_webgl2 indisponível neste ambiente — sem tempo de GPU.';
  }
  const { gpuFrameMsMedian, gpuFrameMsP95, gpuHeadroomMs, gpuDisjointSamples } = measurement;
  if (gpuFrameMsMedian === null || gpuFrameMsP95 === null || gpuHeadroomMs === null) {
    return 'GPU: extensão presente, mas nenhuma amostra válida sobrou (tudo disjoint?).';
  }
  const discarded =
    gpuDisjointSamples > 0
      ? ` · ${gpuDisjointSamples} amostra(s) descartada(s) por disjoint`
      : '';
  return (
    `GPU: mediana ${gpuFrameMsMedian.toFixed(2)} ms · p95 ${gpuFrameMsP95.toFixed(2)} ms · ` +
    `folga até ${VSYNC_BUDGET_MS.toFixed(2)} ms → ${gpuHeadroomMs.toFixed(2)} ms${discarded}`
  );
}

function report(measurement: FpsMeasurement): void {
  const verdict =
    measurement.verdict === 'ok'
      ? 'OK'
      : measurement.verdict === 'inconclusivo'
        ? 'INCONCLUSIVO'
        : 'ABAIXO DO PISO';
  console.info(
    `  tier ${measurement.tier.padEnd(4)} ${measurement.viewport.padEnd(14)} ` +
      `mediana ${measurement.fpsMedian.toFixed(1)} fps · p5 ${measurement.fpsP5.toFixed(1)} fps ` +
      `· piso ${measurement.minFps} → ${verdict}`,
  );
  console.info(`           ${formatGpuSummary(measurement)}`);
  if (measurement.runs.length > 1) {
    const list = measurement.runs.map((run) => run.fpsMedian.toFixed(1)).join(' / ');
    console.info(
      `           ${measurement.runs.length} execuções: medianas ${list} ` +
        `(espalhamento ${measurement.medianSpread.toFixed(1)} fps · p5 ${measurement.p5Spread.toFixed(1)} fps)`,
    );
  }
  if (measurement.verdict === 'inconclusivo') {
    console.info(
      '           ⚠ o número não reproduziu ou a máquina estava disputada. ANTES de cortar\n' +
        '             efeito: feche o que está usando a GPU e remeça. Se um número não\n' +
        '             correlaciona com a variável que você mexe, o problema não é a variável.',
    );
  }
}

function parsePassViewport(
  raw: string | undefined,
  fallback: { width: number; height: number; deviceScaleFactor: number },
): { width: number; height: number; deviceScaleFactor: number } {
  if (raw === undefined) return fallback;
  const match = /^(\d+)x(\d+)(?:@(\d+(?:\.\d+)?))?$/.exec(raw.trim());
  if (match === null) throw new Error(`viewport "${raw}": use o formato 1280x720@2.`);
  return {
    width: Number(match[1]),
    height: Number(match[2]),
    deviceScaleFactor: match[3] === undefined ? fallback.deviceScaleFactor : Number(match[3]),
  };
}

function worstExitCode(measurements: readonly FpsMeasurement[]): number {
  if (measurements.some((entry) => entry.verdict === 'abaixo-do-piso')) return EXIT_BUDGET;
  if (measurements.some((entry) => entry.verdict === 'inconclusivo')) return EXIT_INCONCLUSIVE;
  return 0;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const target = resolveTarget(args);
  const config = section(target.config, 'fps');

  const only = argString(args, 'only') ?? readString(config, 'only') ?? 'both';
  const durationMs =
    argNumber(args, 'duration') ??
    readNumber(config, 'durationMs') ??
    DEFAULT_SAMPLE_DURATION_MS;
  const requestedRuns = argNumber(args, 'runs') ?? readNumber(config, 'runs') ?? 1;
  const confirmOnFailure = argFlag(args, 'confirm') ?? true;
  // Convenção do projeto: o canvas WebGL do site é `#gl` (ver `lib/chrome.ts`). O seletor
  // padrão inclui a instrumentação `[data-forge-gl]` como rede, para um site que não a siga
  // continuar mensurável.
  const canvasSelector =
    argString(args, 'canvas') ?? readString(config, 'canvas') ?? DEFAULT_CANVAS_SELECTOR;

  const highViewport = parsePassViewport(
    argString(args, 'high-viewport') ?? readString(config, 'highViewport'),
    DEFAULT_HIGH,
  );
  const lowViewport = parsePassViewport(
    argString(args, 'low-viewport') ?? readString(config, 'lowViewport'),
    DEFAULT_LOW,
  );
  const highPass: PassConfig = {
    tier: 'high',
    ...highViewport,
    minFps: argNumber(args, 'min') ?? readNumber(config, 'min') ?? DEFAULT_HIGH.minFps,
  };
  const lowPass: PassConfig = {
    tier: 'low',
    ...lowViewport,
    minFps: argNumber(args, 'min-low') ?? readNumber(config, 'minLow') ?? DEFAULT_LOW.minFps,
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
    console.info(`\nfps: chrome ${mode}\n  renderer     ${renderer}`);
    if (target.configPath !== null) console.info(`  config       ${target.configPath}`);
    console.info(formatEnvironment(environment));

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

    const passOptions: PassOptions = {
      durationMs,
      canvasSelector,
      requestedRuns,
      confirmOnFailure,
      renderer,
      environment,
    };
    const measurements: FpsMeasurement[] = [];

    if (only !== 'low') {
      const high = await runPass(browser, preview.url, highPass, passOptions);
      report(high);
      emitMeasurement('fps', high, target);
      measurements.push(high);
    }
    if (only !== 'high') {
      const low = await runPass(browser, preview.url, lowPass, passOptions);
      report(low);
      emitMeasurement('fpsLow', low, target);
      measurements.push(low);
    }

    process.exitCode = worstExitCode(measurements);
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
