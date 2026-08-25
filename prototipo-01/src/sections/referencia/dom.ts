import { fatores, formatSectionMark, site } from '@/content';
import { needleAt } from './needle';

/**
 * Construção do DOM de F3. Separado do comportamento porque `index.ts` só trata
 * de scroll (beats + damping); quem lê a coreografia não precisa atravessar
 * cinquenta linhas de `createElement`.
 *
 * Aqui é `createElement`, e não string de HTML, porque cada bloco precisa
 * devolver a **referência do elemento** — é ela que vira a âncora do beat (V.2).
 */

/** Um fator com os dois nós que a coreografia escreve por quadro. */
export interface FactorBlock {
  el: HTMLElement;
  /** Fio que cresce com o beat do próprio bloco. */
  rule: HTMLElement;
  /** Último `--rf-p` escrito, para não repetir `setProperty` no mesmo valor. */
  applied: number;
}

export interface ReferenceDom {
  blocks: FactorBlock[];
  /** Trilha do indicador: recebe `--rf-needle` e `--rf-target`. */
  rail: HTMLElement;
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function buildHeader(root: HTMLElement): HTMLElement {
  const index = site.sections.findIndex((section) => section.id === root.id);
  if (index < 0) {
    throw new Error(`sections/referencia: id "${root.id}" não existe em content/site.ts`);
  }
  const label = site.sections[index]?.label ?? '';

  const header = createElement('header', 'rf-head');
  const kicker = createElement('p', 'rf-kicker t-mono');
  // Duas caixas em vez de uma string montada: o fio que separa a numeração do
  // rótulo é desenho, e desenho mora no CSS. A numeração vem de
  // `formatSectionMark` para não discordar do "§ 05" impresso nas outras seções.
  kicker.append(
    createElement('span', 'rf-kicker-n', formatSectionMark(index)),
    createElement('span', 'rf-kicker-label', label),
  );

  const title = createElement('h2', 'rf-title t-title', label);
  // `index.html` aponta `aria-labelledby` para este id; ao trocar o conteúdo da
  // seção, o título novo tem de herdá-lo, senão a seção perde o nome acessível.
  if (root.id !== '') title.id = `${root.id}-title`;

  header.append(kicker, title);
  return header;
}

/** Trilha do indicador: marcadores fixos, agulha amortecida e o alvo dela. */
function buildRail(count: number): HTMLElement {
  const rail = createElement('div', 'rf-rail');
  // Duplica visualmente a ordem da lista ao lado; para a leitura de tela é ruído.
  rail.setAttribute('aria-hidden', 'true');

  for (let index = 0; index < count; index += 1) {
    const mark = createElement('span', 'rf-mark', String(index + 1));
    mark.style.setProperty('--rf-at', needleAt(index, count).toFixed(4));
    rail.append(mark);
  }
  rail.append(createElement('span', 'rf-ghost'), createElement('span', 'rf-needle'));
  return rail;
}

function buildBlock(factor: (typeof fatores)[number]): FactorBlock {
  const el = createElement('li', 'rf-block');
  const ordinal = createElement('p', 'rf-ordinal', String(factor.n));
  const title = createElement('h3', 'rf-block-title t-subheading', factor.title);
  const rule = createElement('div', 'rf-rule');
  const why = createElement('p', 'rf-why t-body', factor.why);

  el.append(ordinal, title, rule, why);
  return { el, rule, applied: -1 };
}

export function buildReferenceDom(root: HTMLElement): ReferenceDom {
  const list = createElement('ol', 'rf-list');
  list.setAttribute('role', 'list');
  const blocks = fatores.map(buildBlock);
  for (const block of blocks) list.append(block.el);

  const aside = createElement('div', 'rf-aside');
  const rail = buildRail(blocks.length);
  aside.append(rail);

  const body = createElement('div', 'rf-body');
  body.append(aside, list);

  const container = createElement('div', 'rf-root');
  container.append(buildHeader(root), body);
  // Troca o conteúdo estático de `index.html` de uma vez: dois reflows a menos
  // que remover e inserir em passos separados.
  root.replaceChildren(container);

  return { blocks, rail };
}
