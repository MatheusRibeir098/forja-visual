/**
 * Recebe um arquivo do usuário e produz o derivado que o site vai consumir.
 *
 * **Por que este script existe.** Um dos cinco fatores que tiraram o portfólio de referência
 * da média (`VISAO.md` §3.1) é *asset próprio*: um `.obj` processado por pipeline escrito
 * para ele, não preset de biblioteca. Quem traz o próprio modelo 3D está trazendo exatamente
 * aquilo que nenhum gerador inventa. Até aqui a ferramenta não sabia receber um arquivo.
 *
 * **Três regras vêm junto, e nenhuma é conselho** (spec §5):
 *
 * 1. **Processamento em build time, nunca em runtime.** O protótipo 01 provou o caminho: o
 *    `.stl` do crânio virou `Int16` pré-processado, sem decodificador no navegador. Por isso
 *    a determinismo é verificada por padrão — a ingestão roda o pipeline **duas vezes** e
 *    compara o `sha256`. Um derivado que muda entre execuções não é pré-processamento, é
 *    ruído com cache.
 * 2. **Licença é obrigação real.** `--origin` e `--license` são obrigatórios, e o crédito é
 *    obrigatório de forma **explícita**: ou `--attribution` + `--attribution-url`, ou
 *    `--no-attribution` afirmando que a licença dispensa. Não existe o caminho do silêncio.
 * 3. **O fonte não entra no repositório do site.** Arquivo dentro da raiz do projeto é
 *    recusado com código 2, antes de qualquer processamento.
 *
 * O que a ingestão grava em `.forge-visual/assets.json` é o que `check-attribution.ts`
 * cobra do site construído. Sem esse registro, a exigência do crédito seria mais uma
 * proibição sem portão.
 *
 *   tsx ingest-asset.ts --project=/caminho/do/site --file=~/modelos/cranio.stl \
 *     --origin="martinjario (Thingiverse)" --license="CC BY 4.0" \
 *     --attribution="Malha do crânio por martinjario, CC BY 4.0" \
 *     --attribution-url="https://www.thingiverse.com/thing:xxxxx"
 *
 *   tsx ingest-asset.ts --project=. --file=~/fotos/estudio.png --no-attribution \
 *     --origin="próprio" --license="proprietária" --max-size=1600
 *
 * Argumentos: --project --file --config --json
 *             --origin --license --attribution --attribution-url --no-attribution
 *             --id --kind --out-dir --registry
 *             --points (3D) --seed (3D) --max-size (imagem)
 *             --dry-run --no-verify
 * Saídas: 0 ingerido · 1 não foi possível ingerir · 2 o fonte está dentro do repositório.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, isAbsolute, join, resolve } from 'node:path';
import {
  argFlag,
  argNumber,
  argString,
  parseArgs,
  readNumber,
  readString,
  resolveTarget,
  section,
  toKb,
} from './lib/config';
import type { ParsedArgs, TargetConfig } from './lib/config';
import {
  ASSET_KINDS,
  DEFAULT_DERIVATIVE_DIR,
  briefAssetFrom,
  gzipKb,
  isInside,
  registryPath,
  sha256Of,
  slugify,
  toProjectRelative,
  writeRegistry,
} from './lib/assets';
import type { AssetDerivative, AssetKind, AssetRegistryEntry } from './lib/assets';
import { MESH_EXTENSIONS, parseMesh } from './lib/mesh';
import {
  DEFAULT_SEED,
  DEFAULT_TARGET_POINTS,
  POINT_CLOUD_FORMAT,
  POINT_STRIDE_BYTES,
  buildPointCloud,
  pointCloudToBuffer,
} from './lib/points';
import { decodePng, encodePng, probeImage, probeWoff2, resizeToFit } from './lib/image';

const EXIT_CANNOT_INGEST = 1;
const EXIT_SOURCE_INSIDE_REPO = 2;

const IMAGE_EXTENSIONS: readonly string[] = ['.png', '.jpg', '.jpeg', '.webp'];
const FONT_EXTENSIONS: readonly string[] = ['.woff2'];
const SUPPORTED_EXTENSIONS: readonly string[] = [
  ...MESH_EXTENSIONS,
  ...IMAGE_EXTENSIONS,
  ...FONT_EXTENSIONS,
];

/** Redução padrão de imagem. 2048 px cobre tela retina de 1024 px CSS sem sobrar textura. */
const DEFAULT_MAX_IMAGE_SIZE = 2048;

