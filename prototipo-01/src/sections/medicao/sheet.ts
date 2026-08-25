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
 * Referências e pisos da spec §6. Vivem aqui **e** em
 * `scripts/measure-bundle.ts`. Os três valores em KB deixaram de reprovar o
 * build — são investimento deliberado de bytes em qualidade (relevo em alta
 * resolução, nuvem de pontos densa) e ficam como **referência informativa**.
 * `contrast` e `fps` continuam sendo critério de verdade: `enforced: true` em
 * `buildSheet` é o que os mantém reprovando.
 */
export const BUDGETS = {
  /** KB gzip do HTML + CSS + JS baixados antes do primeiro paint. Referência, não reprova. */
  criticalKb: 300,
  /** KB gzip dos woff2 com subset. Referência, não reprova. */
  fontsKb: 80,
  /** KB gzip do que é pedido depois do primeiro paint (depth map, nuvem). Referência, não reprova. */
  lazyKb: 600,
  /** WCAG por pixel, piso para todo texto de conteúdo. Critério de verdade — reprova. */
  contrast: 7,
  /** Mediana de quadros por segundo em GPU real. Critério de verdade — reprova. */
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
  /** Referência/piso formatado, ou `null` quando a linha não tem um. */
  readonly budget: string | null;
  /** Ocupação da referência, 0–1, para a régua. `null` = linha sem régua. */
  readonly load: number | null;
  /**
   * `null` quando a linha não reprova nada: sem referência (tier,
   * renderizador) **ou** referência informativa em bytes, hoje suspensa de
   * reprovação. Só `contraste` e `fps` produzem `true`/`false` aqui.
   */
  readonly ok: boolean | null;
  /**
   * Rótulo de ocupação (ex. `"340%"`) quando o medido passa da referência
   * **e** a linha não reprova por isso — a régua sozinha não daria conta de
   * comunicar 340% sem parecer erro. `null` na maior parte das linhas.
   */
  readonly overLabel: string | null;
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
const percent = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  maximumFractionDigits: 0,
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

/** Razão crua medido/referência (`ceiling`) ou referência/medido (`floor`), sem cap em 1. */
function budgetRatio(measured: number, budget: number, kind: BudgetKind): number {
  if (budget <= 0) return 0;
  return kind === 'ceiling' ? measured / budget : budget / measured;
}

/**
 * Ocupação da régua, sempre 0–1: a barra não estoura o track mesmo quando o
 * medido passa muito da referência (`overLabel` é quem carrega o "quanto").
 */
export function budgetLoad(measured: number, budget: number, kind: BudgetKind): number {
  return clamp01(budgetRatio(measured, budget, kind));
}

function meetsBudget(measured: number, budget: number, kind: BudgetKind): boolean {
  return kind === 'ceiling' ? measured <= budget : measured >= budget;
}

interface BudgetRowInput {
  id: string;
  measured: number | null;
  budget: number;
  kind: BudgetKind;
  /**
   * `true`: linha reprova de verdade (contraste, fps) — `ok` carrega
   * verdadeiro/falso. `false`: linha é referência informativa (bytes) —
   * `ok` fica sempre `null`, e passar da referência vira `overLabel`, não
   * reprovação.
   */
  enforced: boolean;
  format: (value: number) => string;
  note?: string;
}

function budgetRow(input: BudgetRowInput): SheetRow {
  const { id, measured, budget, kind, enforced, format } = input;
  const label = medicao.rows[id] ?? id;
  const note = input.note ?? medicao.notes[id] ?? '';
  if (measured === null) {
    return {
      id,
      label,
      value: null,
      budget: format(budget),
      load: null,
      ok: null,
      overLabel: null,
      note,
    };
  }
  const ratio = budgetRatio(measured, budget, kind);
  const over = !enforced && ratio > 1;
  return {
    id,
    label,
    value: format(measured),
    budget: format(budget),
    load: clamp01(ratio),
    ok: enforced ? meetsBudget(measured, budget, kind) : null,
    overLabel: over ? percent.format(ratio) : null,
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
    overLabel: null,
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
      enforced: false,
      format: formatKb,
    }),
    budgetRow({
      id: 'fontes',
      measured: bundle?.fontsKb ?? null,
      budget: BUDGETS.fontsKb,
      kind: 'ceiling',
      enforced: false,
      format: formatKb,
    }),
    budgetRow({
      id: 'lazy',
      measured: bundle?.lazyKb ?? null,
      budget: BUDGETS.lazyKb,
      kind: 'ceiling',
      enforced: false,
      format: formatKb,
    }),
    budgetRow({
      id: 'contraste',
      measured: contrast?.minContrast ?? null,
      budget: BUDGETS.contrast,
      kind: 'floor',
      enforced: true,
      format: formatContrast,
    }),
    budgetRow({
      id: 'fps',
      measured: runtime.fps,
      budget: BUDGETS.fps,
      kind: 'floor',
      enforced: true,
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
