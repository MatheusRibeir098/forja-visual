import type { Section } from './types'

interface Site {
  title: string
  tagline: string
  description: string
  sections: readonly Section[]
  /** Critério de sucesso, nas palavras do dono do projeto. */
  sucesso: string
  /**
   * Mensagem que revela a brincadeira do hero, mostrada uma única vez logo
   * depois que a limalha termina de comer a caricatura de "site médio gerado
   * por IA". `headline` é a linha de impacto; `body` é a explicação, em corpo
   * menor.
   */
  heroReveal: {
    headline: string
    body: string
  }
  year: number
}

export const site: Site = {
  title: 'Forja Visual',
  tagline: 'A média de todos os sites é o site menos distinto possível.',
  description:
    'Forja Visual — pesquisa sobre por que sites gerados por IA convergem para a mesma média, e o que é preciso para escapar dela: processo, restrição medida e um catálogo de técnicas, nunca de componentes.',
  sections: [
    { id: 'hero', label: 'Início' },
    { id: 'tese', label: 'A tese' },
    { id: 'referencia', label: 'A referência' },
    { id: 'campo', label: 'O campo' },
    { id: 'relevo', label: 'Relevo' },
    { id: 'catalogo', label: 'Catálogo' },
    { id: 'principios', label: 'Princípios' },
    { id: 'medicao', label: 'Medição' },
  ],
  sucesso: 'Um site gerado pela ferramenta tem que passar por trabalho de um estúdio, não por template.',
  heroReveal: {
    headline: 'Por meio segundo, você achou que era mais um.',
    body: 'O gradiente roxo, os cards de vidro, os dois botões — é assim que quase todo site gerado por IA se parece hoje. Não por incapacidade da máquina: ela entrega a média de tudo que viu, e a média é, por definição, a opção menos distintiva. Daqui pra baixo é o oposto disso.',
  },
  year: 2026,
}
