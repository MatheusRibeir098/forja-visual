/**
 * O que o navegador baixa antes da primeira pintura, em gzip, contra o orçamento do brief.
 *
 * "Crítico" sai do próprio `dist/index.html`, não de uma lista mantida à mão — assim um
 * `<script>` bloqueante novo aparece aqui na hora em que é adicionado.
 *
 * ⚖️ Este portão **informa, não reprova** (§6 da spec): passar do orçamento imprime o
 * excedente e sai com 0. Mas continua saindo diferente de zero quando **falha de verdade em
 * medir** — `dist/` ausente, arquivo ilegível, gzip que estoura. A diferença entre "passou
 * do teto" e "não consegui medir" é a razão de ser deste script.
 *
 *   tsx measure-bundle.ts --project=/caminho/do/site --brief=brief.json
 *   tsx measure-bundle.ts --project=. --critical-kb=300 --lazy-kb=600 --build
 *
 * Argumentos: --project --dist --brief --config --out --json
 *             --critical-kb --lazy-kb --fonts-kb --build [--build-cmd="pnpm build"]
 * Saídas: 0 medido (dentro ou fora do orçamento) · 1 não foi possível medir.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative } from 'node:path';
import { gzipSync } from 'node:zlib';
import {
  argFlag,
  argNumber,
  argString,
  nowIso,
  parseArgs,
  readNumber,
  readString,
  resolveTarget,
  section,
  toKb,
} from './lib/config';
import { emitMeasurement } from './lib/report';
import type { BundleMeasurement, CriticalFile } from './lib/report';

const EXIT_CANNOT_MEASURE = 1;
const GZIP_LEVEL = 9;
const DEFAULT_BUILD_COMMAND = 'pnpm build';

interface TagMatch {
  readonly attrs: Readonly<Record<string, string>>;
}

function parseAttributes(rawTag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrPattern = /([a-zA-Z-]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s">]+))?/g;
  let match = attrPattern.exec(rawTag);
  while (match !== null) {
    const name = match[1];
    if (name !== undefined) {
      const rawValue = match[2] ?? '';
      attrs[name.toLowerCase()] = rawValue.replace(/^["']|["']$/g, '');
    }
    match = attrPattern.exec(rawTag);
  }
  return attrs;
}

function findTags(html: string, tagName: 'link' | 'script'): TagMatch[] {
  const pattern = new RegExp(`<${tagName}\\b([^>]*)>`, 'gi');
  const found: TagMatch[] = [];
  let match = pattern.exec(html);
  while (match !== null) {
    found.push({ attrs: parseAttributes(match[1] ?? '') });
    match = pattern.exec(html);
  }
  return found;
}

/** `/assets/index-abc.js` -> `assets/index-abc.js`, relativo a `dist/`. */
function toDistRelative(url: string): string | null {
  if (!url || /^(https?:)?\/\//.test(url) || url.startsWith('data:')) return null;
  return posix.normalize(url.replace(/^\//, '').split(/[?#]/)[0] ?? '');
}

function listFiles(distDir: string, dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(distDir, full));
    else if (entry.isFile()) out.push(relative(distDir, full).split('\\').join('/'));
  }
  return out;
}

/** Falha de leitura/compressão é erro de medição e sobe; arquivo ausente vira aviso. */
function gzippedBytes(distDir: string, distRelativePath: string, missing: string[]): number {
  const full = join(distDir, distRelativePath);
  if (!existsSync(full) || !statSync(full).isFile()) {
    missing.push(distRelativePath);
    return 0;
  }
  try {
    return gzipSync(readFileSync(full), { level: GZIP_LEVEL }).byteLength;
  } catch (cause) {
    throw new Error(`não consegui comprimir ${distRelativePath}: ${String(cause)}`);
  }
}

interface Split {
  readonly critical: Set<string>;
  readonly fonts: Set<string>;
}

/**
 * Caminho crítico = o HTML mais tudo que o parser precisa antes de pintar: scripts de
 * módulo, folhas de estilo e os `modulepreload` que o bundler emite para o chunk de
 * entrada. Fontes com `preload` também são críticas, mas ganham orçamento próprio.
 */
function splitByRole(html: string): Split {
  const critical = new Set<string>(['index.html']);
  const fonts = new Set<string>();

  for (const { attrs } of findTags(html, 'script')) {
    const src = attrs['src'];
    if (attrs['type'] === 'module' && src !== undefined) {
      const path = toDistRelative(src);
      if (path) critical.add(path);
    }
  }

  for (const { attrs } of findTags(html, 'link')) {
    const rel = (attrs['rel'] ?? '').toLowerCase();
    const path = toDistRelative(attrs['href'] ?? '');
    if (!path) continue;
    if (rel === 'stylesheet' || rel === 'modulepreload') critical.add(path);
    else if (rel === 'preload' && attrs['as'] === 'font') fonts.add(path);
  }

  return { critical, fonts };
}

function ensureDist(projectRoot: string, entryHtml: string, build: string | null): void {
  if (existsSync(entryHtml)) return;

  if (build === null) {
    throw new Error(
      `nada para medir: ${entryHtml} não existe.\n` +
        '  Rode o build do projeto antes, ou passe --build para este script rodar por você.',
    );
  }

  console.info(`dist/ ausente — rodando \`${build}\`…`);
  const result = spawnSync('sh', ['-c', build], { cwd: projectRoot, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`\`${build}\` falhou; nada para medir.`);
  if (!existsSync(entryHtml))
    throw new Error(`\`${build}\` rodou mas ${entryHtml} não apareceu.`);
}

/** Uma linha da tabela: valor medido e, quando existe, a referência do brief. */
function formatAgainstBudget(kb: number, budgetKb: number | null, suffix = ''): string {
  const measured = `${kb.toFixed(2)} KB`;
  if (budgetKb === null) return `${measured}${suffix}  (sem orçamento declarado)`;
  const percent = budgetKb === 0 ? Infinity : Math.round((kb / budgetKb) * 100);
  const verdict = kb > budgetKb ? `⚠ ${percent}% do orçamento` : `${percent}% do orçamento`;
  return `${measured}${suffix}  (orçamento ${budgetKb} KB — ${verdict})`;
}

function printTable(rows: readonly (readonly [string, string])[]): void {
  const width = Math.max(...rows.map(([label]) => label.length));
  for (const [label, value] of rows) console.info(`  ${label.padEnd(width)}  ${value}`);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const target = resolveTarget(args);
  const bundleConfig = section(target.config, 'bundle');

  const distDir = target.distDir;
  const entryHtml = join(distDir, 'index.html');
  const buildCommand =
    argFlag(args, 'build') === true
      ? (argString(args, 'build-cmd') ??
        readString(bundleConfig, 'buildCommand') ??
        DEFAULT_BUILD_COMMAND)
      : null;

  ensureDist(target.projectRoot, entryHtml, buildCommand);

  const criticalBudgetKb = argNumber(args, 'critical-kb') ?? target.budget.criticalKb;
  const lazyBudgetKb = argNumber(args, 'lazy-kb') ?? target.budget.lazyKb;
  const fontsBudgetKb =
    argNumber(args, 'fonts-kb') ??
    target.budget.fontsKb ??
    readNumber(bundleConfig, 'fontsKb') ??
    null;

  const html = readFileSync(entryHtml, 'utf8');
  const { critical, fonts } = splitByRole(html);
  const allFiles = listFiles(distDir, distDir);
  const lazyFiles = allFiles.filter((file) => !critical.has(file) && !fonts.has(file));

  const missingReferences: string[] = [];
  const sumKb = (paths: Iterable<string>): number => {
    let bytes = 0;
    for (const path of paths) bytes += gzippedBytes(distDir, path, missingReferences);
    return toKb(bytes);
  };

  const criticalFiles: CriticalFile[] = [...critical]
    .map((file) => ({ file, kb: toKb(gzippedBytes(distDir, file, missingReferences)) }))
    .sort((a, b) => b.kb - a.kb);

  const criticalKb = toKb(criticalFiles.reduce((acc, file) => acc + file.kb * 1024, 0));
  const fontsKb = sumKb(fonts);
  const lazyKb = sumKb(lazyFiles);
  const totalKb = toKb((criticalKb + fontsKb + lazyKb) * 1024);

  const overBudget =
    (criticalBudgetKb !== null && criticalKb > criticalBudgetKb) ||
    (lazyBudgetKb !== null && lazyKb > lazyBudgetKb) ||
    (fontsBudgetKb !== null && fontsKb > fontsBudgetKb);

  const measurement: BundleMeasurement = {
    criticalKb,
    criticalFiles,
    fontsKb,
    lazyKb,
    totalKb,
    criticalBudgetKb,
    lazyBudgetKb,
    fontsBudgetKb,
    overBudget,
    measuredAt: nowIso(),
  };
  emitMeasurement('bundle', measurement, target);

  console.info(`\nbundle (gzip -${GZIP_LEVEL}, medido sobre ${distDir})`);
  if (target.configPath !== null) console.info(`  config       ${target.configPath}`);
  printTable([
    ...criticalFiles.map((file) => [`  ${file.file}`, `${file.kb.toFixed(2)} KB`] as const),
    ['criticalKb', formatAgainstBudget(criticalKb, criticalBudgetKb)],
    ['fontsKb', formatAgainstBudget(fontsKb, fontsBudgetKb)],
    ['lazyKb', formatAgainstBudget(lazyKb, lazyBudgetKb, ` em ${lazyFiles.length} arquivo(s)`)],
    ['totalKb', `${totalKb.toFixed(2)} KB`],
  ]);

  if (target.budget.rationale !== null) {
    console.info(`\n  orçamento do brief: ${target.budget.rationale}`);
  }
  if (missingReferences.length > 0) {
    console.warn(
      `\naviso: ${missingReferences.length} referência(s) do index.html não existem em dist/ — ` +
        `${missingReferences.slice(0, 5).join(', ')}`,
    );
  }

  console.info(
    overBudget
      ? '\nACIMA DO ORÇAMENTO — informativo, não reprova o build (spec §6).'
      : '\nOK — medido, dentro do orçamento declarado.',
  );
}

try {
  main();
} catch (cause) {
  console.error(
    `\nNÃO FOI POSSÍVEL MEDIR: ${cause instanceof Error ? cause.message : String(cause)}`,
  );
  process.exitCode = EXIT_CANNOT_MEASURE;
}
