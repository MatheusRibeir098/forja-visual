/// <reference lib="dom" />
// Parte deste arquivo roda dentro da página (page.evaluate), então precisa da lib DOM em
// cima do tsconfig de Node — declarada aqui em vez de alargar o projeto inteiro.

/**
 * O portão da licença: o crédito está no site, como link real, e sobrevive ao corte da seção?
 *
 * **Este script existe por um defeito conhecido.** O plugin já carrega proibições sem portão —
 * o item 7 do backlog registra que texto dentro do canvas é proibido e **nenhum medidor
 * acusa**. Uma proibição sem verificação é obedecida errado: o agente contorna a letra e
 * reproduz o problema com outro nome. A exigência de crédito seria a próxima da fila, então
 * ela nasce com portão.
 *
 * Três coisas são verificadas, e as três reprovam:
 *
 * 1. **O arquivo fonte não entra no repositório do site.** Nenhum `.stl`/`.obj`/`.psd`/`.ttf`
 *    sob a raiz, e nenhum arquivo com o `sha256` de um fonte registrado. No protótipo 01 o
 *    `.stl` do crânio (CC BY 4.0 de `martinjario`) vive fora do repo; só a nuvem `Int16` entra.
 * 2. **Todo asset com `attribution` tem um `<a href>` real**, com texto, apontando para a
 *    `attributionUrl` registrada, e com o texto do crédito no link ou no elemento que o
 *    contém.
 * 3. **Esse link está fora de toda `<section>`.** É a forma verificável de "sobrevive ao corte
 *    de qualquer seção": um crédito que só existe dentro de uma seção morre junto com ela na
 *    primeira reorganização do site. Fora de seção = colofão global = sobrevive.
 *
 * A verificação é **estática sobre o HTML construído** por padrão, o que casa com a convenção
 * do template ("tudo que precisa ser lido tem que existir no HTML/DOM, não só nos pixels").
 * Com `--rendered`, o mesmo link é conferido no DOM vivo, onde se descobre a outra metade:
 * crédito presente no HTML e **escondido por CSS**, que é a armadilha §3.5 das guardrails
 * aplicada à atribuição.
 *
 *   tsx check-attribution.ts --project=/caminho/do/site --build
 *   tsx check-attribution.ts --project=. --rendered
 *
 * Argumentos: --project --dist --config --json --build [--build-cmd] --rendered [--url] [--port]
 * Saídas: 0 tudo em ordem · 1 reprovou · 4 nada verificável (não há HTML construído a ler).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import {
  argFlag,
  argString,
  parseArgs,
  readString,
  resolveTarget,
  section,
} from './lib/config';
import type { TargetConfig } from './lib/config';
import { RAW_SOURCE_EXTENSIONS, readRegistry, registryPath, sha256Of } from './lib/assets';
import type { AssetRegistryEntry } from './lib/assets';
import { launchRealGpu, startPreview } from './lib/chrome';

const EXIT_FAILED = 1;
const EXIT_NOTHING_TO_CHECK = 4;

const DEFAULT_BUILD_COMMAND = 'pnpm build';

/** Não varremos o que não é do site: dependência, saída de build e artefato de controle. */
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', '.git', '.forge-visual', 'coverage']);

/** Elementos que podem ser cortados inteiros numa reorganização do site. */
const SECTION_TAGS = new Set(['section', 'article']);
const SECTION_ATTRIBUTE = 'data-forge-section';

/** Quantos níveis acima do link o texto do crédito ainda conta como "junto do link". */
const CREDIT_TEXT_ANCESTOR_DEPTH = 2;

// ---------------------------------------------------------------------------------------
// HTML: árvore mínima, o suficiente para perguntar por ancestral e por texto de subárvore.
// ---------------------------------------------------------------------------------------

interface HtmlNode {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: HtmlNode[];
  parent: HtmlNode | null;
  /** Texto direto deste nó (nós de texto viram filhos com `tag === '#text'`). */
  readonly text: string;
}

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);
const RAW_TEXT_TAGS = new Set(['script', 'style']);

function parseAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;
  let match = pattern.exec(raw);
  while (match !== null) {
    const name = match[1];
    if (name !== undefined) {
      attrs[name.toLowerCase()] = (match[2] ?? '').replace(/^["']|["']$/g, '');
    }
    match = pattern.exec(raw);
  }
  return attrs;
}

function makeNode(tag: string, attrs: Record<string, string>, text = ''): HtmlNode {
  return { tag, attrs, children: [], parent: null, text };
}

/**
 * Parser deliberadamente pequeno: só precisa de aninhamento e texto. Não normaliza tag mal
 * fechada como um navegador normalizaria — e é por isso que `--rendered` existe.
 */
function parseHtml(html: string): HtmlNode {
  const root = makeNode('#root', {});
  const stack: HtmlNode[] = [root];
  const push = (node: HtmlNode): void => {
    const parent = stack[stack.length - 1] ?? root;
    node.parent = parent;
    parent.children.push(node);
  };

  const tagPattern = /<(!--[\s\S]*?--|!\[CDATA\[[\s\S]*?\]\]|!?\/?[a-zA-Z][^>]*)>/g;
  let cursor = 0;
  let match = tagPattern.exec(html);

  while (match !== null) {
    if (match.index > cursor) {
      push(makeNode('#text', {}, html.slice(cursor, match.index)));
    }
    const body = match[1] ?? '';
    cursor = match.index + match[0].length;

    if (!body.startsWith('!')) {
      if (body.startsWith('/')) {
        const tag = body.slice(1).trim().toLowerCase();
        const at = stack.findLastIndex((node) => node.tag === tag);
        if (at > 0) stack.length = at;
      } else {
        const space = body.search(/[\s/]/);
        const tag = (space === -1 ? body : body.slice(0, space)).toLowerCase();
        const node = makeNode(tag, parseAttributes(space === -1 ? '' : body.slice(space)));
        push(node);

        if (RAW_TEXT_TAGS.has(tag)) {
          const closing = html.indexOf(`</${tag}`, cursor);
          cursor = closing === -1 ? html.length : closing;
          tagPattern.lastIndex = cursor;
        } else if (!VOID_TAGS.has(tag) && !body.endsWith('/')) {
          stack.push(node);
        }
      }
    }

    match = tagPattern.exec(html);
  }

  if (cursor < html.length) push(makeNode('#text', {}, html.slice(cursor)));
  return root;
}

function collect(node: HtmlNode, tag: string, into: HtmlNode[] = []): HtmlNode[] {
  if (node.tag === tag) into.push(node);
  for (const child of node.children) collect(child, tag, into);
  return into;
}

const ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  '&apos;': "'", '&nbsp;': ' ', '&mdash;': '—', '&ndash;': '–',
};

function decodeEntities(raw: string): string {
  return raw
    .replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp|mdash|ndash);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/&#(\d+);/g, (_all, code: string) => String.fromCodePoint(Number(code)));
}

function textOf(node: HtmlNode): string {
  if (node.tag === '#text') return decodeEntities(node.text);
  if (RAW_TEXT_TAGS.has(node.tag)) return '';
  return node.children.map(textOf).join('');
}

/** Sem acento, sem caixa, com espaço colapsado — o crédito não pode falhar por formatação. */
function normalizeText(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '').toLowerCase();
}

function hasSectionAncestor(node: HtmlNode): boolean {
  let current = node.parent;
  while (current !== null) {
    if (SECTION_TAGS.has(current.tag) || SECTION_ATTRIBUTE in current.attrs) return true;
    current = current.parent;
  }
  return false;
}

function isStaticallyHidden(node: HtmlNode): boolean {
  let current: HtmlNode | null = node;
  while (current !== null) {
    if ('hidden' in current.attrs) return true;
    if (current.attrs['aria-hidden'] === 'true') return true;
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(current.attrs['style'] ?? '')) return true;
    current = current.parent;
  }
  return false;
}

/** O texto do crédito conta se estiver no link ou até dois níveis acima dele. */
function creditTextNear(anchor: HtmlNode, attribution: string): boolean {
  const wanted = normalizeText(attribution);
  let current: HtmlNode | null = anchor;
  for (let level = 0; level <= CREDIT_TEXT_ANCESTOR_DEPTH && current !== null; level += 1) {
    if (normalizeText(textOf(current)).includes(wanted)) return true;
    current = current.parent;
  }
  return false;
}

