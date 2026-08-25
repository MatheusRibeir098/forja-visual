import { formatSectionMark, medicao, site } from '@/content';
import type { SheetRow } from './sheet';

/**
 * O DOM de F7. **Texto de verdade, sempre** — nada aqui pode ser pintado no
 * canvas: a seção que publica o contraste medido seria a primeira a falhar a
 * própria medição se os números morassem em pixels de WebGL.
 *
 * A ficha é uma `<table>` porque é uma tabela: três colunas fixas (métrica,
 * medido, teto) e uma linha por orçamento. Um `<div>` com `role="table"` daria
 * o mesmo desenho com menos semântica de graça.
 */

/** Id que o `aria-labelledby` da `<section id="medicao">` referencia. */
export const MEDICAO_TITLE_ID = 'medicao-title';

/** Peças de uma linha que mudam depois de montadas (o FPS muda por quadro). */
export interface RowHandle {
  readonly row: HTMLElement;
  readonly value: HTMLElement;
  readonly rule: HTMLElement;
  readonly status: HTMLElement;
  /** Rótulo de ocupação (ex. "340%") para referências informativas passadas do ponto. */
  readonly over: HTMLElement;
}

export interface MedicaoMarkup {
  readonly nodes: readonly HTMLElement[];
  readonly rows: ReadonlyMap<string, RowHandle>;
  readonly footer: HTMLElement;
}

function element<K extends keyof HTMLElementTagNameMap>(
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
 * Escreve na linha o que a ficha diz. É o **único** lugar que escreve: a linha
 * é montada por aqui e atualizada por aqui, então o estado exibido não pode
 * divergir entre o primeiro quadro e o milésimo.
 */
export function applyRow(handle: RowHandle, data: SheetRow): void {
  const measured = data.value ?? medicao.missing;
  if (handle.value.textContent !== measured) handle.value.textContent = measured;

  handle.row.dataset['measured'] = data.value === null ? 'missing' : 'ok';
  if (data.ok === null) {
    delete handle.row.dataset['ok'];
    handle.status.textContent = '';
  } else {
    handle.row.dataset['ok'] = String(data.ok);
    handle.status.textContent = data.ok ? medicao.status.ok : medicao.status.over;
  }

  // A régua é a mesma informação do número, em forma de barra. Sem medida ela
  // some — uma barra vazia leria como "zero", que é uma afirmação diferente.
  handle.rule.hidden = data.load === null;
  if (data.load !== null) handle.rule.style.setProperty('--me-load', data.load.toFixed(3));

  // Referência informativa passada do ponto (ex. bytes de lazy a 340% do
  // valor de referência): a régua sozinha satura em 100%, então o rótulo em
  // texto carrega o "quanto" — sem soar como reprovação (essa linha não tem
  // `data-ok`, então não herda a listra de falha).
  if (data.overLabel === null) {
    delete handle.row.dataset['reference'];
    handle.over.hidden = true;
  } else {
    handle.row.dataset['reference'] = 'over';
    handle.over.hidden = false;
    handle.over.textContent = data.overLabel;
  }
}

function buildHead(): HTMLElement {
  const head = element('header', 'me__head');
  const index = site.sections.findIndex((section) => section.id === 'medicao');
  const kicker = element('p', 'me__kicker t-mono');
  kicker.append(
    element('span', 'me__kicker-n', formatSectionMark(index)),
    element('span', 'me__kicker-label', medicao.eyebrow),
  );

  const title = element('h2', 'me__title t-title', medicao.title);
  title.id = MEDICAO_TITLE_ID;

  head.append(kicker, title, element('p', 'me__lead', medicao.lead));
  return head;
}

function buildHeaderRow(): HTMLElement {
  const row = element('tr', 'me__header-row');
  const { metric, measured, budget } = medicao.columns;
  for (const [label, className] of [
    [metric, 'me__col-metric'],
    [measured, 'me__col-measured'],
    [budget, 'me__col-budget'],
  ] as const) {
    const cell = element('th', `me__col ${className}`, label);
    cell.scope = 'col';
    row.append(cell);
  }
  return row;
}

function buildRow(data: SheetRow): RowHandle {
  const row = element('tr', 'me__row');
  row.dataset['row'] = data.id;

  // `metric`/`measuredCell` são `<th>`/`<td>` de verdade — o layout de grid
  // interno (rótulo sobre nota, valor sobre régua) vive num `<div>` filho, não
  // na célula. Aplicar `display: grid` direto na célula tira o box do fluxo
  // de tabela (o computed `display` deixa de ser `table-cell`), e foi isso
  // que desalinhou a ficha: cada célula empilhava como bloco solto em vez de
  // ocupar sua coluna.
  const metric = element('th', 'me__metric');
  metric.scope = 'row';
  const status = element('span', 'me__sr');
  const metricInner = element('div', 'me__metric-inner');
  metricInner.append(
    element('span', 'me__label', data.label),
    element('span', 'me__note', data.note),
    status,
  );
  metric.append(metricInner);

  const measuredCell = element('td', 'me__measured');
  const value = element('span', 'me__value t-mono');
  const rule = element('span', 'me__rule');
  rule.setAttribute('aria-hidden', 'true');
  const over = element('span', 'me__over t-mono');
  const measuredInner = element('div', 'me__measured-inner');
  measuredInner.append(value, rule, over);
  measuredCell.append(measuredInner);

  const budgetCell = element('td', 'me__budget t-mono', data.budget ?? '');
  row.append(metric, measuredCell, budgetCell);

  const handle: RowHandle = { row, value, rule, status, over };
  applyRow(handle, data);
  return handle;
}

function buildSheetTable(sheet: readonly SheetRow[]): {
  table: HTMLElement;
  rows: Map<string, RowHandle>;
} {
  const table = element('table', 'me__sheet');
  table.append(element('caption', 'me__caption', medicao.caption));

  const thead = element('thead', 'me__thead');
  thead.append(buildHeaderRow());

  const tbody = element('tbody', 'me__tbody');
  const rows = new Map<string, RowHandle>();
  for (const data of sheet) {
    const handle = buildRow(data);
    rows.set(data.id, handle);
    tbody.append(handle.row);
  }

  table.append(thead, tbody);
  return { table, rows };
}

export function buildMedicao(sheet: readonly SheetRow[]): MedicaoMarkup {
  const { table, rows } = buildSheetTable(sheet);
  const footer = element('p', 'me__footer t-mono');
  return { nodes: [buildHead(), table, footer], rows, footer };
}