/**
 * Licenças que exigem crédito de quem publica. A lista não decide nada sozinha — ela só
 * decide **quão áspera é a recusa** quando alguém passa `--no-attribution` por cima de uma
 * delas. A obrigação de responder é sempre explícita, para toda licença.
 */
const ATTRIBUTION_LICENSE_PATTERN =
  /\bCC[\s-]?BY\b|creative\s*commons|\bBY[-\s]?(SA|NC|ND)\b|\bMIT\b|apache|\bBSD\b|\bOFL\b|\bSIL\b|\bGPL\b|\bMPL\b/i;

interface IngestedFile {
  readonly fileName: string;
  readonly bytes: Buffer;
  readonly format: string;
  readonly usage: string;
  /** Linhas do relatório específicas deste formato (contagem de pontos, dimensões…). */
  readonly details: readonly (readonly [string, string])[];
  readonly notes: readonly string[];
}

function inferKind(extension: string): AssetKind {
  if (MESH_EXTENSIONS.includes(extension)) return 'model3d';
  if (IMAGE_EXTENSIONS.includes(extension)) return 'image';
  if (FONT_EXTENSIONS.includes(extension)) return 'font';
  return 'other';
}

function unsupportedExtensionError(extension: string): Error {
  return new Error(
    `formato \`${extension || '(sem extensão)'}\` não é ingerível por esta ferramenta.\n` +
      `  Suportados: ${SUPPORTED_EXTENSIONS.join(', ')}\n` +
      '  3D: .stl (binário e ASCII) e .obj processados por completo; .glb sem compressão de malha.\n' +
      '  Imagem: .png processado por completo; .jpg e .webp conferidos e copiados verbatim.\n' +
      '  Fonte: .woff2 conferido e copiado verbatim.\n' +
      '  Converta o arquivo para um destes antes de ingerir — nada é gerado a partir de formato desconhecido.',
  );
}

function ingestMesh(buffer: Buffer, extension: string, id: string, args: ParsedArgs, config: Record<string, unknown>): IngestedFile {
  const targetPoints = argNumber(args, 'points') ?? readNumber(config, 'points') ?? DEFAULT_TARGET_POINTS;
  const seed = argNumber(args, 'seed') ?? readNumber(config, 'seed') ?? DEFAULT_SEED;

  const mesh = parseMesh(buffer, extension);
  const cloud = buildPointCloud(mesh, { targetPoints, seed });
  const bytes = pointCloudToBuffer(cloud);
  const { stats } = cloud;

  const notes: string[] = [...mesh.warnings];
  if (stats.points < stats.requestedPoints) {
    notes.push(
      `a malha só sustentou ${stats.points} pontos distintos dos ${stats.requestedPoints} pedidos ` +
        '(a peneira por voxel não achou mais célula ocupada) — é o limite do modelo, não do script.',
    );
  }

  return {
    fileName: `${id}.bin`,
    bytes,
    format: POINT_CLOUD_FORMAT,
    usage:
      `Int16 little-endian, passo de ${POINT_STRIDE_BYTES} bytes: ` +
      'px py pz nx ny nz curvatura. Divida por 32767 no shader. ' +
      'Os pontos vêm embaralhados: qualquer prefixo é amostra uniforme do objeto inteiro ' +
      '(escale por tier com um número, regra transversal 6).',
    details: [
      ['formato lido', mesh.format],
      ['triângulos', `${stats.sourceTriangles.toLocaleString('pt-BR')}`],
      ['vértices soldados', `${stats.weldedVertices.toLocaleString('pt-BR')}`],
      ['amostras de superfície', `${stats.surfaceSamples.toLocaleString('pt-BR')}`],
      ['resolução do voxel', `${stats.voxelResolution}³`],
      ['pontos gravados', `${stats.points.toLocaleString('pt-BR')} de ${stats.requestedPoints.toLocaleString('pt-BR')} pedidos`],
      ['raio original', `${stats.sourceRadius.toPrecision(6)} unidades do arquivo (o derivado é unitário)`],
      ['erro de quantização', `${(stats.quantizationErrorRadius * 100).toPrecision(3)}% do raio, no pior caso`],
      ['semente', `0x${stats.seed.toString(16)}`],
    ],
    notes,
  };
}

