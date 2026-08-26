/**
 * O portão da estrutura: cada arquivo do site está no lugar que a §5.2 da spec definiu?
 *
 * **Por que isto reprova em vez de aconselhar.** A estrutura (`content/` × `sections/<nome>/` ×
 * `shaders/` × `generated/` × `engine/`) não é preferência estética: é o que torna o
 * paralelismo possível. A regra de ouro da fase 4 é *arquivos disjuntos* — dois `visual-dev` no
 * mesmo arquivo significa que o segundo sobrescreve o primeiro. Uma seção por pasta garante
 * interseção vazia sem que o orquestrador precise negociar caso a caso. E, como todo o resto
 * deste plugin já aprendeu: regra sem verificação é conselho, e conselho é ignorado quando
 * aperta — o item 7 do backlog registra uma proibição que nenhum medidor acusava e que por isso
 * era obedecida errado.
 *
 * Cinco verificações, todas estáticas (nenhum navegador, nenhum build), todas reprovam:
 *
 * 1. **Lugar do arquivo.** Só as pastas da §5.2 existem sob `src/`; uma seção é uma **pasta**
 *    com `index.ts` exportando `mountSection`; CSS de seção vive na pasta da seção e `styles/`
 *    fica com o global — inclusive sem seletor cravado no `id` de uma seção.
 * 2. **Texto fora do markup.** Nenhuma frase visível escrita dentro de `src/sections/`:
 *    `textContent`/`innerHTML`/`insertAdjacentHTML`, HTML com prosa em literal, e os atributos
 *    que o leitor de tela lê (`aria-label`, `alt`, `title`, `placeholder`). O texto vem de
 *    `src/content/<nome>.ts`, tipado.
 * 3. **`src/generated/` sem procedência.** Todo arquivo ali ou é derivado registrado em
 *    `.forge-visual/assets.json` **com o `sha256` que a ingestão gravou** (hash diferente = foi
 *    editado depois de gerado), ou traz `@generated` no cabeçalho dizendo qual script o
 *    produziu. Sem essa fronteira, alguém corrige o sintoma no arquivo gerado e a correção some
 *    no próximo build.
 * 4. **`src/engine/` intocado.** O motor vem do template do plugin e é comparado byte a byte
 *    com ele: um ajuste ali atinge todas as seções ao mesmo tempo, o que é o oposto de arquivos
 *    disjuntos. Precisa de algo que o motor não dá? A correção pertence ao template, não ao site.
 * 5. **`prefers-reduced-motion` fora do código.** A §5.1 decide, por produto, que o site anima
 *    para todo mundo — nenhum `@media (prefers-reduced-motion...)` em CSS e nenhum `matchMedia`
 *    lendo essa preferência em TypeScript/JavaScript, em código nenhum de `src/`. Comentário não
 *    conta: o mesmo tokenizador da verificação 2 apaga comentário antes de procurar, e é por
 *    isso que `src/engine/tier.ts` — que cita a expressão em comentário, explicando como
 *    reverter a decisão — passa limpo.
 *
 * **O que este portão NÃO vê**, declarado porque limite escondido vira falsa confiança:
 *
 * - texto escrito direto no `index.html` — ali o markup é o esqueleto legível sem JavaScript, e
 *   o título de cada seção é parte dele; separar "esqueleto" de "cópia" no HTML exigiria
 *   adivinhar intenção, e um portão que erra é um portão que alguém desliga;
 * - se o nome de um shader descreve o **mecanismo** (`thresholdMask`) ou o efeito (`legal2`) —
 *   isso é revisão humana, não regex;
 * - arquivo em `src/generated/` editado à mão e **regerado** em seguida: o hash volta a bater, e
 *   é assim que tem de ser;
 * - `src/variants/<id>/` (fase 2) na verificação de texto: variante é protótipo de direção, com
 *   cópia provisória, e cobrar `content/` dela atrasaria a divergência sem proteger nada.
 *
 *   tsx check-structure.ts --project=/caminho/do/site
 *   tsx check-structure.ts --project=. --json --no-engine
 *
 * Argumentos: --project --config --json [--no-engine] [--template=<dir>] [--registry]
 * Saídas: 0 tudo no lugar · 1 reprovou · 4 nada verificável (não há `src/` a ler).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argFlag, argString, parseArgs, readString, resolveTarget, section } from './lib/config';
import { readRegistry, registryPath, sha256Of } from './lib/assets';

const EXIT_FAILED = 1;
const EXIT_NOTHING_TO_CHECK = 4;

/** As pastas da §5.2, e mais nada, sob `src/`. */
const SRC_DIRECTORIES: Readonly<Record<string, string>> = {
  engine: 'motor — vem do template, não se edita',
  sections: 'uma pasta por seção',
  shaders: 'GLSL cru, um arquivo por técnica',
  styles: 'tokens, base, tipografia — o global',
  content: 'texto tipado, um arquivo por seção',
  generated: 'saída de script, nunca editada à mão',
  variants: 'variantes de hero da fase 2',
  lib: 'utilitário puro compartilhado, sem imagem dentro',
};

