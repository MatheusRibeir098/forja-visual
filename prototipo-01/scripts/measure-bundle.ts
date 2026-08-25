/**
 * Measures what the browser downloads before first paint, gzipped, against the
 * reference values from the spec (§6). "Critical" is derived from `dist/index.html`
 * itself, not from a hand-kept list, so adding a blocking <script> shows up here
 * immediately.
 *
 * The dono suspended the byte budget as a pass/fail gate: these numbers are now
 * informative only, printed next to their reference value. This script still exits
 * non-zero when it genuinely fails to measure (missing `dist/`, unreadable file, gzip
 * failure) — never for exceeding a reference value.
 *
 *   pnpm tsx scripts/measure-bundle.ts
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { PROJECT_ROOT } from './lib/chrome';
import { nowIso, patchMeasurements, toKb } from './lib/measurements';
import type { CriticalFile } from '../src/generated/types';

const DIST_DIR = resolve(PROJECT_ROOT, 'dist');
const ENTRY_HTML = join(DIST_DIR, 'index.html');

/**
 * Reference values from prompt.md §6. No longer a pass/fail gate — the dono suspended
 * the byte budget in favor of visual quality. Kept here purely to print alongside the
 * measured numbers, so the output still shows how much of the old reference is used.
 */
const CRITICAL_REFERENCE_KB = 300;
const FONTS_REFERENCE_KB = 80;
const LAZY_REFERENCE_KB = 600;

const GZIP_LEVEL = 9;

interface TagMatch {
  readonly tag: string;
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
    found.push({ tag: tagName, attrs: parseAttributes(match[1] ?? '') });
    match = pattern.exec(html);
  }
  return found;
}

/** `/assets/index-abc.js` -> `assets/index-abc.js`, relative to `dist/`. */
function toDistRelative(url: string): string | null {
  if (!url || /^(https?:)?\/\//.test(url) || url.startsWith('data:')) return null;
  return posix.normalize(url.replace(/^\//, '').split(/[?#]/)[0] ?? '');
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (entry.isFile()) out.push(relative(DIST_DIR, full).split('\\').join('/'));
  }
  return out;
}

function gzippedBytes(distRelativePath: string): number {
  const full = join(DIST_DIR, distRelativePath);
  if (!existsSync(full) || !statSync(full).isFile()) return 0;
  return gzipSync(readFileSync(full), { level: GZIP_LEVEL }).byteLength;
}

function ensureBuild(): void {
  if (existsSync(ENTRY_HTML)) return;
  console.info('dist/ ausente — rodando `pnpm build`…');
  const build = spawnSync('pnpm', ['build'], { cwd: PROJECT_ROOT, stdio: 'inherit' });
  if (build.status !== 0) throw new Error('`pnpm build` falhou; nada para medir.');
}

interface Split {
  readonly critical: Set<string>;
  readonly fonts: Set<string>;
}

/**
 * Critical path = the HTML plus everything the parser needs before it can paint:
 * module scripts, stylesheets and the module preloads Vite emits for the entry chunk.
 * Preloaded fonts are critical too, but the spec gives them their own budget.
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

function sumKb(paths: Iterable<string>): number {
  let bytes = 0;
  for (const path of paths) bytes += gzippedBytes(path);
  return toKb(bytes);
}

function printTable(rows: readonly (readonly [string, string])[]): void {
  const width = Math.max(...rows.map(([label]) => label.length));
  for (const [label, value] of rows) console.info(`  ${label.padEnd(width)}  ${value}`);
}

function main(): void {
  ensureBuild();

  const html = readFileSync(ENTRY_HTML, 'utf8');
  const { critical, fonts } = splitByRole(html);
  const allFiles = listFiles(DIST_DIR);
  const lazyFiles = allFiles.filter((file) => !critical.has(file) && !fonts.has(file));

  const criticalFiles: CriticalFile[] = [...critical]
    .map((file) => ({ file, kb: toKb(gzippedBytes(file)) }))
    .sort((a, b) => b.kb - a.kb);

  const criticalKb = toKb(criticalFiles.reduce((acc, f) => acc + f.kb * 1024, 0));
  const fontsKb = sumKb(fonts);
  const lazyKb = sumKb(lazyFiles);
  const totalKb = toKb((criticalKb + fontsKb + lazyKb) * 1024);
  const measuredAt = nowIso();

  patchMeasurements({
    bundle: { criticalKb, criticalFiles, fontsKb, lazyKb, totalKb, measuredAt },
  });

  console.info('\nbundle (gzip -9, medido sobre dist/) — números informativos, não reprovam o build');
  printTable([
    ...criticalFiles.map((f) => [`  ${f.file}`, `${f.kb.toFixed(2)} KB`] as const),
    ['criticalKb', `${criticalKb.toFixed(2)} KB  (referência: ${CRITICAL_REFERENCE_KB} KB)`],
    ['fontsKb', `${fontsKb.toFixed(2)} KB  (referência: ${FONTS_REFERENCE_KB} KB)`],
    [
      'lazyKb',
      `${lazyKb.toFixed(2)} KB  (referência: ${LAZY_REFERENCE_KB} KB, ${lazyFiles.length} arquivos)`,
    ],
    ['totalKb', `${totalKb.toFixed(2)} KB`],
  ]);

  console.info('\nOK — medido (orçamento de bytes é informativo, não reprova o build).');
}

main();