// ---------------------------------------------------------------------------------------
// Verificação 1 — o fonte não pode estar no repositório.
// ---------------------------------------------------------------------------------------

interface SourceLeak {
  readonly file: string;
  readonly reason: string;
}

function walkProject(root: string, dir: string, out: string[]): void {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (item.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(item.name)) continue;
      walkProject(root, join(dir, item.name), out);
    } else if (item.isFile()) {
      out.push(relative(root, join(dir, item.name)).split(sep).join('/'));
    }
  }
}

function findSourceLeaks(projectRoot: string, assets: readonly AssetRegistryEntry[]): SourceLeak[] {
  const files: string[] = [];
  walkProject(projectRoot, projectRoot, files);

  const bySize = new Map<number, AssetRegistryEntry[]>();
  for (const asset of assets) {
    const list = bySize.get(asset.source.bytes) ?? [];
    list.push(asset);
    bySize.set(asset.source.bytes, list);
  }

  // `.jpg`, `.webp` e `.woff2` são copiados verbatim, então o derivado tem o `sha256` do
  // fonte — e sem esta isenção o portão acusaria vazamento exatamente onde a ingestão fez o
  // certo. A isenção é estreita de propósito: vale só para o caminho **e** o hash que a
  // própria ingestão registrou, então ninguém libera um fonte só por citá-lo no registro.
  const registeredDerivatives = new Set(
    assets.flatMap((asset) => asset.derivatives.map((derivative) => `${derivative.file}#${derivative.sha256}`)),
  );

  const leaks: SourceLeak[] = [];
  for (const file of files) {
    const absolute = join(projectRoot, file);
    const extension = extname(file).toLowerCase();

    if (RAW_SOURCE_EXTENSIONS.includes(extension)) {
      leaks.push({
        file,
        reason: `\`${extension}\` é formato de origem — só o derivado processado entra no repositório.`,
      });
      continue;
    }

    // Hash só do que tem o tamanho exato de algum fonte registrado: renomear o arquivo não
    // engana, e varrer o repo inteiro com sha256 seria caro à toa.
    const candidates = bySize.get(statSync(absolute).size);
    if (candidates === undefined) continue;
    const digest = sha256Of(readFileSync(absolute));
    if (registeredDerivatives.has(`${file}#${digest}`)) continue;
    const match = candidates.find((asset) => asset.source.sha256 === digest);
    if (match !== undefined) {
      leaks.push({
        file,
        reason: `é byte a byte o fonte de \`${match.id}\` (${match.license}, ${match.origin}) — renomeado, mas é o mesmo arquivo.`,
      });
    }
  }

  return leaks;
}

// ---------------------------------------------------------------------------------------
// Verificação 2 e 3 — o crédito como link real, fora de seção.
// ---------------------------------------------------------------------------------------

type CreditStatus =
  | 'ok'
  | 'sem-link'
  | 'link-sem-texto'
  | 'texto-do-credito-ausente'
  | 'dentro-de-secao'
  | 'escondido';

interface CreditCheck {
  readonly assetId: string;
  readonly attribution: string;
  readonly attributionUrl: string;
  readonly status: CreditStatus;
  /** Onde o link foi achado, quando foi (`dist/index.html`). */
  readonly foundIn: string | null;
  readonly detail: string;
}

interface HtmlDocument {
  readonly file: string;
  readonly root: HtmlNode;
}