function ingestImage(buffer: Buffer, extension: string, id: string, args: ParsedArgs, config: Record<string, unknown>): IngestedFile {
  const maxSize = argNumber(args, 'max-size') ?? readNumber(config, 'maxSize') ?? DEFAULT_MAX_IMAGE_SIZE;
  if (!Number.isInteger(maxSize) || maxSize < 1) {
    throw new Error(`--max-size=${maxSize}: esperava um inteiro >= 1.`);
  }

  if (extension !== '.png') {
    const probe = probeImage(buffer, extension);
    return {
      fileName: `${id}${extension}`,
      bytes: buffer,
      format: 'verbatim',
      usage: `<img src>/textura ${probe.format}. Bytes idênticos ao arquivo de origem.`,
      details: [
        ['formato', `${probe.format} — ${probe.detail}`],
        ['dimensões', `${probe.width}×${probe.height} px`],
        ['transformação', 'nenhuma (cópia verbatim)'],
      ],
      notes: [
        `${probe.format} não é decodificado por esta ingestão — os scripts do plugin não declaram ` +
          'dependência, e não há decodificador de JPEG/WebP no Node. O arquivo foi conferido ' +
          '(assinatura e cabeçalho) e copiado como está: não houve redimensionamento nem remoção ' +
          'de metadado. Se ele carrega EXIF, o EXIF vai junto para o site. Converta para .png ' +
          'antes de ingerir se quiser redução e limpeza de metadado.',
      ],
    };
  }

  const decoded = decodePng(buffer);
  const resized = resizeToFit(decoded, maxSize);
  const bytes = encodePng(resized);
  const shrank = resized.width !== decoded.width || resized.height !== decoded.height;

  return {
    fileName: `${id}.png`,
    bytes,
    format: resized.channels === 4 ? 'png-rgba8' : 'png-rgb8',
    usage: 'PNG de 8 bits sem entrelaçamento, só IHDR/IDAT/IEND — pronto para `new Image()` ou `TextureLoader`.',
    details: [
      ['dimensões', shrank ? `${decoded.width}×${decoded.height} → ${resized.width}×${resized.height} px` : `${resized.width}×${resized.height} px`],
      ['canais', resized.channels === 4 ? 'RGBA' : 'RGB'],
      ['transformação', shrank ? `redução por média de área para ${maxSize} px no maior lado` : 'reescrita em 8 bits, sem redução'],
      ['metadados', 'todo chunk auxiliar descartado (EXIF, tEXt, tIME, perfil de cor)'],
    ],
    notes:
      buffer.byteLength < bytes.byteLength
        ? [
            `o PNG reescrito ficou maior que o original (${toKb(buffer.byteLength)} → ${toKb(bytes.byteLength)} KB): ` +
              'o arquivo de origem já vinha melhor comprimido do que o `zlib` do Node consegue. ' +
              'O derivado continua sendo o que entra no site, porque é ele que está sem metadado — ' +
              'mas se o peso importar mais que a privacidade neste asset, vale reavaliar.',
          ]
        : [],
  };
}

function ingestFont(buffer: Buffer, id: string): IngestedFile {
  const probe = probeWoff2(buffer);
  const savedPercent = probe.uncompressedBytes > 0
    ? Math.round((1 - buffer.byteLength / probe.uncompressedBytes) * 100)
    : 0;

  return {
    fileName: `${id}.woff2`,
    bytes: buffer,
    format: 'verbatim',
    usage: '@font-face com `format("woff2")`. Sirva com `<link rel="preload" as="font" crossorigin>`.',
    details: [
      ['contornos', probe.flavor === 'cff' ? 'CFF (curvas cúbicas)' : 'TrueType (curvas quadráticas)'],
      ['tabelas', `${probe.tables}`],
      ['descomprimida', `${toKb(probe.uncompressedBytes)} KB (${savedPercent}% já economizados pelo Brotli)`],
      ['transformação', 'nenhuma (cópia verbatim)'],
    ],
    notes: [
      'WOFF2 já é Brotli e já é o formato final da web — não há o que recomprimir. O único ganho ' +
        'que sobraria é subconjunto de glifos (remontar glyf/loca/cmap/hmtx), que é projeto próprio ' +
        'e não etapa de ingestão. O arquivo foi conferido e copiado como está.',
    ],
  };
}

