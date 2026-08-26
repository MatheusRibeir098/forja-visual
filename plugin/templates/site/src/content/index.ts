/**
 * Texto que **não pertence a nenhuma seção**: título e descrição do site,
 * navegação, rodapé e o colofão de créditos.
 *
 * Isto não é um barrel. `src/content/index.ts` de propósito **não** re-exporta
 * `content/<nome>.ts`: um barrel obrigaria todos os `visual-dev` da fase 4 a
 * editar o mesmo arquivo, e arquivos disjuntos é a regra que mantém três ou
 * quatro deles vivos em paralelo. Cada seção importa `@/content/<nome>` direto.
 *
 * O colofão mora aqui, e não dentro de uma seção, porque **crédito de licença
 * não pode morrer no corte de uma seção** — é exatamente isso que o portão
 * `check-attribution.ts` cobra: o `<a>` do crédito precisa existir fora de toda
 * `<section>`/`<article>`.
 */

/** Uma linha do colofão. `href === null` é texto sem link (aviso, ano, autoria). */
export interface CreditLine {
  readonly text: string;
  readonly href: string | null;
}

export interface SiteCopy {
  /** Mesmo texto do `<title>` e do `<h1>` principal, quando houver os dois. */
  readonly title: string;
  /** Mesmo texto da `<meta name="description">`. */
  readonly description: string;
  /**
   * Créditos de licença e autoria, renderizados **fora** de qualquer seção.
   * Cada `attribution` não-nulo do `brief.assets` tem que aparecer aqui, com o
   * `href` apontando para a `attributionUrl` registrada.
   */
  readonly colophon: readonly CreditLine[];
}

export const site: SiteCopy = {
  title: 'PLACEHOLDER — título do site',
  description: 'PLACEHOLDER — descrição do site, uma frase.',
  colophon: [],
};
