/**
 * Texto da seção F7 — Medição.
 *
 * Só há texto aqui. **Nenhum número**: todo valor exibido nesta seção sai de
 * `src/generated/measurements.json` (escrito pelos scripts de medição sobre o
 * `dist/` e sobre um Chrome em GPU real) ou do motor em execução. Um número
 * digitado à mão neste arquivo seria exatamente a coisa que a seção existe
 * para desmentir.
 */

export interface MedicaoCopy {
  eyebrow: string;
  title: string;
  lead: string;
  /** Cabeçalhos da tabela, na ordem das colunas. */
  columns: { metric: string; measured: string; budget: string };
  caption: string;
  /** Rótulo de cada linha. As chaves são os ids de `buildSheet`. */
  rows: Record<string, string>;
  /** Nota curta ao lado de cada linha — o *como* da medida, não o valor. */
  notes: Record<string, string>;
  /** Texto de uma medida que nenhum script produziu ainda. */
  missing: string;
  missingNote: string;
  /** Rótulos de estado de uma linha, lidos por leitor de tela. */
  status: { ok: string; over: string };
  footer: {
    label: string;
    /** Antes da data da última medição. */
    measuredAt: string;
    unmeasured: string;
  };
}

export const medicao: MedicaoCopy = {
  eyebrow: 'P7 — o que dá para provar',
  title: 'Os números deste site',
  lead: 'Toda referência desta página foi entrada do projeto, não validação no fim. Os valores abaixo saem do dist/ recém-construído e do motor rodando agora, nesta aba — não de uma tabela escrita à mão.',
  columns: {
    metric: 'Métrica',
    measured: 'Medido',
    budget: 'Referência',
  },
  caption: 'Referências da spec §6 confrontadas com o medido — bytes informam, contraste e FPS reprovam.',
  rows: {
    critico: 'Caminho crítico',
    fontes: 'Fontes',
    lazy: 'Assets lazy',
    contraste: 'Contraste mínimo',
    fps: 'FPS mediano',
    tier: 'Tier ativo',
    renderer: 'Renderizador',
  },
  notes: {
    critico: 'HTML, CSS e JS baixados antes do primeiro paint, somados em gzip.',
    fontes: 'Dois woff2 com subset latino, pré-carregados.',
    lazy: 'Depth map do relevo e os binários da nuvem de pontos, pedidos só quando a seção se aproxima.',
    contraste: 'WCAG medido por pixel no screenshot, e não pelo par de tokens de cor.',
    fps: 'Mediana do ticker nos últimos 60 quadros — este número muda enquanto você rola.',
    tier: 'Escolhido pela GPU: muda dpr, escala de FBO e passos do ray march. Nunca troca de cena.',
    renderer: 'Lido em WEBGL_debug_renderer_info. Medir em renderizador de software mentiria o FPS.',
  },
  missing: 'não medido',
  missingNote: 'Nenhum script produziu este valor ainda: rode pnpm build && pnpm measure.',
  status: { ok: 'dentro do critério', over: 'fora do critério' },
  footer: {
    label: 'Última medição',
    measuredAt: 'medido em',
    unmeasured: 'sem medição registrada',
  },
};

/** Nota extra quando o frameloop está sob demanda (`prefers-reduced-motion`). */
export const REDUCED_MOTION_FPS_NOTE =
  'Movimento reduzido: o frameloop está sob demanda, um quadro por gesto. Uma mediana de quadros aqui não mediria nada.';