/** Arquivos soltos aceitos na raiz de `src/`. */
const SRC_ROOT_FILES = new Set(['main.ts', 'vite-env.d.ts']);

/** O que este portão considera "arquivo de código" — o resto (`.md`, `.gitkeep`) é ignorado. */
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.css', '.glsl', '.frag', '.vert']);

const STYLE_EXTENSIONS = new Set(['.css']);

/** Nome do arquivo de estilo de uma seção. Outros `.css` na pasta da seção também passam. */
const SECTION_STYLE_FILE = 'style.css';

/** Marcador de procedência exigido em `src/generated/`. */
const GENERATED_MARKER = '@generated';

/** Quantas linhas do topo são lidas à procura do marcador. */
const GENERATED_HEADER_LINES = 12;

/** Arquivos que documentam a pasta e não são artefato gerado. */
const GENERATED_EXEMPT = new Set(['README.md', '.gitkeep']);

/** Mínimo de letras para um literal contar como frase visível, e não como token técnico. */
const MIN_PROSE_LETTERS = 4;

const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', '.git', '.forge-visual', 'coverage']);

interface Violation {
  readonly check: 'lugar' | 'texto' | 'gerado' | 'motor' | 'motion';
  /** Caminho relativo à raiz do site, com `/` em qualquer plataforma. */
  readonly file: string;
  readonly line: number | null;
  readonly problem: string;
  /** O que fazer — sempre uma ação, nunca "reorganize". */
  readonly fix: string;
}

interface Note {
  readonly text: string;
}

// ---------------------------------------------------------------------------------------
// Sistema de arquivos
// ---------------------------------------------------------------------------------------

function toPosix(path: string): string {
  return path.split(sep).join('/');
}

function listFiles(root: string, dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (item.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(item.name)) continue;
      listFiles(root, join(dir, item.name), out);
    } else if (item.isFile()) {
      out.push(toPosix(relative(root, join(dir, item.name))));
    }
  }
  return out;
}

function listDirectories(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((item) => item.isDirectory())
    .map((item) => item.name)
    .sort();
}

function isCode(file: string): boolean {
  return CODE_EXTENSIONS.has(extname(file).toLowerCase());
}

// ---------------------------------------------------------------------------------------
// 1. Lugar do arquivo
// ---------------------------------------------------------------------------------------

/** `export function mountSection`, `export const mountSection`, `export { mountSection }`. */
function exportsMountSection(source: string): boolean {
  if (/export\s+(?:async\s+)?function\s+mountSection\b/.test(source)) return true;
  if (/export\s+(?:const|let|var)\s+mountSection\b/.test(source)) return true;
  return /export\s*\{[^}]*\bmountSection\b[^}]*\}/.test(source);
}

/** Ids de `<section id="...">` do `index.html` — é a lista contra a qual `styles/` é conferido. */
function readSectionIds(projectRoot: string): string[] {
  const html = join(projectRoot, 'index.html');
  if (!existsSync(html)) return [];
  const source = readFileSync(html, 'utf8');
  const ids: string[] = [];
  const pattern = /<section\b[^>]*\bid\s*=\s*["']([^"']+)["']/gi;
  let match = pattern.exec(source);
  while (match !== null) {
    const id = match[1];
    if (id !== undefined) ids.push(id);
    match = pattern.exec(source);
  }
  return ids;
}