function ingest(buffer: Buffer, extension: string, kind: AssetKind, id: string, args: ParsedArgs, config: Record<string, unknown>): IngestedFile {
  switch (kind) {
    case 'model3d':
      return ingestMesh(buffer, extension, id, args, config);
    case 'image':
      return ingestImage(buffer, extension, id, args, config);
    case 'font':
      return ingestFont(buffer, id);
    default:
      throw unsupportedExtensionError(extension);
  }
}

interface License {
  readonly origin: string;
  readonly license: string;
  readonly attribution: string | null;
  readonly attributionUrl: string | null;
}

/**
 * O portão de licença **na entrada**. Nada aqui é adivinhado: quem ingere responde origem,
 * licença e crédito, ou o arquivo não é ingerido. O silêncio não é uma resposta válida
 * porque o silêncio é justamente o que produz um site publicando obra de terceiro sem
 * crédito — e isso não é detalhe de estilo, é a licença sendo descumprida.
 */
function resolveLicense(args: ParsedArgs): License {
  const origin = argString(args, 'origin');
  const license = argString(args, 'license');

  if (origin === undefined || origin.trim() === '') {
    throw new Error('--origin é obrigatório: de onde veio o arquivo (autor, site, ou "próprio").');
  }
  if (license === undefined || license.trim() === '') {
    throw new Error('--license é obrigatório: a licença declarada (ex.: "CC BY 4.0", "própria", "CC0").');
  }

  const attribution = argString(args, 'attribution')?.trim();
  const attributionUrl = argString(args, 'attribution-url')?.trim();
  const declaredNone = argFlag(args, 'attribution') === false;

  if (attribution !== undefined && attribution !== '') {
    if (attributionUrl === undefined || attributionUrl === '') {
      throw new Error(
        'com --attribution, --attribution-url também é obrigatório.\n' +
          '  O crédito tem de ser **link real** no site — texto solto num rodapé é menção, não atribuição, ' +
          'e é o link que `check-attribution.ts` cobra do HTML construído.',
      );
    }
    if (!/^https?:\/\/\S+$/.test(attributionUrl)) {
      throw new Error(`--attribution-url=${attributionUrl}: esperava uma URL http(s) completa.`);
    }
    return { origin, license, attribution, attributionUrl };
  }

  if (!declaredNone) {
    throw new Error(
      `a licença "${license}" precisa de uma resposta explícita sobre crédito. Escolha uma:\n` +
        '  --attribution="<crédito exigido>" --attribution-url="<link do autor/obra>"\n' +
        '  --no-attribution   (você está afirmando que esta licença NÃO exige crédito)\n' +
        '  Não existe o caminho do silêncio: é assim que um site publica obra de terceiro sem crédito.',
    );
  }

  if (ATTRIBUTION_LICENSE_PATTERN.test(license)) {
    throw new Error(
      `--no-attribution com a licença "${license}".\n` +
        '  Esta família de licença exige crédito por definição (CC BY, MIT, Apache, BSD, OFL, GPL…).\n' +
        '  Se o arquivo é seu e você é quem licencia, declare --license="própria" (ou "CC0").\n' +
        '  Se é de terceiro, o crédito é obrigatório: use --attribution + --attribution-url.',
    );
  }

  return { origin, license, attribution: null, attributionUrl: null };
}

