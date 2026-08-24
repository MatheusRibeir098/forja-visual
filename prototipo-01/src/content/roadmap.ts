import type { RoadmapPhase } from './types'

/** Ordem inegociável: provar antes de generalizar. */
export const roadmap: readonly RoadmapPhase[] = [
  {
    title: 'Agora — coleta',
    items: [
      { text: 'Panorama de ferramentas', done: true },
      { text: 'Catálogo v1 com 16 técnicas e mecanismo', done: true },
      { text: 'Backlog de varredura, prioridade alta', done: false },
      { text: 'Varrer fora do Codrops: Three.js Resources, awesome-threejs, Shadertoy, Unicorn Studio', done: false },
    ],
  },
  {
    title: 'Depois — provar',
    items: [
      { text: 'Aplicar 2–3 técnicas do catálogo num protótipo real', done: false, inProgress: true },
      { text: 'Destilar as 9 regras transversais num validador executável', done: false },
    ],
  },
  {
    title: 'Depois — construir',
    items: [
      { text: 'Skill visual-concept (fases 1–2)', done: false },
      { text: 'Skill visual-techniques (fase 3)', done: false },
      { text: 'Testar num projeto de verdade, do zero', done: false },
      { text: 'Só então avaliar MCP', done: false },
    ],
  },
]
