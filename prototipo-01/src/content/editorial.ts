/**
 * Mobília editorial — as convenções de revista que mais de uma seção usa:
 * numeração de capítulo, rótulo da coluna marginal, identificação da edição.
 *
 * Vive aqui, e não na seção que a exibe, porque é **texto exibido**: a regra do
 * projeto é que nenhuma seção guarde string de conteúdo. O hero da variante C
 * nasceu com estas strings cravadas em `variants/c/markup.ts`; ao serem
 * reaproveitadas pelo catálogo (F5) elas viraram conteúdo de verdade.
 */

export interface Editorial {
  /** Sinal que abre a numeração de capítulo — `§ 05`. */
  sectionSign: string;
  /** Rótulo da coluna marginal, onde vive a observação lateral. */
  noteLabel: string;
  /** Identificação da edição, no formato de uma revista. */
  issueLabel: string;
  issueDate: string;
  /** Substantivo contado ao lado de `tecnicas.length`. */
  techniquesNoun: string;
}

export const editorial: Editorial = {
  sectionSign: '§',
  noteLabel: 'Nota de margem',
  issueLabel: 'Protótipo 01',
  issueDate: 'agosto de 2026',
  techniquesNoun: 'técnicas',
};

/** Dois dígitos: a numeração de capítulo é `§ 05`, nunca `§ 5`. */
const MARK_DIGITS = 2;

/**
 * `§ 05` a partir do índice 0-based da seção no documento — o mesmo índice de
 * `site.sections`, para que a numeração impressa nunca discorde da ordem real.
 */
export function formatSectionMark(index: number): string {
  return `${editorial.sectionSign} ${String(index + 1).padStart(MARK_DIGITS, '0')}`;
}