function checkPlacement(projectRoot: string, sectionNames: readonly string[]): Violation[] {
  const violations: Violation[] = [];
  const srcDir = join(projectRoot, 'src');

  // 1a. Só as pastas da §5.2 (e os dois arquivos de raiz) existem sob `src/`.
  for (const item of readdirSync(srcDir, { withFileTypes: true })) {
    if (item.isDirectory()) {
      if (item.name in SRC_DIRECTORIES) continue;
      violations.push({
        check: 'lugar',
        file: `src/${item.name}/`,
        line: null,
        problem: `pasta fora da estrutura: \`src/${item.name}/\` não é uma das pastas da §5.2.`,
        fix: `mova o conteúdo para a pasta que corresponde ao papel dele — ${Object.keys(SRC_DIRECTORIES).map((name) => `\`${name}/\``).join(', ')} — ou, se for uma seção, para \`src/sections/${item.name}/\`.`,
      });
      continue;
    }
    if (!item.isFile() || SRC_ROOT_FILES.has(item.name) || !isCode(item.name)) continue;
    violations.push({
      check: 'lugar',
      file: `src/${item.name}`,
      line: null,
      problem: `arquivo solto na raiz de \`src/\` — ali só existem ${[...SRC_ROOT_FILES].map((name) => `\`${name}\``).join(' e ')}.`,
      fix: 'se é de uma seção, vá para `src/sections/<nome>/`; se é texto, para `src/content/<nome>.ts`; se é shader, para `src/shaders/`.',
    });
  }

  // 1b. Uma seção é uma PASTA. Nada de código solto em `src/sections/`.
  const sectionsDir = join(srcDir, 'sections');
  if (existsSync(sectionsDir)) {
    for (const item of readdirSync(sectionsDir, { withFileTypes: true })) {
      if (!item.isFile() || !isCode(item.name)) continue;
      const name = basename(item.name, extname(item.name));
      violations.push({
        check: 'lugar',
        file: `src/sections/${item.name}`,
        line: null,
        problem: 'arquivo de seção solto em `src/sections/` — uma seção é uma pasta.',
        fix: `mova para \`src/sections/${name}/${extname(item.name) === '.css' ? SECTION_STYLE_FILE : 'index.ts'}\`. Uma pasta por seção é o que garante interseção vazia entre os devs em paralelo.`,
      });
    }
  }

  // 1c. Cada pasta de seção tem `index.ts` exportando `mountSection`.
  for (const name of sectionNames) {
    const indexFile = join(sectionsDir, name, 'index.ts');
    if (!existsSync(indexFile)) {
      violations.push({
        check: 'lugar',
        file: `src/sections/${name}/`,
        line: null,
        problem: 'pasta de seção sem `index.ts` — a seção não tem porta de entrada.',
        fix: `crie \`src/sections/${name}/index.ts\` exportando \`mountSection(root: HTMLElement, engine: Engine)\`.`,
      });
      continue;
    }
    if (!exportsMountSection(readFileSync(indexFile, 'utf8'))) {
      violations.push({
        check: 'lugar',
        file: `src/sections/${name}/index.ts`,
        line: null,
        problem: '`index.ts` da seção não exporta `mountSection`.',
        fix: 'exporte `mountSection(root: HTMLElement, engine: Engine)` — é a assinatura que `src/main.ts` e `dev/<nome>.ts` montam.',
      });
    }
  }

  // 1d. CSS só no global e dentro da pasta da seção/variante.
  for (const file of listFiles(projectRoot, srcDir)) {
    if (!STYLE_EXTENSIONS.has(extname(file).toLowerCase())) continue;
    const parts = file.split('/'); // src/<pasta>/...
    const area = parts[1];
    if (area === 'styles') continue;
    if ((area === 'sections' || area === 'variants') && parts.length >= 4) continue;
    if (area === 'generated') continue;
    violations.push({
      check: 'lugar',
      file,
      line: null,
      problem: 'CSS fora de `src/styles/` e fora da pasta de uma seção.',
      fix: 'estilo de seção é `src/sections/<nome>/style.css`, importado pelo `index.ts` da seção; token, reset e tipografia são `src/styles/`.',
    });
  }

  // 1e. O global não pode carregar o específico de uma seção.
  const stylesDir = join(srcDir, 'styles');
  const sectionIds = new Set([...sectionNames, ...readSectionIds(projectRoot)]);
  for (const file of listFiles(projectRoot, stylesDir)) {
    if (!STYLE_EXTENSIONS.has(extname(file).toLowerCase())) continue;
    const name = basename(file, extname(file));
    if (sectionIds.has(name)) {
      violations.push({
        check: 'lugar',
        file,
        line: null,
        problem: `\`src/styles/${basename(file)}\` tem o nome de uma seção — \`styles/\` é o global.`,
        fix: `mova para \`src/sections/${name}/${SECTION_STYLE_FILE}\`.`,
      });
      continue;
    }
    const source = readFileSync(join(projectRoot, file), 'utf8');
    for (const id of sectionIds) {
      const selector = new RegExp(`#${id}\\b`);
      const at = source.split('\n').findIndex((line) => selector.test(line));
      if (at === -1) continue;
      violations.push({
        check: 'lugar',
        file,
        line: at + 1,
        problem: `seletor \`#${id}\` num arquivo global — regra de seção escrita em \`src/styles/\`.`,
        fix: `mova esta regra para \`src/sections/${id}/${SECTION_STYLE_FILE}\`. Enquanto ela ficar aqui, dois devs disputam o mesmo arquivo.`,
      });
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------------------
// 2. Texto hardcoded no markup de uma seção
//
// Um leitor mínimo de TypeScript: separa comentário de código e devolve os literais com a
// posição. Sem isto, o próprio comentário que explica a regra (que cita `<section>` e frases
// inteiras) seria acusado — e um portão que acusa a própria documentação é desligado no
// primeiro dia.
// ---------------------------------------------------------------------------------------

interface Literal {
  /** Conteúdo já sem as aspas; num template literal, com `${…}` trocado por espaço. */
  readonly value: string;
  readonly line: number;
  /** Código imediatamente anterior ao literal, sem comentário — é nele que o sink é achado. */
  readonly before: string;
}

/**
 * Os literais **não** são apagados desta cópia: o sink `setAttribute('aria-label', 'frase')`
 * só é reconhecível se o nome do atributo continuar visível no código anterior à frase.
 */

const SINK_CONTEXT_CHARS = 80;

interface TokenizedSource {
  /** Cópia do fonte com todo comentário virado espaço, preservando deslocamento e linhas. */
  readonly stripped: string;
  readonly marks: readonly { readonly start: number; readonly end: number; readonly value: string }[];
}

/**
 * Tokenizador mínimo, comum às verificações 2 e 5: separa comentário (linha dupla-barra ou bloco
 * barra-asterisco) de string (aspas simples, duplas e template literal), preservando posição e
 * linha. `stripped` apaga só o comentário — string e código continuam visíveis nele, que é onde
 * os dois portões buscam. Sem isto, o próprio comentário que explica uma regra (que cita a API
 * que a regra proíbe) seria acusado — e um portão que acusa a própria documentação é desligado
 * no primeiro dia.
 */
function tokenize(source: string): TokenizedSource {
  const code = source.split('');
  const marks: { start: number; end: number; value: string }[] = [];

  let index = 0;
  const length = source.length;

  const blank = (from: number, to: number): void => {
    for (let at = from; at < to; at += 1) {
      if (code[at] !== '\n') code[at] = ' ';
    }
  };

  while (index < length) {
    const char = source[index];
    const next = source[index + 1];

    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', index);
      blank(index, end === -1 ? length : end);
      index = end === -1 ? length : end;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      const stop = end === -1 ? length : end + 2;
      blank(index, stop);
      index = stop;
      continue;
    }
    if (char === "'" || char === '"') {
      const quote = char;
      let at = index + 1;
      let value = '';
      while (at < length) {
        const current = source[at];
        if (current === '\\') {
          value += source[at + 1] ?? '';
          at += 2;
          continue;
        }
        if (current === quote || current === '\n') break;
        value += current;
        at += 1;
      }
      marks.push({ start: index, end: at + 1, value });
      index = at + 1;
      continue;
    }
    if (char === '`') {
      let at = index + 1;
      let value = '';
      let depth = 0;
      while (at < length) {
        const current = source[at];
        if (current === '\\') {
          value += source[at + 1] ?? '';
          at += 2;
          continue;
        }
        if (depth === 0 && current === '$' && source[at + 1] === '{') {
          depth = 1;
          value += ' ';
          at += 2;
          continue;
        }
        if (depth > 0) {
          if (current === '{') depth += 1;
          if (current === '}') depth -= 1;
          at += 1;
          continue;
        }
        if (current === '`') break;
        value += current;
        at += 1;
      }
      marks.push({ start: index, end: at + 1, value });
      index = at + 1;
      continue;
    }

    index += 1;
  }

  return { stripped: code.join(''), marks };
}

/** Fonte sem comentário (virado espaço) — string e código continuam visíveis nela. Usa `tokenize`. */
function stripComments(source: string): string {
  return tokenize(source).stripped;
}

function scanLiterals(source: string): Literal[] {
  const literals: Literal[] = [];
  const { stripped, marks } = tokenize(source);
  const length = source.length;
  const lineOf = (offset: number): number => {
    let line = 1;
    for (let at = 0; at < offset && at < length; at += 1) if (source[at] === '\n') line += 1;
    return line;
  };

  for (const mark of marks) {
    literals.push({
      value: mark.value,
      line: lineOf(mark.start),
      before: stripped.slice(Math.max(0, mark.start - SINK_CONTEXT_CHARS), mark.start),
    });
  }
  return literals;
}

function countLetters(text: string): number {
  return (text.match(/\p{L}/gu) ?? []).length;
}

function isProse(text: string): boolean {
  return countLetters(text.trim()) >= MIN_PROSE_LETTERS;
}

/** Sinks de conteúdo: escrever literal aqui é escrever a cópia dentro do código. */
const TEXT_SINKS: readonly { readonly pattern: RegExp; readonly what: string }[] = [
  { pattern: /\.(?:textContent|innerText|innerHTML|outerHTML)\s*=\s*$/, what: 'atribuição a `textContent`/`innerHTML`' },
  { pattern: /\.insertAdjacentHTML\s*\(\s*(?:'[^']*'|"[^"]*")\s*,\s*$/, what: '`insertAdjacentHTML`' },
  { pattern: /createTextNode\s*\(\s*$/, what: '`createTextNode`' },
  { pattern: /\.(?:ariaLabel|alt|placeholder|title)\s*=\s*$/, what: 'atributo lido pelo leitor de tela' },
  {
    pattern: /(?:setAttribute|setAttributeNS)\s*\([^)]*['"](?:aria-label|aria-description|alt|title|placeholder)['"]\s*,\s*$/,
    what: 'atributo lido pelo leitor de tela',
  },
];

/** Tags que carregam texto de leitura. `div`/`span` entram: é onde a cópia costuma cair. */
const HTML_TAGS = new Set([
  'a', 'abbr', 'article', 'aside', 'b', 'blockquote', 'button', 'caption', 'cite', 'code',
  'dd', 'details', 'dfn', 'div', 'dt', 'em', 'figcaption', 'figure', 'footer', 'h1', 'h2',
  'h3', 'h4', 'h5', 'h6', 'header', 'i', 'label', 'li', 'main', 'mark', 'nav', 'ol', 'p',
  'section', 'small', 'span', 'strong', 'sub', 'summary', 'sup', 'td', 'th', 'time', 'ul',
]);

/** Prosa entre tags dentro de um literal — o caso do markup montado por template string. */
function proseInMarkup(value: string): string | null {
  if (!value.includes('</')) return null;
  const pattern = /<([a-zA-Z][\w-]*)\b[^>]*>([^<]+)/g;
  let match = pattern.exec(value);
  while (match !== null) {
    const tag = (match[1] ?? '').toLowerCase();
    const text = match[2] ?? '';
    if (HTML_TAGS.has(tag) && isProse(text)) return text.trim();
    match = pattern.exec(value);
  }
  return null;
}

function checkHardcodedText(projectRoot: string): Violation[] {
  const violations: Violation[] = [];
  const sectionsDir = join(projectRoot, 'src', 'sections');

  for (const file of listFiles(projectRoot, sectionsDir)) {
    const extension = extname(file).toLowerCase();
    if (extension !== '.ts' && extension !== '.tsx') continue;
    const sectionName = file.split('/')[2] ?? '<nome>';
    const source = readFileSync(join(projectRoot, file), 'utf8');

    for (const literal of scanLiterals(source)) {
      const sink = TEXT_SINKS.find((candidate) => candidate.pattern.test(literal.before));
      if (sink !== undefined && isProse(literal.value)) {
        violations.push({
          check: 'texto',
          file,
          line: literal.line,
          problem: `texto visível escrito no markup (${sink.what}): "${literal.value.trim().slice(0, 60)}".`,
          fix: `mova a frase para \`src/content/${sectionName}.ts\`, tipada, e importe-a aqui. O texto passa a ser revisável sem tocar em código.`,
        });
        continue;
      }

      const inMarkup = proseInMarkup(literal.value);
      if (inMarkup !== null) {
        violations.push({
          check: 'texto',
          file,
          line: literal.line,
          problem: `texto visível dentro de HTML literal: "${inMarkup.slice(0, 60)}".`,
          fix: `mova a frase para \`src/content/${sectionName}.ts\` e interpole a partir de lá — ou monte o nó com \`createElement\` + \`textContent\`.`,
        });
      }
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------------------
// 3. `src/generated/` — procedência
// ---------------------------------------------------------------------------------------

function hasGeneratedMarker(absolute: string): boolean {
  let head: string;
  try {
    head = readFileSync(absolute, 'utf8').split('\n', GENERATED_HEADER_LINES).join('\n');
  } catch {
    // Binário puro (nuvem de pontos, atlas): não há cabeçalho a ler — o registro decide.
    return false;
  }
  return head.includes(GENERATED_MARKER);
}

function checkGenerated(projectRoot: string, registryFile: string): Violation[] {
  const generatedDir = join(projectRoot, 'src', 'generated');
  if (!existsSync(generatedDir)) return [];

  const registry = readRegistry(registryFile);
  const expected = new Map<string, string>();
  for (const asset of registry.assets) {
    for (const derivative of asset.derivatives) {
      expected.set(toPosix(derivative.file), derivative.sha256);
    }
  }

  const violations: Violation[] = [];
  for (const file of listFiles(projectRoot, generatedDir)) {
    if (GENERATED_EXEMPT.has(basename(file))) continue;
    const absolute = join(projectRoot, file);

    const registered = expected.get(file);
    if (registered !== undefined) {
      const digest = sha256Of(readFileSync(absolute));
      if (digest === registered) continue;
      violations.push({
        check: 'gerado',
        file,
        line: null,
        problem: `derivado registrado com \`sha256\` diferente do gravado pela ingestão — o arquivo foi editado depois de gerado (registro ${registered.slice(0, 12)}…, disco ${digest.slice(0, 12)}…).`,
        fix: 'desfaça a edição e conserte o **script** que produz o arquivo; depois rode `ingest-asset.ts` de novo. Correção feita no arquivo gerado some no próximo build, e o bug volta sem a pista de que já foi mexido.',
      });
      continue;
    }

    if (hasGeneratedMarker(absolute)) continue;
    violations.push({
      check: 'gerado',
      file,
      line: null,
      problem: 'arquivo em `src/generated/` sem procedência: não está registrado em `.forge-visual/assets.json` e não traz `@generated` no cabeçalho.',
      fix: 'se veio de um script, acrescente o cabeçalho `/* @generated por scripts/<nome>.ts — não edite à mão. comando: … */`; se foi escrito à mão, ele não pertence a `src/generated/` — mova para `src/lib/`, `src/content/` ou a pasta da seção.',
    });
  }

  return violations;
}

// ---------------------------------------------------------------------------------------
// 4. `src/engine/` — byte a byte contra o template do plugin
// ---------------------------------------------------------------------------------------

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface EngineResult {
  readonly violations: readonly Violation[];
  readonly note: Note | null;
  readonly compared: number;
}

function checkEngine(projectRoot: string, templateDir: string): EngineResult {
  const templateEngine = join(templateDir, 'src', 'engine');
  const siteEngine = join(projectRoot, 'src', 'engine');

  if (!existsSync(templateEngine)) {
    return {
      violations: [],
      note: { text: `template do motor não encontrado em ${templateEngine} — comparação pulada (passe --template=<dir>).` },
      compared: 0,
    };
  }
  if (!existsSync(siteEngine)) {
    return {
      violations: [
        {
          check: 'motor',
          file: 'src/engine/',
          line: null,
          problem: 'o site não tem `src/engine/` — ele não nasceu do template do plugin.',
          fix: 'copie o template inteiro (`cp -R "${CLAUDE_PLUGIN_ROOT}/templates/site/." ./<site>/`). Sem o motor, cada seção inventa o seu ticker e o seu clear.',
        },
      ],
      note: null,
      compared: 0,
    };
  }

  const violations: Violation[] = [];
  const templateFiles = listFiles(templateEngine, templateEngine);
  const siteFiles = new Set(listFiles(siteEngine, siteEngine));

  for (const file of templateFiles) {
    const relativeToSite = `src/engine/${file}`;
    if (!siteFiles.has(file)) {
      violations.push({
        check: 'motor',
        file: relativeToSite,
        line: null,
        problem: 'arquivo do motor apagado do site.',
        fix: `restaure a partir do template: \`cp "\${CLAUDE_PLUGIN_ROOT}/templates/site/src/engine/${file}" src/engine/${file}\`.`,
      });
      continue;
    }
    siteFiles.delete(file);
    const mine = sha256Of(readFileSync(join(siteEngine, file)));
    const theirs = sha256Of(readFileSync(join(templateEngine, file)));
    if (mine === theirs) continue;
    violations.push({
      check: 'motor',
      file: relativeToSite,
      line: null,
      problem: 'arquivo do motor alterado — `src/engine/` vem do template e não se edita.',
      fix: 'restaure o arquivo do template e resolva o problema dentro da sua seção. Um ajuste no motor atinge todas as seções ao mesmo tempo, que é o oposto de arquivos disjuntos — se o motor de fato não dá conta, isso é `pendencias` para o orquestrador, e a correção pertence ao template do plugin.',
    });
  }

  for (const extra of siteFiles) {
    if (!isCode(extra)) continue;
    violations.push({
      check: 'motor',
      file: `src/engine/${extra}`,
      line: null,
      problem: 'arquivo novo dentro de `src/engine/` — o motor é o do template, não um lugar para código de seção.',
      fix: 'mova para `src/sections/<nome>/` (se é da seção) ou `src/lib/` (se é utilitário puro compartilhado).',
    });
  }

  return { violations, note: null, compared: templateFiles.length };
}

// ---------------------------------------------------------------------------------------
// 5. `prefers-reduced-motion` — decisão de produto (§5.1), não escolha de quem escreve a seção
//
// A decisão está em `PLUGIN-SPEC.md` §5.1 e repetida em comentário no próprio template
// (`src/engine/tier.ts`, `src/styles/base.css`): os sites gerados ignoram a preferência e
// animam para todo mundo. Regra 8 de `regras-transversais.md` declarava isto "não verificável"
// — deixa de ser: qualquer `@media (prefers-reduced-motion...)` em CSS, ou leitura de
// `matchMedia` com `prefers-reduced-motion` em TypeScript/JavaScript, reprova. Comentário não
// conta — reusa o `tokenize()` da verificação 2, que já apaga comentário antes de procurar, e é
// como o próprio template (que cita a expressão em comentário, explicando como reverter) passa
// sem ser acusado da própria documentação.
// ---------------------------------------------------------------------------------------

/** `@media (prefers-reduced-motion...)` — CSS puro ou embutido num template string de estilo. */
const MEDIA_QUERY_PATTERN = /@media\s*\(\s*prefers-reduced-motion/i;

/** Leitura da preferência via `matchMedia`, em qualquer JavaScript/TypeScript do site. */
const MATCH_MEDIA_PATTERN = /matchMedia\s*\(\s*['"`][^'"`]*prefers-reduced-motion/i;

const REDUCED_MOTION_FIX =
  'a §5.1 da spec decide, por produto, que o site anima para todo mundo — nenhum código do site ' +
  'lê `prefers-reduced-motion`. Quem escreveu isto provavelmente estava sendo cuidadoso com ' +
  'acessibilidade, e o custo dessa decisão é real e assumido, não descuido. Se o dono quiser ' +
  'reverter, as três linhas que fazem isso estão documentadas em `src/engine/tier.ts`, na ' +
  'declaração de `reducedMotion` — não reintroduza a leitura aqui.';

function lineNumberAt(text: string, offset: number): number {
  let line = 1;
  for (let at = 0; at < offset && at < text.length; at += 1) if (text[at] === '\n') line += 1;
  return line;
}

function checkReducedMotion(projectRoot: string): Violation[] {
  const violations: Violation[] = [];
  const srcDir = join(projectRoot, 'src');

  for (const file of listFiles(projectRoot, srcDir)) {
    if (!isCode(file)) continue;
    const stripped = stripComments(readFileSync(join(projectRoot, file), 'utf8'));

    const media = MEDIA_QUERY_PATTERN.exec(stripped);
    if (media !== null) {
      violations.push({
        check: 'motion',
        file,
        line: lineNumberAt(stripped, media.index),
        problem:
          '`@media (prefers-reduced-motion...)` no código do site — a decisão de ignorar a preferência é de produto (§5.1), não escolha de quem escreveu esta seção.',
        fix: REDUCED_MOTION_FIX,
      });
    }

    const matchMedia = MATCH_MEDIA_PATTERN.exec(stripped);
    if (matchMedia !== null) {
      violations.push({
        check: 'motion',
        file,
        line: lineNumberAt(stripped, matchMedia.index),
        problem:
          '`matchMedia` lendo `prefers-reduced-motion` no código do site — o motor já decidiu (§5.1) que essa leitura não acontece em nenhuma seção.',
        fix: REDUCED_MOTION_FIX,
      });
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------------------
// Relatório
// ---------------------------------------------------------------------------------------

const CHECK_TITLES: Readonly<Record<Violation['check'], string>> = {
  lugar: 'cada arquivo na pasta do seu papel',
  texto: 'texto em `src/content/`, nunca no markup da seção',
  gerado: '`src/generated/` com procedência',
  motor: '`src/engine/` intocado',
  motion: '`prefers-reduced-motion` fora do código (decisão §5.1)',
};

function printCheck(check: Violation['check'], index: number, violations: readonly Violation[], okLine: string): void {
  console.info(`\n${index}. ${CHECK_TITLES[check]}`);
  const mine = violations.filter((violation) => violation.check === check);
  if (mine.length === 0) {
    console.info(`  ok — ${okLine}`);
    return;
  }
  for (const violation of mine) {
    const where = violation.line === null ? violation.file : `${violation.file}:${violation.line}`;
    console.info(`  ✗ ${where}`);
    console.info(`      ${violation.problem}`);
    console.info(`      → ${violation.fix}`);
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const target = resolveTarget(args);
  const structureConfig = section(target.config, 'structure');

  const srcDir = join(target.projectRoot, 'src');
  if (!existsSync(srcDir)) {
    console.error(
      `\nNADA VERIFICÁVEL: ${srcDir} não existe.\n` +
        '  Este portão lê a estrutura do site; sem `src/` não há o que conferir.',
    );
    process.exitCode = EXIT_NOTHING_TO_CHECK;
    return;
  }

  const sectionNames = listDirectories(join(srcDir, 'sections'));
  const registryFile = registryPath(target.projectRoot, argString(args, 'registry'));
  const templateDir = resolve(
    target.projectRoot,
    argString(args, 'template') ?? readString(structureConfig, 'template') ?? join(PLUGIN_ROOT, 'templates', 'site'),
  );
  const wantsEngine = argFlag(args, 'engine') ?? true;

  console.info(`\nestrutura do site — ${target.projectRoot}`);
  console.info(
    `  ${sectionNames.length} seção(ões) em src/sections/` +
      (sectionNames.length > 0 ? `: ${sectionNames.join(', ')}` : '') +
      `  ·  motor ${wantsEngine ? 'conferido' : 'não conferido (--no-engine)'}`,
  );

  const violations: Violation[] = [
    ...checkPlacement(target.projectRoot, sectionNames),
    ...checkHardcodedText(target.projectRoot),
    ...checkGenerated(target.projectRoot, registryFile),
    ...checkReducedMotion(target.projectRoot),
  ];

  const engine = wantsEngine
    ? checkEngine(target.projectRoot, templateDir)
    : { violations: [], note: null, compared: 0 };
  violations.push(...engine.violations);

  printCheck('lugar', 1, violations, 'nenhum arquivo fora da pasta do seu papel.');
  printCheck('texto', 2, violations, 'nenhuma frase visível escrita dentro de `src/sections/`.');
  printCheck('gerado', 3, violations, 'todo arquivo gerado declara de onde veio.');

  if (wantsEngine) {
    printCheck('motor', 4, violations, `${engine.compared} arquivo(s) idênticos ao template.`);
    if (engine.note !== null) console.info(`  nota: ${engine.note.text}`);
  } else {
    console.info('\n4. `src/engine/` intocado — não conferido (--no-engine).');
  }

  printCheck('motion', 5, violations, 'nenhuma leitura de `prefers-reduced-motion` no código do site — a decisão §5.1 segue de pé.');

  // As páginas de inspeção são informação, não portão: uma seção sem `dev/<nome>.html` continua
  // correta, só custa mais caro de diagnosticar quando quebrar.
  const missingDevPages = sectionNames.filter(
    (name) => !existsSync(join(target.projectRoot, 'dev', `${name}.html`)),
  );
  if (missingDevPages.length > 0) {
    console.info(
      `\nnota (não reprova): sem página de inspeção — ${missingDevPages.map((name) => `dev/${name}.html`).join(', ')}.` +
        '\n  Inspecionar uma técnica isolada é o que torna o diagnóstico barato; o molde é `dev/exemplo.*`.',
    );
  }

  const ok = violations.length === 0;

  if (target.printJson) {
    process.stdout.write(
      `${JSON.stringify(
        {
          structure: {
            ok,
            sections: sectionNames,
            engineChecked: wantsEngine,
            missingDevPages,
            violations,
          },
        },
        null,
        2,
      )}\n`,
    );
  }

  if (ok) {
    console.info('\nOK — a estrutura está de pé: seção é pasta, texto é conteúdo, gerado é gerado.');
    return;
  }

  const byCheck = new Map<Violation['check'], number>();
  for (const violation of violations) byCheck.set(violation.check, (byCheck.get(violation.check) ?? 0) + 1);

  console.error(
    `\nREPROVADO — ${violations.length} problema(s) de estrutura ` +
      `(${[...byCheck].map(([check, count]) => `${check}: ${count}`).join(' · ')}).\n\n` +
      '  Isto não é organização por gosto. A fase 4 constrói com três ou quatro devs ao mesmo\n' +
      '  tempo e a regra que os mantém vivos é *arquivos disjuntos*: dois devs no mesmo arquivo\n' +
      '  significa que o segundo sobrescreve o primeiro. Cada item acima é um lugar onde essa\n' +
      '  garantia deixou de valer — ou onde o texto e o código voltaram a ser a mesma coisa.\n' +
      '\n  Cada linha traz a ação a executar depois da seta.',
  );
  process.exitCode = EXIT_FAILED;
}

try {
  main();
} catch (cause: unknown) {
  console.error(`\nNÃO FOI POSSÍVEL VERIFICAR: ${cause instanceof Error ? cause.message : String(cause)}`);
  process.exitCode = EXIT_NOTHING_TO_CHECK;
}
