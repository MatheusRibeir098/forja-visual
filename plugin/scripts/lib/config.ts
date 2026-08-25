/**
 * De onde os medidores tiram projeto, alvo, seletores e orçamento.
 *
 * Os medidores do protótipo 01 tinham tudo preso no código: a raiz do projeto vinha de
 * `import.meta.url`, os tetos de KB eram constantes e o canvas era `#gl`. Aqui nada disso
 * é decidido no arquivo — tudo entra por, nesta ordem de precedência:
 *
 *   1. argumento de linha de comando  (`--min=7`)
 *   2. arquivo de configuração        (`forge-visual.config.json` na raiz do projeto)
 *   3. brief do site                  (`--brief=brief.json`, só para o orçamento de bytes)
 *   4. padrão embutido
 *
 * Assim o mesmo script mede qualquer site gerado pela ferramenta sem edição de código.
 */
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

export type ConfigRecord = Readonly<Record<string, unknown>>;

export interface ParsedArgs {
  /** `--chave=valor` */
  readonly values: ReadonlyMap<string, string>;
  /** `--chave` sem valor */
  readonly flags: ReadonlySet<string>;
}

/** Nomes procurados na raiz do projeto quando `--config` não é passado. */
const CONFIG_FILE_CANDIDATES = [
  'forge-visual.config.json',
  '.forge-visual/measure.config.json',
];

const DEFAULT_PREVIEW_COMMAND = 'pnpm exec vite preview --port {port} --strictPort';
const DEFAULT_PREVIEW_PORT = 4173;
/**
 * `.forge-visual/` é onde a skill `forge-visual` guarda os artefatos de controle do projeto
 * (brief, hates, variantes, medições, screenshots). O padrão aponta para lá para que a saída
 * dos medidores caia junto do resto, sem ninguém passar `--out`.
 */
const DEFAULT_OUT_FILE = '.forge-visual/medicoes/measurements.json';

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const values = new Map<string, string>();
  const flags = new Set<string>();

  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    if (eq === -1) flags.add(body);
    else values.set(body.slice(0, eq), body.slice(eq + 1));
  }

  return { values, flags };
}

export function argString(args: ParsedArgs, name: string): string | undefined {
  return args.values.get(name);
}

export function argNumber(args: ParsedArgs, name: string): number | undefined {
  const raw = args.values.get(name);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`--${name}=${raw}: esperava um número.`);
  }
  return parsed;
}

/** `--flag` liga; `--no-flag` desliga; ausente devolve `undefined` (deixa o padrão valer). */
export function argFlag(args: ParsedArgs, name: string): boolean | undefined {
  if (args.flags.has(name)) return true;
  if (args.flags.has(`no-${name}`)) return false;
  return undefined;
}

/**
 * Lista de números do arquivo de config (`"gaps": [1000, 1400]`). Aceita também a forma de
 * string (`"1000,1400"`), que é como a mesma opção chega pela linha de comando.
 */
export function readNumberArray(config: ConfigRecord, key: string): number[] | undefined {
  const value = config[key];
  if (typeof value === 'string') return parseNumberList(value, key);
  if (!Array.isArray(value)) return undefined;
  const parsed = value.filter(
    (entry): entry is number => typeof entry === 'number' && Number.isFinite(entry),
  );
  return parsed.length === value.length ? parsed : undefined;
}

/** `--gaps=1000,1400` -> `[1000, 1400]`. Erro claro em vez de NaN silencioso. */
export function parseNumberList(raw: string, label: string): number[] {
  const parsed = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => Number(part));
  if (parsed.length === 0 || parsed.some((value) => !Number.isFinite(value))) {
    throw new Error(`${label}=${raw}: esperava números separados por vírgula.`);
  }
  return parsed;
}

function isRecord(value: unknown): value is ConfigRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Sub-objeto do arquivo de config (`{ "contrast": { ... } }`), ou vazio. */
export function section(config: ConfigRecord, name: string): ConfigRecord {
  const value = config[name];
  return isRecord(value) ? value : {};
}

export function readString(config: ConfigRecord, key: string): string | undefined {
  const value = config[key];
  return typeof value === 'string' ? value : undefined;
}

