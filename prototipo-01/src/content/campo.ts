/**
 * Texto da seção "Campo" (técnica V.1) e o **crédito do modelo 3D**.
 *
 * O crédito não é decoração: o crânio é licenciado em CC BY 4.0, e essa licença
 * exige atribuição **no produto**, não num comentário de código. Por isso ele
 * vive aqui, com o resto do texto exibido, e é renderizado no colofão da seção
 * como HTML de verdade — nunca dentro do `<canvas>`.
 *
 * Os números de `figures` são medidos, não estimados: saem da execução de
 * `scripts/build-points.ts`, que os imprime ao gerar os binários. Se o asset
 * for regenerado com outro alvo de pontos, é aqui que eles mudam.
 */

/** Atribuição de um asset de terceiro. */
export interface AssetCredit {
  /** Nome da obra como o autor a publicou. */
  title: string;
  author: string;
  /** Nome curto da licença, como o usuário a reconhece. */
  license: string;
  licenseUrl: string;
  /** Página de origem do arquivo. */
  sourceUrl: string;
}

/** Um número medido exibido ao lado do objeto. */
export interface Figure {
  value: string;
  label: string;
}

export interface CampoCopy {
  /** Rótulo curto acima do título — identifica a técnica, não a seção. */
  eyebrow: string;
  title: string;
  lead: string;
  body: readonly string[];
  figures: readonly Figure[];
  /** Instrução de uso. Curta: o gesto tem que ser óbvio antes de ser lido. */
  hint: string;
  /** Texto que abre o colofão, antes do crédito. */
  colophon: string;
  credit: AssetCredit;
  /** Descrição do objeto para quem não vê o canvas. */
  canvasAlt: string;
}

export const campo: CampoCopy = {
  eyebrow: 'V.1 — depth prepass',
  title: 'O que a nuvem esconde de si mesma',
  lead: 'Doze mil pontos aditivos, e mais da metade nunca chega à tela. Quem decide é uma malha invisível do mesmo crânio, desenhada um instante antes.',
  body: [
    'Sprite aditivo com escrita de profundidade desligada não oclui outro sprite. Numa nuvem densa, o lado de trás soma através do da frente e o meio da silhueta — que deveria ser a parte mais legível do objeto — vira a região mais clara e menos estruturada do quadro.',
    'A correção não é atenuar o fundo. Atenuar só escurece: os pontos continuam todos sendo desenhados, e o custo permanece inteiro. A correção é desenhar antes uma versão decimada do crânio que não escreve cor nenhuma e escreve só profundidade. O teste de profundidade normal da nuvem faz o resto.',
    'O casco pede dois cuidados. Face dupla, porque a orientação da decimação é consistente mas de direção desconhecida — com descarte de face traseira, um modelo invertido não ocluiria nada. E encolhimento de 4% do raio pelas próprias normais, senão ele engole as órbitas e a arcada que deveria revelar.',
    'O que sobra é orçamento. A luz que os pontos ocultos gastavam volta para os visíveis, e a mesma soma de brilho passa a desenhar uma superfície em vez de uma névoa.',
  ],
  figures: [
    { value: '12.000', label: 'pontos no arquivo' },
    { value: '52,8%', label: 'descartados pelo prepass' },
    { value: '+1', label: 'draw call, zero fill' },
    { value: '196 KB', label: 'os dois binários, gzip' },
  ],
  hint: 'Role para girar. O cursor abre a nuvem.',
  colophon: 'Modelo:',
  credit: {
    title: '3D-Schädel eines Menschen',
    author: 'martinjario',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:3D-Sch%C3%A4del_eines_Menschen.stl',
  },
  canvasAlt:
    'Um crânio humano desenhado como nuvem de pontos luminosos, girando conforme a página rola.',
};
