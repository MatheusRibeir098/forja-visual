import { site, tecnicas } from '@/content';
import { measurements } from '@/generated';

/**
 * A página impressa da variante C, montada em DOM real.
 *
 * Todo texto de conteúdo vem de `@/content` e de `@/generated` — nada de string
 * de conteúdo dentro do canvas, e nenhum número inventado no colofão. As poucas
 * constantes daqui são *mobiliário editorial* (numeração, rótulo da nota,
 * data da edição): se a variante sobreviver à divergência, elas viram conteúdo.
 */

export const HERO_TITLE_ID = 'hero-title';

/** O hero é a primeira seção do documento — daí o `§ 01`. */
const SECTION_INDEX = 0;

/** Identificação da edição, no formato de uma revista. */
const ISSUE_LABEL = 'Protótipo 01';
const ISSUE_DATE = 'agosto de 2026';

const NOTE_LABEL = 'Nota de margem';

/** Casas decimais do peso no colofão: o script mede com duas. */
const KB_DECIMALS = 2;

export interface HeroMarkup {
  /** Nós na ordem em que entram no root. */
  nodes: readonly HTMLElement[];
  /** Blocos que recebem plano de tinta atrás. */
  title: HTMLElement;
  tagline: HTMLElement;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** `§ 01` — dois dígitos, como numeração de capítulo. */
function sectionMark(index: number): string {
  return `§ ${String(index + 1).padStart(2, '0')}`;
}

function formatKb(kb: number): string {
  return kb.toLocaleString('pt-BR', {
    minimumFractionDigits: KB_DECIMALS,
    maximumFractionDigits: KB_DECIMALS,
  });
}

/** Colofão: só números que algum script mediu (P6). O peso some se não houver medida. */
function colophonItems(): string[] {
  const items = [ISSUE_LABEL, ISSUE_DATE, `${tecnicas.length} técnicas`];
  const bundle = measurements.bundle;
  if (bundle !== null) items.push(`${formatKb(bundle.criticalKb)} KB no caminho crítico`);
  return items;
}

function buildMasthead(): HTMLElement {
  const masthead = el('div', 'hero-c__masthead');
  const section = site.sections[SECTION_INDEX];
  const runningHead =
    section === undefined
      ? sectionMark(SECTION_INDEX)
      : `${sectionMark(SECTION_INDEX)} — ${section.label}`;
  masthead.append(
    el('p', 'hero-c__label hero-c__mark', runningHead),
    el('p', 'hero-c__label hero-c__folio', String(site.year)),
  );
  return masthead;
}

function buildNote(): HTMLElement {
  const note = el('aside', 'hero-c__note');
  note.append(
    el('p', 'hero-c__label', NOTE_LABEL),
    el('p', 'hero-c__note-text', site.sucesso),
  );
  return note;
}

function buildColophon(): HTMLElement {
  const list = el('ul', 'hero-c__colophon');
  list.setAttribute('role', 'list');
  for (const item of colophonItems()) list.append(el('li', '', item));
  return list;
}

export function buildHero(): HeroMarkup {
  const title = el('h1', 'hero-c__title', site.title);
  title.id = HERO_TITLE_ID;

  const tagline = el('p', 'hero-c__tagline', site.tagline);

  const gutter = el('div', 'hero-c__gutter');
  gutter.setAttribute('aria-hidden', 'true');

  const body = el('div', 'hero-c__body');
  body.append(gutter, title, buildNote(), tagline);

  return {
    nodes: [
      buildMasthead(),
      el('hr', 'hero-c__rule'),
      body,
      el('hr', 'hero-c__rule'),
      buildColophon(),
    ],
    title,
    tagline,
  };
}
