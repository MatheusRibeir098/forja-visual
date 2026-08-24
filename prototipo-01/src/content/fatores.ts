import type { Factor } from './types'

/**
 * Os cinco fatores que explicam por que o `portfolio-3d` escapou da média.
 * Nenhum deles é um efeito: todos são processo.
 */
export const fatores: readonly Factor[] = [
  {
    n: 1,
    title: 'Uma ideia específica, não um estilo',
    why: '"Cérebro em nuvem de pontos cercado por uma constelação de agentes" é uma decisão de conteúdo — diz algo sobre quem é o dono do site. "Site moderno com animações" é um prompt de média. A ideia específica é o que nenhuma quantidade de efeito compensa depois.',
  },
  {
    n: 2,
    title: 'Restrições numéricas medidas',
    why: 'Orçamento de luz somada impresso a cada vista, contraste medido por pixel (pior caso 9,59:1), FPS em GPU real — 60,3, depois de descobrir que os 27,2 anteriores eram falsos porque o Chrome headless caía em SwiftShader. Restrição dura força solução não-óbvia; sem restrição, o gerador produz o que é fácil.',
  },
  {
    n: 3,
    title: 'Um problema técnico real, resolvido de verdade',
    why: 'O depth prepass não sai de tutorial nenhum. Nasceu de um feedback específico — "o cérebro está irreconhecível" — e da investigação da causa: sprites aditivos sem depthWrite não se ocluem, o fundo somava através da frente e o meio da silhueta virava a região mais clara do quadro. A solução é original porque o problema era real.',
  },
  {
    n: 4,
    title: 'Asset próprio',
    why: 'Um .obj de 20 MB processado por um pipeline escrito para ele: normais por Newell, curvatura, downsample por voxel, shuffle determinístico, quantização Int16 normalizada. Não é um preset.',
  },
  {
    n: 5,
    title: 'Rejeição iterada',
    why: 'Fogo, depois poliedro facetado, depois nuvem de pontos. Cards viraram linhas. Cada rejeição do dono empurrou o resultado para longe da média. É provavelmente o fator mais importante — e o mais difícil de automatizar.',
  },
]
