/**
 * Texto próprio da seção F5 — o índice das 16 técnicas. As técnicas em si estão
 * em `tecnicas.ts`; aqui fica só o que emoldura a lista.
 */

export interface CatalogoColumns {
  id: string;
  technique: string;
  problem: string;
  rating: string;
}

export interface CatalogoCopy {
  title: string;
  lead: string;
  /** Cabeçalho das colunas do índice, visível em telas largas. */
  columns: CatalogoColumns;
  /**
   * Prefixo do rótulo acessível da nota. Vira "Peso no catálogo: 3 de 3" —
   * as estrelas são desenho, e leitor de tela não lê desenho.
   */
  ratingLabel: string;
  /** Glifo da estrela cheia e da vazia. Sempre 3 posições, para a coluna alinhar. */
  ratingFull: string;
  ratingEmpty: string;
  /** Observação de margem: como ler as estrelas. */
  note: string;
  /** Fecho da seção, sob o último fio. */
  footnote: string;
}

export const catalogo: CatalogoCopy = {
  title: 'O catálogo',
  lead: 'Dezesseis técnicas, não dezesseis componentes: só entrou o que explica um mecanismo e se transfere para outro projeto. Cada verbete traz o problema que a técnica resolve.',
  columns: {
    id: 'Ref.',
    technique: 'Técnica',
    problem: 'Problema que resolve',
    rating: 'Peso',
  },
  ratingLabel: 'Peso no catálogo',
  ratingFull: '★',
  ratingEmpty: '·',
  note: 'Três estrelas é a técnica que muda a arquitetura de um projeto inteiro. Uma é truque local: útil, limitado, e sem consequência sobre o resto.',
  footnote:
    'Os planos atrás de cada linha são WebGL sincronizado ao HTML em 1 px = 1 unidade. O texto nunca sai do documento — continua selecionável, focável e legível por leitor de tela.',
};
