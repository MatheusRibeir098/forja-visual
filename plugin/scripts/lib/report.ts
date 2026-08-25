/**
 * O que os medidores devolvem, e onde isso é guardado.
 *
 * Cada script é dono de **uma** chave de topo do arquivo de medições e nunca sobrescreve as
 * outras: eles rodam separados (às vezes em paralelo), então gravar é sempre ler-mesclar-
 * gravar de uma chave só. O caminho do arquivo vem da configuração — nenhum medidor sabe
 * onde fica o `src/generated/` de um projeto específico.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Retângulo em espaço de viewport, em pixels CSS. */
export interface Clip {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Um arquivo do caminho crítico, já comprimido. */
export interface CriticalFile {
  readonly file: string;
  readonly kb: number;
}

/** `measure-bundle.ts` — peso gzip de `dist/`, separado por papel. Informativo. */
export interface BundleMeasurement {
  readonly criticalKb: number;
  readonly criticalFiles: readonly CriticalFile[];
  readonly fontsKb: number;
  readonly lazyKb: number;
  readonly totalKb: number;
  /** Referência do brief, quando existe; `null` quando ninguém declarou orçamento. */
  readonly criticalBudgetKb: number | null;
  readonly lazyBudgetKb: number | null;
  readonly fontsBudgetKb: number | null;
  /** `true` quando algum valor passou da referência — informa, não reprova. */
  readonly overBudget: boolean;
  readonly measuredAt: string;
}

/**
 * Por que um elemento de texto não virou um número de contraste — ou virou.
 *
 * `nao-desenhado` é a lição que custou caro no protótipo 01: um parágrafo com `clip-path`
 * fechado media 2,86:1 porque o medidor lia ruído de fundo e chamava de texto. Aqui isso é
 * um estado próprio, nunca um contraste ruim.
 */
export type ContrastStatus =
  'medido' | 'nao-desenhado' | 'fundo-instavel' | 'amostra-insuficiente';

export interface ContrastSample {
  readonly selector: string;
  readonly text: string;
  readonly status: ContrastStatus;
  /** Razão WCAG medida por pixel; `null` quando o status não é `medido`. */
  readonly ratio: number | null;
  /**
   * Razão prevista pelas cores computadas (`color` sobre o fundo observado). Serve para
   * dizer se um texto `nao-desenhado` vai nascer legível quando a revelação terminar.
   */
  readonly cssRatio: number | null;
  /** Fração do retângulo de texto coberta por glifo — 0 significa nada desenhado. */
  readonly glyphCoverage: number;
  readonly clip: Clip;
}

export interface ContrastMeasurement {
  readonly minContrast: number;
  readonly floor: number;
  readonly worst: ContrastSample | null;
  /** Os medidos mais próximos do piso, do pior para o melhor — onde olhar primeiro. */
  readonly lowest: readonly ContrastSample[];
  readonly measured: number;
  readonly candidates: number;
  /** Elementos com texto no DOM e zero glifo na tela — revelação em curso ou defeito. */
  readonly notDrawn: readonly ContrastSample[];
  readonly unstable: readonly ContrastSample[];
  readonly renderer: string;
  readonly viewport: string;
  readonly measuredAt: string;
}

/** Carga da máquina durante a medição — o sinal que faltou no protótipo 01. */
export interface EnvironmentReport {
  readonly cpuCount: number;
  readonly loadPerCore: number;
  /** Núcleos inteiros ocupados por processos que não são a medição. */
  readonly foreignBusyCores: number | null;
  readonly topProcesses: readonly { readonly name: string; readonly cpuPercent: number }[];
  readonly contended: boolean;
  readonly reasons: readonly string[];
}

export interface FpsRun {
  readonly fpsMedian: number;
  readonly fpsP5: number;
  readonly gpuFrameMsMedian: number | null;
  readonly gpuFrameMsP95: number | null;
}

/** `measure-fps.ts` — cadência de quadro e tempo de GPU durante uma rolagem automatizada. */
export interface FpsMeasurement {
  readonly fpsMedian: number;
  readonly fpsP5: number;
  readonly renderer: string;
  readonly tier: string;
  readonly minFps: number;
  readonly durationS: number;
  readonly viewport: string;
  readonly runs: readonly FpsRun[];
  /** Diferença entre a maior e a menor mediana das execuções. */
  readonly medianSpread: number;
  /** Idem para o p5 — é aqui que a contenção de ambiente aparece primeiro. */
  readonly p5Spread: number;
  readonly gpuFrameMsMedian: number | null;
  readonly gpuFrameMsP95: number | null;
  /** ms restantes até o orçamento de vsync, a partir de `gpuFrameMsP95`. */
  readonly gpuHeadroomMs: number | null;
  readonly gpuDisjointSamples: number;
  readonly gpuTimerAvailable: boolean;
  readonly canvasSelector: string | null;
  readonly environment: EnvironmentReport;
  readonly verdict: 'ok' | 'abaixo-do-piso' | 'inconclusivo';
  readonly measuredAt: string;
}

/** Um trecho de texto renderizado, com o tamanho que ele de fato tem na tela. */
export interface TypeSample {
  readonly selector: string;
  readonly text: string;
  /** `font-size` computado, em px CSS. */
  readonly fontSizePx: number;
  readonly fontFamily: string;
}

/** Um par de quadros comparado — a unidade de `motionCoverage`. */
export interface MotionPair {
  /** Distância entre os dois quadros, em ms. */
  readonly gapMs: number;
  /** Fração de pixels cuja luma mudou acima do limiar brando (o método da §5.2). */
  readonly coverage: number;
  /** Idem, com limiar duro: separa movimento de verdade de grão/dither de tela cheia. */
  readonly strongCoverage: number;
}

/**
 * `measure-variant.ts` — os três números que os checks de colisão 4, 5 e 6 comparam entre as
 * variantes, medidos do pixel e do DOM. O medidor **descreve**; quem decide colisão é o
 * orquestrador, com os limiares do `divergencia.md`.
 */
export interface VariantMeasurement {
  /** `--id=A`, quando dado: só rótulo, para o card não trocar de dono na leitura. */
  readonly id: string | null;
  /** 0–1, mediana da luminância relativa do **fundo** (sem a tinta do texto). */
  readonly bgLuminance: number;
  /** Mediana da tela inteira, com tinta. Só existe para mostrar o quanto ela mentiria. */
  readonly frameLuminance: number;
  /** Mediana da tela no primeiro quadro após `load` — evidência de que o repouso importa. */
  readonly frameLuminanceAtLoad: number;
  /** Fração de pixels que a tinta de texto pintou, medida por diferença de fotos. */
  readonly inkPixelFraction: number;
  /**
   * Fração de pixels que mudou entre duas fotos idênticas com a página congelada. Acima de
   * ~2% a isolação tinta/fundo não vale: a página se mexe por um caminho que o congelamento
   * não alcança (`setTimeout`, `<video>`, GIF).
   */
  readonly frozenDrift: number;
  /** Faixa atribuída pelo orquestrador, quando passada em `--bg-min`/`--bg-max`. */
  readonly bgBand: { readonly min: number; readonly max: number } | null;
  /** `null` quando nenhuma faixa foi passada — o medidor não inventa piso. */
  readonly inBand: boolean | null;
  /** 0–1, mediana das coberturas por par de quadros. */
  readonly motionCoverage: number;
  readonly strongMotionCoverage: number;
  readonly motionPairs: readonly MotionPair[];
  /** Maior menos menor cobertura entre os pares — reprodutibilidade do número. */
  readonly motionSpread: number;
  /** Maior ÷ menor `font-size` renderizado; `null` quando não há texto na tela. */
  readonly typeScaleRatio: number | null;
  readonly typeLargest: TypeSample | null;
  readonly typeSmallest: TypeSample | null;
  readonly typeSamples: number;
  /** Onde a escala foi lida: só o que está na tela em repouso, ou o documento inteiro. */
  readonly typeScope: 'viewport' | 'document';
  /** Famílias de fonte efetivamente renderizadas, da mais usada para a menos. */
  readonly fontFamilies: readonly string[];
  /** Hex dos tokens dominantes do quadro em repouso, do mais presente ao menos. */
  readonly palette: readonly string[];
  /** Seletor do canvas WebGL achado na página; `null` quando não há WebGL. */
  readonly webglCanvas: string | null;
  /** `true` quando o canvas segue a convenção `id="gl"`; `null` quando não há canvas. */
  readonly followsCanvasConvention: boolean | null;
  /** Estado em que a página foi medida. */
  readonly reducedMotion: boolean;
  readonly settleMs: number;
  readonly renderer: string;
  readonly viewport: string;
  readonly environment: EnvironmentReport;
  readonly verdict: 'ok' | 'fora-da-faixa' | 'inconclusivo' | 'nada-mensuravel';
  readonly measuredAt: string;
}

export type MeasurementKey = 'bundle' | 'contrast' | 'fps' | 'fpsLow' | 'variant';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readExisting(path: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return isRecord(parsed) ? parsed : {};
  } catch {
    // Arquivo ausente ou corrompido: começa do zero em vez de derrubar a medição.
    return {};
  }
}

export interface EmitTarget {
  readonly outFile: string | null;
  readonly printJson: boolean;
}

/**
 * Grava (mesclando) a medição no arquivo de saída e, se pedido, imprime só ela em stdout.
 * Nunca derruba a medição por falha de escrita — o número já foi obtido; perder o registro
 * é ruim, mas mentir sobre o número seria pior.
 */
export function emitMeasurement(
  key: MeasurementKey,
  payload: unknown,
  target: EmitTarget,
): void {
  if (target.printJson) {
    process.stdout.write(`${JSON.stringify({ [key]: payload }, null, 2)}\n`);
  }
  if (target.outFile === null) return;

  try {
    mkdirSync(dirname(target.outFile), { recursive: true });
    const merged = { ...readExisting(target.outFile), [key]: payload };
    writeFileSync(target.outFile, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  } catch (cause) {
    console.warn(`aviso: não consegui gravar ${target.outFile} — ${String(cause)}`);
  }
}
