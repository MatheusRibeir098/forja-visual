/**
 * MOLDE — o texto da seção `exemplo`, e o formato que todo `content/<nome>.ts`
 * segue: um `interface` com a forma da cópia e uma `const` com os valores.
 *
 * Copie este arquivo junto com `src/sections/exemplo/`, renomeie os dois para o
 * nome da sua seção e apague o exemplo. Nada importa daqui além da própria
 * seção, então remover os dois não quebra nada.
 *
 * A forma é livre: cada seção declara os campos que a sua imagem precisa. O que
 * não é livre é o lugar — texto visível vive aqui, nunca no markup.
 */

export interface ExemploCopy {
  /** Linha curta acima do título; some no mobile se atrapalhar. */
  readonly eyebrow: string;
  readonly title: string;
  readonly paragraphs: readonly string[];
  /** Texto alternativo/rótulos também são conteúdo: literal nenhum no markup. */
  readonly figureLabel: string;
}

export const exemplo: ExemploCopy = {
  eyebrow: 'MOLDE',
  title: 'Esta seção é um molde',
  paragraphs: [
    'Copie a pasta src/sections/exemplo/ e este arquivo, renomeie os dois e apague o exemplo.',
    'O texto que você está lendo vem de src/content/exemplo.ts — nenhuma frase está escrita no markup.',
  ],
  figureLabel: 'faixa que reage ao progresso de rolagem da seção',
};
