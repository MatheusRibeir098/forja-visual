import type { Quote } from './types'

interface Tese {
  title: string
  paragraphs: readonly string[]
  quote: Quote
  corollary: {
    title: string
    body: string
  }
}

export const tese: Tese = {
  title: 'O problema não é falta de biblioteca',
  paragraphs: [
    'A leitura óbvia seria que sites gerados por IA são feios porque faltam bibliotecas boas. É falso. As bibliotecas estão todas aí, maduras, e em 2026 quase todas gratuitas — o GSAP inteiro, com os plugins que antes custavam assinatura, virou grátis em abril de 2025.',
    'A causa real é mecânica. Um modelo que prevê o token mais provável segue o caminho de menor resistência, e esse caminho desemboca sempre no mesmo lugar: hero centralizado, gradiente, grid de três colunas, Inter, um scroll reveal.',
    'Isso não é falta de capacidade — é o comportamento esperado do sistema. A média de tudo o que ele viu é, por construção, a opção menos distintiva disponível.',
    'Por isso uma ferramenta que seja "catálogo de efeitos + agente que escolhe" reproduz o problema com passos extras. Esse é o desenho a evitar, e é exatamente para onde tudo tende sozinho.',
  ],
  quote: {
    text: 'AI predicts the most likely design, and the most likely design is the average of everything it trained on. It’s not copying any one site but averaging all of them, and the average is by definition the least distinctive option available.',
    author: 'Shuffle',
    url: 'https://shuffle.dev/blog/2026/01/why-do-most-ai-generated-websites-look-the-same/',
  },
  corollary: {
    title: 'Bibliotecas de componentes são a fonte, não a cura',
    body: 'React Bits, Aceternity UI, Magic UI: são excelentes, são gratuitas, e são exatamente o que um agente alcança primeiro. Um Aurora Background é reconhecível à primeira vista porque está em dez mil sites. Usá-las como estão é acelerar a corrida em direção à média — elas servem como base para adaptar (paleta, timing, comportamento), nunca como entrega.',
  },
}
