/**
 * Tipos do conteúdo do site. Todo texto exibido vive em `src/content/*` e é
 * tipado aqui — nenhuma seção guarda string hardcoded.
 */

/** Camada do catálogo de técnicas — corresponde às Partes I–V do documento. */
export type Layer = 'infra' | 'mundos' | 'transicoes' | 'imagem' | 'nossas'

/** Quantas estrelas a técnica recebeu no catálogo (⭐ a ⭐⭐⭐). */
export type Stars = 1 | 2 | 3

export interface Technique {
  /** Identificador do catálogo, no formato `I.1`, `V.5`. */
  id: string
  layer: Layer
  stars: Stars
  title: string
  /** Uma linha, no máximo 140 caracteres. */
  problem: string
  /** Duas a três frases explicando como a técnica funciona. */
  mechanism: string
  /** Em que situação a técnica não se paga. */
  whenNot: string
  /** URL do artigo de origem ou caminho do arquivo no portfólio. */
  source?: string
}

/** Um dos cinco fatores que explicam por que o portfolio-3d escapou da média. */
export interface Factor {
  n: 1 | 2 | 3 | 4 | 5
  title: string
  /** Duas a três frases. */
  why: string
}

export type PrincipleId = 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6' | 'P7'

export interface Principle {
  id: PrincipleId
  title: string
  body: string
}

/** Regra transversal do catálogo (Parte VI). */
export interface Rule {
  n: number
  text: string
}

export interface Quote {
  text: string
  author: string
  url: string
}

export interface RoadmapItem {
  text: string
  done: boolean
  /** Item já começado, mas ainda não concluído. */
  inProgress?: boolean
}

export interface RoadmapPhase {
  title: string
  items: readonly RoadmapItem[]
}

/** Âncora de navegação — `id` casa com o `id` da seção no DOM. */
export interface Section {
  id: string
  label: string
}
