/**
 * O registro dos arquivos que o usuário trouxe — e o que a licença deles obriga.
 *
 * Um asset próprio é um dos cinco fatores que tiram um site da média (`VISAO.md` §3.1): um
 * `.obj` processado por pipeline próprio não é preset de biblioteca nenhuma. Mas ele chega
 * com duas obrigações que **não** são formalidade, e são estas duas que este arquivo
 * mecaniza:
 *
 *   1. **o arquivo fonte não entra no repositório do site** — só o derivado processado;
 *   2. **quando há `attribution`, o crédito é link real e sobrevive ao corte de qualquer
 *      seção** — verificado por `check-attribution.ts`, não prometido em prosa.
 *
 * Por isso a ingestão grava um registro legível por máquina em `.forge-visual/assets.json`:
 * sem ele o portão do crédito não teria contra o que comparar, e a proibição viraria mais
 * uma frase sem portão (o defeito conhecido do item 7 do backlog).
 *
 * O registro é um **superconjunto** do `BriefAsset` da spec §5: `briefAssetFrom()` devolve
 * exatamente aquele objeto, sem campo a mais. O contrato congelado não muda por causa daqui.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

/** Mesmos valores do `BriefAsset.kind` da spec §5. */
export type AssetKind = 'model3d' | 'image' | 'font' | 'other';

export const ASSET_KINDS: readonly AssetKind[] = ['model3d', 'image', 'font', 'other'];

/** Caminho padrão do registro, relativo à raiz do site. */
export const ASSET_REGISTRY_FILE = '.forge-visual/assets.json';

/** Onde os derivados nascem. É a única escrita legítima em `src/generated/`. */
export const DEFAULT_DERIVATIVE_DIR = 'src/generated/assets';

/** Versão do formato do registro — muda junto com a forma de `AssetRegistryEntry`. */
export const ASSET_REGISTRY_VERSION = 1;

/**
 * Extensões de arquivo **de origem**, que nunca podem aparecer dentro do repositório do
 * site. Não é lista de "formatos suportados": é a lista do que um humano abre num editor de
 * modelagem/imagem — pesado, versionado fora, e quase sempre com licença de terceiro colada.
 * `check-attribution.ts` reprova o build se algum destes existir sob a raiz do site.
 */
export const RAW_SOURCE_EXTENSIONS: readonly string[] = [
  '.stl',
  '.obj',
  '.fbx',
  '.dae',
  '.3ds',
  '.ply',
  '.blend',
  '.glb',
  '.gltf',
  '.psd',
  '.ai',
  '.xcf',
  '.tif',
  '.tiff',
  '.exr',
  '.hdr',
  '.raw',
  '.cr2',
  '.nef',
  '.ttf',
  '.otf',
];

/** O arquivo como o usuário o entregou — identificado por conteúdo, não por nome. */
export interface AssetSource {
  /** Caminho absoluto na máquina do usuário. Fica **fora** do repositório do site. */
  readonly path: string;
  readonly extension: string;
  readonly bytes: number;
  /** É por este hash que o portão detecta o fonte copiado para dentro do repo. */
  readonly sha256: string;
}

/** Um arquivo produzido pela ingestão, que o site importa. */
export interface AssetDerivative {
  /** Caminho relativo à raiz do site — é o que o `import ... ?url` referencia. */
  readonly file: string;
  readonly bytes: number;
  readonly kb: number;
  /** Peso que o navegador realmente baixa. É este que alimenta o orçamento. */
  readonly gzipKb: number;
  /** `sha256` do derivado: rodar a ingestão 2× tem de repetir este valor. */
  readonly sha256: string;
  /** Rótulo do layout de bytes (`p3n3c1-int16-le`, `png-rgba8`, `verbatim`). */
  readonly format: string;
  /** Como o site lê estes bytes. Vai para o relatório, não para o bundle. */
  readonly usage: string;
}

/**
 * Uma entrada do registro. Os sete primeiros campos são o `BriefAsset` da spec §5 — os
 * demais são o que a ingestão descobriu e o portão precisa.
 */
export interface AssetRegistryEntry {
  /** Identificador estável, derivado do nome do arquivo (`cranio`, `foto-do-estudio`). */
  readonly id: string;
  readonly path: string;
  readonly kind: AssetKind;
  readonly origin: string;
  readonly license: string;
  readonly attribution: string | null;
  readonly estimatedKb: number | null;
  /**
   * URL do crédito. Sem ela o crédito não pode ser **link real**, e link real é a exigência
   * — texto solto num rodapé não é atribuição, é menção.
   */
  readonly attributionUrl: string | null;
  readonly source: AssetSource;
  readonly derivatives: readonly AssetDerivative[];
  /** O que a ingestão precisou decidir e o leitor precisa saber (ex.: "cópia verbatim"). */
  readonly notes: readonly string[];
}

/** O objeto da spec §5, sem nenhum campo a mais — é o que entra no `brief.json`. */
export interface BriefAsset {
  readonly path: string;
  readonly kind: AssetKind;
  readonly origin: string;
  readonly license: string;
  readonly attribution: string | null;
  readonly estimatedKb: number | null;
}

export function briefAssetFrom(entry: AssetRegistryEntry): BriefAsset {
  return {
    path: entry.path,
    kind: entry.kind,
    origin: entry.origin,
    license: entry.license,
    attribution: entry.attribution,
    estimatedKb: entry.estimatedKb,
  };
}