export function readNumber(config: ConfigRecord, key: string): number | undefined {
  const value = config[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function loadJsonFile(path: string): ConfigRecord {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (cause) {
    throw new Error(`não consegui ler ${path}: ${String(cause)}`);
  }
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) throw new Error(`${path} não contém um objeto JSON.`);
  return parsed;
}

function findConfigFile(projectRoot: string, explicit: string | undefined): string | null {
  if (explicit !== undefined) {
    const path = isAbsolute(explicit) ? explicit : resolve(projectRoot, explicit);
    if (!existsSync(path)) throw new Error(`--config=${explicit}: arquivo não encontrado.`);
    return path;
  }
  for (const candidate of CONFIG_FILE_CANDIDATES) {
    const path = join(projectRoot, candidate);
    if (existsSync(path)) return path;
  }
  return null;
}

/** Orçamento de bytes do brief (§5 da spec). Ausente = sem referência para imprimir. */
export interface ByteBudget {
  readonly criticalKb: number | null;
  readonly lazyKb: number | null;
  readonly fontsKb: number | null;
  readonly rationale: string | null;
}

const EMPTY_BUDGET: ByteBudget = {
  criticalKb: null,
  lazyKb: null,
  fontsKb: null,
  rationale: null,
};

function budgetFrom(source: ConfigRecord): ByteBudget {
  return {
    criticalKb: readNumber(source, 'criticalKb') ?? null,
    lazyKb: readNumber(source, 'lazyKb') ?? null,
    fontsKb: readNumber(source, 'fontsKb') ?? null,
    rationale: readString(source, 'rationale') ?? null,
  };
}

/** Tudo que os três medidores precisam saber sobre *onde* estão medindo. */
export interface TargetConfig {
  readonly projectRoot: string;
  readonly distDir: string;
  /** URL já servida por outra pessoa; quando `null`, o medidor sobe um preview. */
  readonly url: string | null;
  readonly port: number;
  /** Comando de preview; `{port}` é substituído. */
  readonly previewCommand: string;
  /** Onde acumular o JSON das medições; `null` desliga a escrita. */
  readonly outFile: string | null;
  /** Imprime o resultado desta medição como JSON em stdout. */
  readonly printJson: boolean;
  readonly budget: ByteBudget;
  /** Conteúdo bruto do arquivo de config, para as seções por medidor. */
  readonly config: ConfigRecord;
  readonly configPath: string | null;
}

/**
 * Resolve o alvo a partir dos argumentos. `--project` decide a raiz (padrão: diretório de
 * onde o comando foi chamado), e é relativo a ela que todo o resto se resolve.
 */
export function resolveTarget(args: ParsedArgs): TargetConfig {
  const projectRoot = resolve(argString(args, 'project') ?? process.cwd());
  if (!existsSync(projectRoot)) {
    throw new Error(`--project=${projectRoot}: diretório não encontrado.`);
  }

  const configPath = findConfigFile(projectRoot, argString(args, 'config'));
  const config = configPath === null ? {} : loadJsonFile(configPath);

  const briefPath = argString(args, 'brief');
  const brief = briefPath === undefined ? {} : loadJsonFile(resolve(projectRoot, briefPath));

  const budgetSource = isRecord(brief['budget'])
    ? brief['budget']
    : isRecord(config['budget'])
      ? config['budget']
      : null;

  const outFileRaw = argString(args, 'out') ?? readString(config, 'out') ?? DEFAULT_OUT_FILE;

  return {
    projectRoot,
    distDir: resolve(
      projectRoot,
      argString(args, 'dist') ?? readString(config, 'dist') ?? 'dist',
    ),
    url: argString(args, 'url') ?? readString(config, 'url') ?? null,
    port: argNumber(args, 'port') ?? readNumber(config, 'port') ?? DEFAULT_PREVIEW_PORT,
    previewCommand:
      argString(args, 'preview-cmd') ??
      readString(config, 'previewCommand') ??
      DEFAULT_PREVIEW_COMMAND,
    outFile:
      argFlag(args, 'out') === false || outFileRaw === ''
        ? null
        : resolve(projectRoot, outFileRaw),
    printJson: argFlag(args, 'json') ?? false,
    budget: budgetSource === null ? EMPTY_BUDGET : budgetFrom(budgetSource),
    config,
    configPath,
  };
}

/** Bytes para KB com duas casas — a unidade em que todo orçamento é escrito. */
export function toKb(bytes: number): number {
  return Math.round((bytes / 1024) * 100) / 100;
}

export function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function nowIso(): string {
  return new Date().toISOString();
}