function checkCredit(asset: AssetRegistryEntry, documents: readonly HtmlDocument[]): CreditCheck {
  const attribution = asset.attribution ?? '';
  const attributionUrl = asset.attributionUrl ?? '';
  const wantedUrl = normalizeUrl(attributionUrl);

  const base = { assetId: asset.id, attribution, attributionUrl };
  let best: CreditCheck = {
    ...base,
    status: 'sem-link',
    foundIn: null,
    detail: `nenhum <a href="${attributionUrl}"> no HTML construído.`,
  };

  const rank: Record<CreditStatus, number> = {
    'sem-link': 0,
    escondido: 1,
    'dentro-de-secao': 2,
    'link-sem-texto': 3,
    'texto-do-credito-ausente': 4,
    ok: 5,
  };
  const keep = (candidate: CreditCheck): void => {
    if (rank[candidate.status] > rank[best.status]) best = candidate;
  };

  for (const document of documents) {
    for (const anchor of collect(document.root, 'a')) {
      if (normalizeUrl(anchor.attrs['href'] ?? '') !== wantedUrl) continue;

      const anchorText = normalizeText(textOf(anchor));
      if (isStaticallyHidden(anchor)) {
        keep({ ...base, status: 'escondido', foundIn: document.file, detail: 'o link existe mas está marcado como oculto (hidden, aria-hidden ou display:none inline).' });
        continue;
      }
      if (hasSectionAncestor(anchor)) {
        keep({ ...base, status: 'dentro-de-secao', foundIn: document.file, detail: 'o link só existe dentro de uma <section>/<article> — some junto com ela se a seção for cortada.' });
        continue;
      }
      if (anchorText === '') {
        keep({ ...base, status: 'link-sem-texto', foundIn: document.file, detail: 'o <a> aponta para a URL certa mas não tem texto — link sem texto não credita ninguém.' });
        continue;
      }
      if (!creditTextNear(anchor, attribution)) {
        keep({ ...base, status: 'texto-do-credito-ausente', foundIn: document.file, detail: `o link diz "${textOf(anchor).trim()}", e o crédito registrado ("${attribution}") não aparece nele nem nos ${CREDIT_TEXT_ANCESTOR_DEPTH} elementos que o contêm.` });
        continue;
      }

      keep({ ...base, status: 'ok', foundIn: document.file, detail: `link real, com texto, fora de qualquer seção.` });
    }
  }

  return best;
}

// ---------------------------------------------------------------------------------------
// Verificação opcional — o mesmo link, no DOM vivo, de fato visível.
// ---------------------------------------------------------------------------------------

interface RenderedCredit {
  readonly assetId: string;
  readonly visible: boolean;
  readonly detail: string;
}

async function checkRendered(
  target: TargetConfig,
  assets: readonly AssetRegistryEntry[],
): Promise<RenderedCredit[]> {
  const preview = await startPreview({
    projectRoot: target.projectRoot,
    url: target.url,
    port: target.port,
    command: target.previewCommand,
  });
  const gpu = await launchRealGpu({ projectRoot: target.projectRoot });

  try {
    const page = await gpu.browser.newPage();
    await page.goto(preview.url, { waitUntil: 'load' });

    const wanted = assets.map((asset) => ({
      id: asset.id,
      url: normalizeUrl(asset.attributionUrl ?? ''),
    }));

    // Uma arrow só, **sem função nomeada dentro**: o tsx compila com `keepNames` do esbuild, e
    // uma função interna nomeada arrastaria um helper `__name(...)` para o código enviado à
    // página, que morre com `ReferenceError` lá dentro. Mesma restrição dos outros medidores.
    return await page.evaluate((entries: { id: string; url: string }[]) => {
      return entries.map((entry) => {
        const anchors = [...document.querySelectorAll('a[href]')].filter(
          (anchor) =>
            (anchor.getAttribute('href') ?? '').trim().replace(/\/+$/, '').toLowerCase() === entry.url,
        );
        if (anchors.length === 0) {
          return { assetId: entry.id, visible: false, detail: 'nenhum <a> com essa URL no DOM vivo.' };
        }

        let why = 'o <a> existe no DOM mas não desenha.';

        for (const anchor of anchors) {
          const box = anchor.getBoundingClientRect();
          const text = (anchor.textContent ?? '').trim();

          if (text === '') {
            why = 'o <a> existe no DOM mas está sem texto.';
            continue;
          }
          if (box.width < 1 || box.height < 1) {
            why = `o <a> existe no DOM mas ocupa ${box.width.toFixed(1)}×${box.height.toFixed(1)} px.`;
            continue;
          }

          // `opacity` NÃO é herdada, então ler só a do próprio <a> deixa passar o crédito
          // apagado por um ancestral — é a armadilha §3.5 das guardrails na forma exata em
          // que ela apareceu no protótipo 01. Subir a cadeia é o que fecha o buraco.
          let effectiveOpacity = 1;
          let hidden = '';
          for (let node: Element | null = anchor; node !== null; node = node.parentElement) {
            const style = window.getComputedStyle(node);
            if (style.display === 'none') hidden = `display:none em <${node.tagName.toLowerCase()}>`;
            if (style.visibility === 'hidden') hidden = `visibility:hidden em <${node.tagName.toLowerCase()}>`;
            if (node.getAttribute('aria-hidden') === 'true') {
              hidden = `aria-hidden em <${node.tagName.toLowerCase()}>`;
            }
            effectiveOpacity *= Number(style.opacity === '' ? '1' : style.opacity);
          }

          if (hidden !== '') {
            why = `o <a> existe no DOM mas está escondido — ${hidden}.`;
            continue;
          }
          if (effectiveOpacity <= 0.05) {
            why =
              `o <a> existe no DOM mas a opacidade acumulada até ele é ${effectiveOpacity.toFixed(3)} ` +
              '— crédito apagado por um ancestral não credita ninguém.';
            continue;
          }

          return {
            assetId: entry.id,
            visible: true,
            detail: `visível: "${text}" em ${Math.round(box.width)}×${Math.round(box.height)} px.`,
          };
        }

        return { assetId: entry.id, visible: false, detail: why };
      });
    }, wanted);
  } finally {
    await gpu.browser.close();
    await preview.stop();
  }
}

