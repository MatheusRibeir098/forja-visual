import type { Section } from './types'

interface Site {
  title: string
  tagline: string
  description: string
  sections: readonly Section[]
  /** Critério de sucesso, nas palavras do dono do projeto. */
  sucesso: string
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
  year: 2026,
}
