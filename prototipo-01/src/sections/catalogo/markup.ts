import { catalogo, editorial, formatSectionMark, layerLabels, site, tecnicas } from '@/content';
import { RATING_MAX, formatRating } from './focus';
import type { Layer, Technique } from '@/content';

/**
 * O índice impresso das 16 técnicas, montado em DOM real.
 *
 * A linguagem é a da variante C — mancha editorial, numeração de capítulo, fio
 * fino, coluna marginal —, mas o conteúdo é o catálogo. Nenhuma string de
 * conteúdo nasce aqui: tudo vem de `@/content`, inclusive o mobiliário
 * (`editorial.ts`). O que o WebGL faz com estes nós está em `planes.ts`; este
 * arquivo não sabe que existe um canvas.
 */

/** Casa com `aria-labelledby` do `<section id="catalogo">` em `index.html`. */
export const CATALOG_TITLE_ID = 'catalogo-title';

/** Id da seção no documento — também a chave em `site.sections`. */
const SECTION_ID = 'catalogo';

/** Dois dígitos na contagem por camada: `04`, e não `4`, como numeração de sumário. */
const COUNT_DIGITS = 2;

export interface CatalogMarkup {
  /** Nós na ordem em que entram no root da seção. */
  nodes: readonly HTMLElement[];
  /**
   * Os verbetes, na ordem do documento. Cada um recebe um plano WebGL atrás —
   * é a lista que `planes.ts` rastreia.
   */
  entries: readonly HTMLElement[];
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

/**
 * Texto que só existe para leitor de tela. A alternativa — `aria-label` num
 * parágrafo — não é exposta de forma confiável: `aria-label` em elemento de
 * papel genérico é ignorado por parte dos leitores.
 */
function screenReaderOnly(text: string): HTMLElement {
  return el('span', 'cat__sr', text);
}

function sectionIndex(): number {
  const index = site.sections.findIndex((section) => section.id === SECTION_ID);
  // -1 nunca deve acontecer, mas `formatSectionMark(-1)` imprimiria `§ 00` em
  // silêncio; melhor cair no primeiro capítulo do que publicar numeração falsa.
  return index < 0 ? 0 : index;
}

function buildMasthead(): HTMLElement {
  const masthead = el('div', 'cat__masthead');
  const index = sectionIndex();
  const section = site.sections[index];
  const runningHead =
    section === undefined
      ? formatSectionMark(index)
      : `${formatSectionMark(index)} — ${section.label}`;
  masthead.append(
    el('p', 't-label cat__mark', runningHead),
    el('p', 't-label cat__folio', `${tecnicas.length} ${editorial.techniquesNoun}`),
  );
  return masthead;
}

function buildHead(): HTMLElement {
  const head = el('div', 'cat__head');

  const title = el('h2', 't-title cat__title', catalogo.title);
  title.id = CATALOG_TITLE_ID;

  const note = el('aside', 'cat__note');
  note.append(
    el('p', 't-label', editorial.noteLabel),
    el('p', 'cat__note-text', catalogo.note),
  );

  head.append(title, el('p', 'cat__lead', catalogo.lead), note);
  return head;
}

/**
 * Legenda das colunas. `aria-hidden` porque é orientação **visual**: cada
 * verbete já se explica sozinho na leitura linear (referência, título, problema
 * e o rótulo textual do peso), e repetir "Ref., Técnica, Problema, Peso" a cada
 * 16 entradas só atrapalha quem ouve.
 */
function buildColumnLegend(): HTMLElement {
  const legend = el('div', 'cat__legend');
  legend.setAttribute('aria-hidden', 'true');
  const { columns } = catalogo;
  legend.append(
    el('span', 'cat__legend-id', columns.id),
    el('span', 'cat__legend-name', columns.technique),
    el('span', 'cat__legend-problem', columns.problem),
    el('span', 'cat__legend-rating', columns.rating),
  );
  return legend;
}

function buildEntry(technique: Technique): { item: HTMLElement; entry: HTMLElement } {
  const item = el('li', 'cat__item');
  const entry = el('article', 'cat__entry');

  const rating = el('p', 'cat__rating');
  const glyphs = el(
    'span',
    'cat__glyphs',
    formatRating(technique.stars, catalogo.ratingFull, catalogo.ratingEmpty),
  );
  glyphs.setAttribute('aria-hidden', 'true');
  rating.append(
    glyphs,
    screenReaderOnly(`${catalogo.ratingLabel}: ${technique.stars} de ${RATING_MAX}`),
  );

  entry.append(
    el('p', 't-mono cat__id', technique.id),
    el('h4', 'cat__name', technique.title),
    el('p', 'cat__problem', technique.problem),
    rating,
  );
  item.append(entry);
  return { item, entry };
}

/** Camadas na ordem em que aparecem no catálogo — nenhuma lista fixa em código. */
function layersInOrder(): readonly Layer[] {
  const seen: Layer[] = [];
  for (const technique of tecnicas) {
    if (!seen.includes(technique.layer)) seen.push(technique.layer);
  }
  return seen;
}

function buildGroup(layer: Layer, entries: HTMLElement[]): HTMLElement {
  const group = el('section', 'cat__group');
  const inLayer = tecnicas.filter((technique) => technique.layer === layer);

  const heading = el('h3', 't-label cat__layer');
  heading.append(
    el('span', 'cat__layer-name', layerLabels[layer]),
    el('span', 'cat__layer-count', String(inLayer.length).padStart(COUNT_DIGITS, '0')),
  );

  const list = el('ol', 'cat__rows');
  list.setAttribute('role', 'list');
  for (const technique of inLayer) {
    const { item, entry } = buildEntry(technique);
    entries.push(entry);
    list.append(item);
  }

  group.append(heading, list);
  return group;
}

export function buildCatalog(): CatalogMarkup {
  const entries: HTMLElement[] = [];
  const index = el('div', 'cat__index');
  index.append(buildColumnLegend());
  for (const layer of layersInOrder()) index.append(buildGroup(layer, entries));

  return {
    nodes: [
      buildMasthead(),
      el('hr', 'cat__rule'),
      buildHead(),
      index,
      el('hr', 'cat__rule'),
      el('p', 'cat__footnote', catalogo.footnote),
    ],
    entries,
  };
}