// ---------------------------------------------------------------------------------------

function listHtml(distDir: string): HtmlDocument[] {
  const documents: HtmlDocument[] = [];
  const walk = (dir: string): void => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, item.name);
      if (item.isDirectory()) walk(full);
      else if (item.isFile() && extname(item.name).toLowerCase() === '.html') {
        documents.push({
          file: relative(distDir, full).split(sep).join('/'),
          root: parseHtml(readFileSync(full, 'utf8')),
        });
      }
    }
  };
  walk(distDir);
  return documents;
}

function ensureDist(projectRoot: string, distDir: string, build: string | null): boolean {
  if (existsSync(join(distDir, 'index.html'))) return true;
  if (build === null) return false;

  console.info(`dist/ ausente — rodando \`${build}\`…`);
  const result = spawnSync('sh', ['-c', build], { cwd: projectRoot, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`\`${build}\` falhou; não há HTML construído a conferir.`);
  return existsSync(join(distDir, 'index.html'));
}

function printTable(rows: readonly (readonly [string, string])[]): void {
  if (rows.length === 0) return;
  const width = Math.max(...rows.map(([label]) => label.length));
  for (const [label, value] of rows) console.info(`  ${label.padEnd(width)}  ${value}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const target = resolveTarget(args);
  const assetsConfig = section(target.config, 'assets');

  const registryFile = registryPath(target.projectRoot, argString(args, 'registry'));
  const registry = readRegistry(registryFile);
  const credited = registry.assets.filter((asset) => asset.attribution !== null);

  const leaks = findSourceLeaks(target.projectRoot, registry.assets);

  console.info(`\ncrédito e origem dos assets — ${target.projectRoot}`);
  console.info(
    `  registro   ${existsSync(registryFile) ? relative(target.projectRoot, registryFile) : '(ausente)'}` +
      `  ·  ${registry.assets.length} asset(s), ${credited.length} com crédito exigido`,
  );

  console.info('\n1. arquivo fonte fora do repositório');
  if (leaks.length === 0) {
    console.info('  ok — nenhum arquivo de origem sob a raiz do site.');
  } else {
    for (const leak of leaks) console.info(`  ✗ ${leak.file} — ${leak.reason}`);
  }

  const buildCommand =
    argFlag(args, 'build') === true
      ? (argString(args, 'build-cmd') ?? readString(assetsConfig, 'buildCommand') ?? DEFAULT_BUILD_COMMAND)
      : null;
  const hasDist = ensureDist(target.projectRoot, target.distDir, buildCommand);

  if (credited.length === 0) {
    console.info('\n2. crédito renderizado');
    console.info('  nada a exigir — nenhum asset registrado declarou `attribution`.');
    const verdict = leaks.length === 0;
    if (target.printJson) {
      process.stdout.write(`${JSON.stringify({ attribution: { ok: verdict, leaks, credits: [] } }, null, 2)}\n`);
    }
    console.info(verdict ? '\nOK — nada a cobrar.' : '\nREPROVADO — fonte dentro do repositório.');
    if (!verdict) process.exitCode = EXIT_FAILED;
    return;
  }

  if (!hasDist) {
    console.error(
      `\nNADA VERIFICÁVEL: ${join(target.distDir, 'index.html')} não existe, e ${credited.length} asset(s) ` +
        'exigem crédito.\n  Rode o build antes, ou passe --build para este script rodar por você.',
    );
    process.exitCode = EXIT_NOTHING_TO_CHECK;
    return;
  }

  const documents = listHtml(target.distDir);
  const credits = credited.map((asset) => checkCredit(asset, documents));

  console.info(`\n2. crédito como link real, fora de toda seção  (${documents.length} arquivo(s) HTML)`);
  for (const credit of credits) {
    const mark = credit.status === 'ok' ? '✔' : '✗';
    console.info(`  ${mark} ${credit.assetId}  [${credit.status}]  ${credit.detail}`);
    if (credit.status !== 'ok') {
      printTable([
        ['    crédito exigido', credit.attribution],
        ['    link exigido', credit.attributionUrl],
      ]);
    }
  }

  let rendered: RenderedCredit[] = [];
  const wantsRendered = (argFlag(args, 'rendered') ?? false) || argString(args, 'url') !== undefined;
  if (wantsRendered) {
    console.info('\n3. o mesmo link, visível no DOM vivo');
    try {
      rendered = await checkRendered(target, credited);
      for (const item of rendered) {
        console.info(`  ${item.visible ? '✔' : '✗'} ${item.assetId}  ${item.detail}`);
      }
    } catch (cause) {
      console.warn(`  aviso: não consegui abrir o site para conferir o DOM — ${String(cause)}`);
      console.warn('  a verificação estática acima continua valendo; esta é reforço, não substituta.');
    }
  } else {
    console.info('\n3. DOM vivo — não conferido (passe --rendered para incluir).');
    console.info('  A checagem estática não vê crédito escondido por CSS (armadilha §3.5 das guardrails).');
  }

  const ok =
    leaks.length === 0 &&
    credits.every((credit) => credit.status === 'ok') &&
    rendered.every((item) => item.visible);

  if (target.printJson) {
    process.stdout.write(`${JSON.stringify({ attribution: { ok, leaks, credits, rendered } }, null, 2)}\n`);
  }

  if (ok) {
    console.info('\nOK — todo crédito exigido está no colofão, como link real, fora de seção.');
    return;
  }

  const invisible = new Set(rendered.filter((item) => !item.visible).map((item) => item.assetId));
  const toFix = credits.filter((credit) => credit.status !== 'ok' || invisible.has(credit.assetId));

  console.error(
    '\nREPROVADO. O crédito de uma licença não é acabamento: sem ele o site publica obra de\n' +
      'terceiro em desacordo com a licença.\n' +
      (leaks.length > 0
        ? `\n  ${leaks.length} arquivo(s) de origem sob a raiz do site — tire-os do repositório; só o derivado entra.\n`
        : '') +
      (toFix.length > 0
        ? '\n  Cada crédito abaixo precisa existir como link real, com texto, FORA de toda <section>\n' +
          '  (colofão global) e visível na tela — não desenhado dentro do canvas:\n\n' +
          toFix
            .map(
              (credit) =>
                `      <footer data-forge-colophon>\n` +
                `        <a href="${credit.attributionUrl}">${credit.attribution}</a>\n` +
                `      </footer>\n` +
                `      (${credit.assetId}: ${invisible.has(credit.assetId) && credit.status === 'ok' ? 'está no HTML, mas não desenha na tela' : credit.status})`,
            )
            .join('\n\n')
        : ''),
  );
  process.exitCode = EXIT_FAILED;
}

main().catch((cause: unknown) => {
  console.error(`\nNÃO FOI POSSÍVEL VERIFICAR: ${cause instanceof Error ? cause.message : String(cause)}`);
  process.exitCode = EXIT_NOTHING_TO_CHECK;
});