function readSourceFile(args: ParsedArgs, projectRoot: string): { path: string; buffer: Buffer } {
  const raw = argString(args, 'file');
  if (raw === undefined || raw === '') {
    throw new Error('--file é obrigatório: o caminho do arquivo que o usuário trouxe.');
  }

  const expanded = raw.startsWith('~/') ? join(process.env['HOME'] ?? '~', raw.slice(2)) : raw;
  const path = isAbsolute(expanded) ? expanded : resolve(process.cwd(), expanded);

  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`--file=${raw}: arquivo não encontrado (procurei em ${path}).`);
  }

  if (isInside(projectRoot, path)) {
    const error = new Error(
      `o arquivo fonte está DENTRO do repositório do site (${path}).\n` +
        '  Regra da spec §5: o fonte fica fora do repositório; só o derivado processado entra.\n' +
        '  Motivo: o fonte é pesado, versionado a cada exportação, e quase sempre carrega licença de\n' +
        '  terceiro colada nele. No protótipo 01 o `.stl` do crânio (CC BY de martinjario) vive fora\n' +
        `  do repo e só a nuvem \`Int16\` entra.\n` +
        `  Mova o arquivo para fora de ${projectRoot} e ingira de novo.`,
    );
    error.name = 'SourceInsideRepo';
    throw error;
  }

  return { path, buffer: readFileSync(path) };
}

function resolveOutDir(target: TargetConfig, args: ParsedArgs, config: Record<string, unknown>): string {
  const raw = argString(args, 'out-dir') ?? readString(config, 'outDir') ?? DEFAULT_DERIVATIVE_DIR;
  const outDir = isAbsolute(raw) ? raw : resolve(target.projectRoot, raw);
  if (!isInside(target.projectRoot, outDir)) {
    throw new Error(`--out-dir=${raw}: aponta para fora da raiz do projeto (${target.projectRoot}).`);
  }
  return outDir;
}

