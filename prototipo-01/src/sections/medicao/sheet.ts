import { medicao, REDUCED_MOTION_FPS_NOTE } from '@/content/medicao';
import type { Measurements } from '@/generated';

/**
 * A ficha de medição como **dados** — sem DOM, sem three, sem WebGL.
 *
 * Está separada porque é a parte que erra em silêncio: um teto trocado por um
 * piso inverte o sinal de "passou", e uma medida ausente vira `NaN` na régua
 * sem nenhum sintoma visível. Aqui dá para testar (`sheet.test.ts`).
 */

/**
 * Tetos e pisos da spec §6. Vivem aqui **e** em `scripts/measure-bundle.ts`:
 * um é o que a página promete ao leitor, o outro é o que reprova o build. Se
 * divergirem, o build reprova antes de a página poder mentir.
 */
export const BUDGETS = {
  /** KB gzip do HTML + CSS + JS baixados antes do primeiro paint. */
  criticalKb: 300,
  /** KB gzip dos woff2 com subset. */
  fontsKb: 80,
  /** KB gzip do que é pedido depois do primeiro paint (depth map, nuvem). */
  lazyKb: 600,
  /** WCAG por pixel, piso para todo texto de conteúdo. */
  contrast: 7,
  /** Mediana de quadros por segundo em GPU real. */
  fps: 60,
} as const;

/**
 * `ceiling`: medido tem que ficar **abaixo**. `floor`: tem que ficar **acima**.
 * Sem esta distinção a régua de contraste encheria ao reprovar.
 */
export type BudgetKind = 'ceiling' | 'floor';

export interface SheetRow {
  readonly id: string;
  readonly label: string;
  /** Valor já formatado para leitura, ou `null` quando nenhum script o produziu. */
  readonly value: string | null;
  /** Teto/piso formatado, ou `null` quando a linha não é um orçamento. */
  readonly budget: string | null;
  /** Ocupação do orçamento, 0–1, para a régua. `null` = linha sem régua. */
  readonly load: number | null;
  /** `null` quando não há orçamento a cumprir (tier, renderizador). */
  readonly ok: boolean | null;
  readonly note: string;
}

/** O que a seção lê do motor em execução — nada disso vive num arquivo. */
export interface RuntimeReading {
  readonly tier: string;
  /** `devicePixelRatio` efetivo, já limitado pelo tier. */
  readonly dpr: number;
  /** String crua do driver (`WEBGL_debug_renderer_info`). */
  readonly renderer: string;
  readonly reducedMotion: boolean;
  /** Mediana do ticker. `null` sob demanda: ali o intervalo não é um quadro. */
  readonly fps: number | null;
}

const decimal = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const precise = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatKb(value: number): string {
  return `${precise.format(value)} KB`;
}

export function formatFps(value: number): string {
  return `${decimal.format(value)} fps`;
}

export function formatContrast(value: number): string {
  return `${decimal.format(value)}:1`;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Ocupação da régua. No teto é o quanto do orçamento foi gasto; no piso, o
 * quanto do mínimo já foi alcançado — nos dois casos "cheio" quer dizer "no
 * limite", que é o que a régua precisa comunicar sem uma legenda.
 */
export function budgetLoad(measured: number, budget: number, kind: BudgetKind): number {
  if (budget <= 0) return 0;
  return clamp01(kind === 'ceiling' ? measured / budget : budget / measured);
}

function meetsBudget(measured: number, budget: number, kind: BudgetKind): boolean {
  return kind === 'ceiling' ? measured <= budget : measured >= budget;
}

interface BudgetRowInput {
  id: string;
  measured: number | null;
  budget: number;
  kind: BudgetKind;
  format: (value: number) => string;
  note?: string;
}

function budgetRow(input: BudgetRowInput): SheetRow {
  const { id, measured, budget, kind, format } = input;
  const label = medicao.rows[id] ?? id;
  const note = input.note ?? medicao.notes[id] ?? '';
  if (measured === null) {
    return { id, label, value: null, budget: format(budget), load: null, ok: null, note };
  }
  return {
    id,
    label,
    value: format(measured),
    budget: format(budget),
    load: budgetLoad(measured, budget, kind),
    ok: meetsBudget(measured, budget, kind),
    note,
  };
}

function plainRow(id: string, value: string): SheetRow {
  return {
    id,
    label: medicao.rows[id] ?? id,
    value,
    budget: null,
    load: null,
    ok: null,
    note: medicao.notes[id] ?? '',
  };
}

/**
 * A ficha inteira, na ordem em que é lida: primeiro o que foi prometido em
 * bytes, depois o que só um navegador de verdade sabe dizer.
 */
export function buildSheet(data: Measurements, runtime: RuntimeReading): SheetRow[] {
  const { bundle, contrast } = data;
  return [
    budgetRow({
      id: 'critico',
      measured: bundle?.criticalKb ?? null,
      budget: BUDGETS.criticalKb,
      kind: 'ceiling',
      format: formatKb,
    }),
    budgetRow({
      id: 'fontes',
      measured: bundle?.fontsKb ?? null,
      budget: BUDGETS.fontsKb,
      kind: 'ceiling',
      format: formatKb,
    }),
    budgetRow({
      id: 'lazy',
      measured: bundle?.lazyKb ?? null,
      budget: BUDGETS.lazyKb,
      kind: 'ceiling',
      format: formatKb,
    }),
    budgetRow({
      id: 'contraste',
      measured: contrast?.minContrast ?? null,
      budget: BUDGETS.contrast,
      kind: 'floor',
      format: formatContrast,
    }),
    budgetRow({
      id: 'fps',
      measured: runtime.fps,
      budget: BUDGETS.fps,
      kind: 'floor',
      format: formatFps,
      note: runtime.reducedMotion ? REDUCED_MOTION_FPS_NOTE : medicao.notes['fps'],
    }),
    plainRow('tier', `${runtime.tier} · dpr ${decimal.format(runtime.dpr)}`),
    plainRow('renderer', runtime.renderer),
  ];
}

/**
 * Data da medição mais recente entre as que existem, em ISO. `null` quando
 * nenhum script rodou — e aí a seção diz isso, em vez de inventar uma data.
 */
export function latestMeasuredAt(data: Measurements): string | null {
  const stamps = [data.bundle?.measuredAt, data.contrast?.measuredAt, data.fps?.measuredAt].filter(
    (stamp): stamp is string => typeof stamp === 'string',
  );
  if (stamps.length === 0) return null;
  return stamps.reduce((latest, stamp) => (stamp > latest ? stamp : latest));
}
