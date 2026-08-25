import { medicao } from '@/content/medicao';
import { measurements } from '@/generated';
import { applyRow, buildMedicao } from './markup';
import { buildSheet, latestMeasuredAt } from './sheet';
import type { MedicaoMarkup } from './markup';
import type { RuntimeReading, SheetRow } from './sheet';
import type { Engine } from '@/engine';
import './style.css';

/**
 * F7 — A medição: a ficha que prova (ou desmente) os orçamentos da spec §6.
 *
 * Não desenha WebGL — é texto puro sobre o fundo opaco da própria seção (regra
 * "quem não desenha é opaco", `styles/base.css`). Duas fontes, nunca uma
 * terceira: `measurements.json` (import estático, gerado pelos scripts de
 * build) para o que só um `dist/` real sabe dizer, e o `engine` em execução
 * para o que só um navegador de verdade sabe dizer. Nenhum número deste
 * arquivo é digitado.
 */

/** Intervalo mínimo entre reaplicações da ficha — o FPS muda por quadro, a leitura não precisa. */
const REFRESH_INTERVAL_S = 1;

const measuredAtFormatter = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'long',
  timeStyle: 'short',
});

/**
 * O que a ficha lê do motor **agora**. `dpr` e `renderer` vêm do contexto GL
 * (já resolvidos pelo tier); `fps` é `null` sob `reducedMotion` — ali o
 * intervalo entre quadros não é um quadro, e uma mediana não mediria nada.
 */
function readRuntime(engine: Engine): RuntimeReading {
  const { gl, reducedMotion, ticker } = engine;
  return {
    tier: gl.tier,
    dpr: gl.size.dpr,
    renderer: gl.rendererName,
    reducedMotion,
    fps: reducedMotion ? null : ticker.fps,
  };
}

function formatFooter(latest: string | null): string {
  if (latest === null) return medicao.footer.unmeasured;
  const when = measuredAtFormatter.format(new Date(latest));
  return `${medicao.footer.label} · ${medicao.footer.measuredAt} ${when}`;
}

/** Reaplica cada linha; `applyRow` só escreve no DOM quando o texto mudou. */
function applyRows(rows: MedicaoMarkup['rows'], sheet: readonly SheetRow[]): void {
  for (const row of sheet) {
    const handle = rows.get(row.id);
    if (handle !== undefined) applyRow(handle, row);
  }
}

export function mountSection(root: HTMLElement, engine: Engine): void {
  const markup = buildMedicao(buildSheet(measurements, readRuntime(engine)));
  // `replaceChildren`, e não `append`: o `index.html` traz um `<h2>` de
  // rascunho para o `aria-labelledby` ter alvo antes do JS rodar; mantê-lo
  // daria dois títulos com o mesmo papel. O `<h2>` construído aqui herda o
  // mesmo id (`MEDICAO_TITLE_ID` = `medicao-title`).
  root.replaceChildren(...markup.nodes);
  markup.footer.textContent = formatFooter(latestMeasuredAt(measurements));

  let sinceRefresh = 0;
  // O ticker do engine é o único rAF da página (`engine/ticker.ts`) — a ficha
  // se inscreve nele em vez de abrir um loop próprio. Sob `reducedMotion` o
  // ticker está em `demand`: reagimos a cada quadro que alguém pediu, sem
  // jamais chamar `invalidate()` por conta própria.
  engine.ticker.subscribe((dt) => {
    if (engine.reducedMotion) {
      applyRows(markup.rows, buildSheet(measurements, readRuntime(engine)));
      return;
    }
    sinceRefresh += dt;
    if (sinceRefresh < REFRESH_INTERVAL_S) return;
    sinceRefresh = 0;
    applyRows(markup.rows, buildSheet(measurements, readRuntime(engine)));
  });
}