function printTable(rows: readonly (readonly [string, string])[]): void {
  if (rows.length === 0) return;
  const width = Math.max(...rows.map(([label]) => label.length));
  for (const [label, value] of rows) console.info(`  ${label.padEnd(width)}  ${value}`);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const target = resolveTarget(args);
  const config = section(target.config, 'assets');

  const license = resolveLicense(args);
  const source = readSourceFile(args, target.projectRoot);

  const extension = extname(source.path).toLowerCase();
  const kind = ((): AssetKind => {
    const declared = argString(args, 'kind');
    const inferred = inferKind(extension);
    if (declared === undefined) return inferred;
    if (!ASSET_KINDS.includes(declared as AssetKind)) {
      throw new Error(`--kind=${declared}: esperava um de ${ASSET_KINDS.join(', ')}.`);
    }
    if (declared !== inferred) {
      throw new Error(
        `--kind=${declared} não bate com a extensão \`${extension}\`, que é \`${inferred}\`. ` +
          'Corrija o --kind ou o arquivo — a ingestão não trata um pelo outro.',
      );
    }
    return inferred;
  })();

  if (kind === 'other') throw unsupportedExtensionError(extension);

  const id = slugify(argString(args, 'id') ?? basename(source.path, extension));
  const produced = ingest(source.buffer, extension, kind, id, args, config);

  // Determinismo é portão, não promessa: regra transversal 4 verifica build de asset rodando
  // duas vezes e comparando `sha256`. Aqui a segunda execução é no mesmo processo, o que é
  // mais duro — se houvesse dependência de estado global, ela apareceria aqui primeiro.
  const derivativeSha = sha256Of(produced.bytes);
  const verify = argFlag(args, 'verify') ?? true;
  if (verify) {
    const second = sha256Of(ingest(source.buffer, extension, kind, id, args, config).bytes);
    if (second !== derivativeSha) {
      throw new Error(
        `o pipeline NÃO é determinístico: duas execuções sobre o mesmo arquivo deram\n` +
          `    ${derivativeSha}\n    ${second}\n` +
          '  Um derivado que muda sozinho invalida cache, polui diff e quebra a regra transversal 4. ' +
          'Isto é defeito do script, não do seu arquivo — reporte.',
      );
    }
  }

  const outDir = resolveOutDir(target, args, config);
  const derivativePath = join(outDir, produced.fileName);
  const dryRun = argFlag(args, 'dry-run') ?? false;

  if (!dryRun) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(derivativePath, produced.bytes);
  }

  const derivative: AssetDerivative = {
    file: toProjectRelative(target.projectRoot, derivativePath),
    bytes: produced.bytes.byteLength,
    kb: toKb(produced.bytes.byteLength),
    gzipKb: gzipKb(produced.bytes),
    sha256: derivativeSha,
    format: produced.format,
    usage: produced.usage,
  };

  const entry: AssetRegistryEntry = {
    id,
    path: source.path,
    kind,
    origin: license.origin,
    license: license.license,
    attribution: license.attribution,
    // O que o navegador baixa, na mesma unidade do `measure-bundle` — é este número que entra
    // no `budget` do brief, e ele entra ANTES, não é descoberto depois (spec §5).
    estimatedKb: derivative.gzipKb,
    attributionUrl: license.attributionUrl,
    source: {
      path: source.path,
      extension,
      bytes: source.buffer.byteLength,
      sha256: sha256Of(source.buffer),
    },
    derivatives: [derivative],
    notes: produced.notes,
  };

  const registryFile = registryPath(target.projectRoot, argString(args, 'registry'));
  if (!dryRun) writeRegistry(registryFile, entry);

  if (target.printJson) {
    process.stdout.write(`${JSON.stringify({ asset: entry, briefAsset: briefAssetFrom(entry) }, null, 2)}\n`);
  }

  const reduction = source.buffer.byteLength > 0
    ? Math.round((1 - derivative.bytes / source.buffer.byteLength) * 100)
    : 0;

  console.info(`\ningestão de asset — ${id} (${kind})${dryRun ? '  [--dry-run: nada foi gravado]' : ''}`);
  if (target.configPath !== null) console.info(`  config  ${target.configPath}`);
  printTable([
    ['fonte', `${source.path}  (${toKb(source.buffer.byteLength)} KB, fora do repo ✔)`],
    ...produced.details,
    ['derivado', derivative.file],
    ['peso', `${derivative.kb.toFixed(2)} KB  ·  ${derivative.gzipKb.toFixed(2)} KB gzip  (${reduction >= 0 ? '−' : '+'}${Math.abs(reduction)}% do fonte)`],
    ['estimatedKb', `${derivative.gzipKb.toFixed(2)}  → é este número que entra no budget do brief`],
    ['sha256', derivative.sha256],
    ['determinismo', verify ? 'verificado — duas execuções, mesmo sha256' : 'NÃO verificado (--no-verify)'],
    ['origem', license.origin],
    ['licença', license.license],
    [
      'crédito',
      license.attribution === null
        ? 'nenhum exigido (declarado com --no-attribution)'
        : `${license.attribution} → ${license.attributionUrl ?? ''}`,
    ],
  ]);

  console.info(`\n  como o site lê: ${produced.usage}`);
  for (const note of produced.notes) console.info(`\n  ⚠ ${note}`);

  if (license.attribution !== null) {
    console.info(
      '\n  O CRÉDITO AGORA É EXIGÊNCIA DE BUILD.\n' +
        '  Renderize-o como link real, num colofão global que NÃO esteja dentro de nenhuma <section> —\n' +
        '  é assim que ele sobrevive ao corte de qualquer seção. Sugestão de marcação:\n\n' +
        `      <footer data-forge-colophon>\n        <a href="${license.attributionUrl ?? ''}">${license.attribution}</a>\n      </footer>\n\n` +
        '  Verifique com:  tsx check-attribution.ts --project=. --build',
    );
  }

  if (!dryRun) console.info(`\n  registro atualizado: ${toProjectRelative(target.projectRoot, registryFile)}`);
  console.info(dryRun ? '\nOK — ingestão simulada.' : '\nOK — derivado gravado e registrado.');
}

try {
  main();
} catch (cause) {
  const message = cause instanceof Error ? cause.message : String(cause);
  console.error(`\nNÃO FOI POSSÍVEL INGERIR: ${message}`);
  process.exitCode =
    cause instanceof Error && cause.name === 'SourceInsideRepo'
      ? EXIT_SOURCE_INSIDE_REPO
      : EXIT_CANNOT_INGEST;
}
