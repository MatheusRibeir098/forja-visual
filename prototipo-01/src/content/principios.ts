import type { Principle, Rule } from './types'

/** Os sete princípios que o desenho da ferramenta tem que respeitar. */
export const principios: readonly Principle[] = [
  {
    id: 'P1',
    title: 'Conceito antes de código',
    body: 'Nada é gerado antes de existir um conceito visual específico e defensável. A extração de requisitos já é um problema resolvido; falta extrair imagem. Um conceito ruim não é salvo por efeito nenhum.',
  },
  {
    id: 'P2',
    title: 'Restrição como entrada, não validação no fim',
    body: 'Orçamentos numéricos — KB no caminho crítico, FPS alvo, razão de contraste, densidade — são entrada obrigatória, declarados antes de gerar. Validar depois só reprova; restringir antes força criatividade.',
  },
  {
    id: 'P3',
    title: 'Divergência forçada, com o dono matando as opções',
    body: 'Em vez de entregar uma opção plausível, gerar variantes deliberadamente divergentes e fazer o dono rejeitar. É a mecanização do quinto fator. Uma opção plausível é a média; três opções brigando entre si não são.',
  },
  {
    id: 'P4',
    title: 'Catálogo de técnicas, nunca de componentes',
    body: '"Depth prepass para dar volume a nuvem de pontos aditiva" é conhecimento transferível: explica o mecanismo e se aplica a problemas que ainda não apareceram. "Card com gradiente" não é. O modelo é o Codrops: técnica, porquê e código.',
  },
  {
    id: 'P5',
    title: 'Nativo primeiro',
    body: 'CSS scroll-driven animations, com mais de 90% de suporte, e View Transitions API antes de qualquer biblioteca. Menos bundle, menos dependência — e um sinal real de não-IA, porque uma IA importa GSAP por reflexo.',
  },
  {
    id: 'P6',
    title: 'Medição obrigatória no fim',
    body: 'Nada é aprovado sem número, e o número tem que ser honesto. A lição do FPS falso em SwiftShader é que medir errado é pior do que não medir.',
  },
  {
    id: 'P7',
    title: 'Comentário como ativo',
    body: 'Toda constante mágica carrega a medição que a justifica. O portfólio provou o custo do contrário: um comentário afirmando que as camadas eram "depth-less" sobreviveu a uma mudança que o tornou falso, e uma decisão de densidade foi tomada em cima dele.',
  },
]

/** As nove regras transversais do catálogo — candidatas a validador executável. */
export const regras: readonly Rule[] = [
  {
    n: 1,
    text: 'Progresso normalizado de 0 a 1 como moeda comum. Scroll, hover, áudio e tempo viram 0–1 e cada camada deriva sua faixa. Fontes concorrentes se combinam com Math.max(), não com caminhos paralelos.',
  },
  {
    n: 2,
    text: 'Um ticker, um estado. Múltiplos requestAnimationFrame são a causa raiz do judder inexplicável.',
  },
  {
    n: 3,
    text: 'Meça uma vez por frame, antes de escrever. getBoundingClientRect() em lote, nunca intercalado com transforms.',
  },
  {
    n: 4,
    text: 'Pré-processe o que não muda: contorno no Blender, ruído como textura, quantização no build. Runtime é para o que responde ao usuário.',
  },
  {
    n: 5,
    text: 'Textura em vez de procedural quando o olho não distingue. Ruído seamless amostrado bate Perlin calculado por fragment.',
  },
  {
    n: 6,
    text: 'Escale por dispositivo com um número, não com um caminho de código: setDrawRange, contagem de instâncias, densidade — nunca uma cena alternativa.',
  },
  {
    n: 7,
    text: 'Não monte o que está desligado. Um composer de efeitos aloca render targets só por existir; gatear por flag interna não economiza nada.',
  },
  {
    n: 8,
    text: 'prefers-reduced-motion desde a arquitetura. Não é um if no fim — muda o frameloop, os callbacks assinados e o tier de qualidade.',
  },
  {
    n: 9,
    text: 'Toda constante mágica precisa de um comentário com a medição. Foi medido? Com qual método? Sem isso, ninguém mexe com segurança depois.',
  },
]