export interface AssetRegistry {
  readonly version: number;
  readonly assets: readonly AssetRegistryEntry[];
}

export function sha256Of(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Peso que o navegador baixa, na mesma unidade e no mesmo nível do `measure-bundle`. */
export function gzipKb(bytes: Uint8Array): number {
  return round2(gzipSync(bytes, { level: 9 }).byteLength / 1024);
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * `Crânio Humano (v2).STL` -> `cranio-humano-v2`. Sem acento, sem espaço e sem maiúscula:
 * o id vira nome de arquivo, chave do registro e identificador no código do site.
 */
export function slugify(raw: string): string {
  const ascii = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const slug = ascii
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug.length > 0 ? slug : 'asset';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readStringField(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' ? value : null;
}

function readKind(value: unknown): AssetKind {
  return ASSET_KINDS.includes(value as AssetKind) ? (value as AssetKind) : 'other';
}

function parseSource(value: unknown): AssetSource | null {
  if (!isRecord(value)) return null;
  const path = readStringField(value, 'path');
  const sha256 = readStringField(value, 'sha256');
  if (path === null || sha256 === null) return null;
  return {
    path,
    extension: readStringField(value, 'extension') ?? '',
    bytes: typeof value['bytes'] === 'number' ? value['bytes'] : 0,
    sha256,
  };
}

function parseDerivative(value: unknown): AssetDerivative | null {
  if (!isRecord(value)) return null;
  const file = readStringField(value, 'file');
  const sha256 = readStringField(value, 'sha256');
  if (file === null || sha256 === null) return null;
  const bytes = typeof value['bytes'] === 'number' ? value['bytes'] : 0;
  return {
    file,
    bytes,
    kb: typeof value['kb'] === 'number' ? value['kb'] : round2(bytes / 1024),
    gzipKb: typeof value['gzipKb'] === 'number' ? value['gzipKb'] : 0,
    sha256,
    format: readStringField(value, 'format') ?? 'desconhecido',
    usage: readStringField(value, 'usage') ?? '',
  };
}

function parseEntry(value: unknown): AssetRegistryEntry | null {
  if (!isRecord(value)) return null;
  const id = readStringField(value, 'id');
  const source = parseSource(value['source']);
  if (id === null || source === null) return null;

  const rawDerivatives = Array.isArray(value['derivatives']) ? value['derivatives'] : [];
  const rawNotes = Array.isArray(value['notes']) ? value['notes'] : [];

  return {
    id,
    path: readStringField(value, 'path') ?? source.path,
    kind: readKind(value['kind']),
    origin: readStringField(value, 'origin') ?? '',
    license: readStringField(value, 'license') ?? '',
    attribution: readStringField(value, 'attribution'),
    estimatedKb: typeof value['estimatedKb'] === 'number' ? value['estimatedKb'] : null,
    attributionUrl: readStringField(value, 'attributionUrl'),
    source,
    derivatives: rawDerivatives
      .map(parseDerivative)
      .filter((entry): entry is AssetDerivative => entry !== null),
    notes: rawNotes.filter((note): note is string => typeof note === 'string'),
  };
}

export function registryPath(projectRoot: string, explicit?: string): string {
  const raw = explicit ?? ASSET_REGISTRY_FILE;
  return isAbsolute(raw) ? raw : resolve(projectRoot, raw);
}

/** Registro ausente é registro vazio: nenhum asset trazido ainda não é erro. */
export function readRegistry(path: string): AssetRegistry {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return { version: ASSET_REGISTRY_VERSION, assets: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(`${path} não é JSON válido: ${String(cause)}`);
  }
  if (!isRecord(parsed)) throw new Error(`${path} não contém um objeto JSON.`);

  const list = Array.isArray(parsed['assets']) ? parsed['assets'] : [];
  return {
    version: typeof parsed['version'] === 'number' ? parsed['version'] : ASSET_REGISTRY_VERSION,
    assets: list.map(parseEntry).filter((entry): entry is AssetRegistryEntry => entry !== null),
  };
}

/**
 * Substitui a entrada de mesmo `id` e grava com as entradas **ordenadas por id**. A ordenação
 * não é estética: sem ela o mesmo conjunto de assets produziria arquivos diferentes conforme
 * a ordem de ingestão, e o registro deixaria de ser comparável entre duas execuções.
 *
 * Nada aqui carrega data. Determinismo vale para tudo que a ingestão escreve — um
 * `generatedAt` faria o `sha256` do registro mudar sozinho a cada rodada.
 */
export function writeRegistry(path: string, entry: AssetRegistryEntry): AssetRegistry {
  const current = readRegistry(path);
  const merged = [...current.assets.filter((item) => item.id !== entry.id), entry].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const registry: AssetRegistry = { version: ASSET_REGISTRY_VERSION, assets: merged };

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
  return registry;
}

/** `true` quando `candidate` está dentro de `root` — a checagem que barra fonte no repo. */
export function isInside(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel) && !rel.startsWith(`..${sep}`);
}

/** Caminho relativo à raiz do site, sempre com `/`, como o registro guarda. */
export function toProjectRelative(projectRoot: string, absolutePath: string): string {
  return relative(projectRoot, absolutePath).split(sep).join('/');
}
