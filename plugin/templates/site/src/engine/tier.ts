/**
 * Tier de qualidade.
 *
 * Regra dura do projeto: **tier só muda números, nunca caminho de código.** Se
 * `low` desligasse um efeito, teríamos dois sites para depurar e um deles
 * (o que ninguém testa) quebraria em silêncio. Aqui todo tier roda o mesmo
 * shader e o mesmo grafo — com resolução, dpr e contagem de amostras menores.
 */

export type Tier = 'low' | 'mid' | 'high';

export interface TierSettings {
  /** Teto do `devicePixelRatio` usado no renderer. */
  dpr: number;
  /** Passos de um ray march (catálogo IV.1), para a cena que tiver um. Custo linear. */
  rayMarchSamples: number;
  /** Escala dos render targets em relação à viewport, 0.5–1. */
  fboScale: number;
  /**
   * Portão do bloom do passe de grade (`engine/frame.ts`/`shaders/grade.ts`).
   * 0 desliga; >0 liga. Deixou de ser contagem de níveis de mip-chain — o
   * bloom agora é inline (taps largos direto no FBO de página, sem
   * `setRenderTarget` extra; ver a nota em `grade.ts`) — mas continua um
   * número lido em tempo de execução (`uBloomEnabled`), não um `if` de
   * arquitetura: mesmo shader de grade em todo tier.
   */
  bloomLevels: number;
}

export const TIER_SETTINGS: Record<Tier, TierSettings> = {
  low: {
    // dpr 1: em GPU de software cada pixel extra é CPU pura; 2x dpr = 4x custo.
    dpr: 1,
    // 0 = sem marcha nenhuma. Não vira caminho de código: `uSamples` chega no
    // mesmo shader, que sai do laço na primeira linha (`if (uSamples <= 0)`).
    // Em GPU de software cada fetch do laço é CPU pura, e o que o efeito
    // perde aqui (uma sombra projetada curta) ninguém compara lado a lado.
    rayMarchSamples: 0,
    // Metade da resolução nos FBOs — o quad final reescala, e o softness das
    // máscaras esconde a interpolação.
    fboScale: 0.5,
    // Medido: `low` costuma ter muito menos pixels que `high` e ainda assim
    // gastar **mais** tempo de GPU, porque o gargalo lá é overhead de
    // geometria/draw call, não fill rate. Um bloom cujo custo escala com
    // pixels não ataca esse gargalo, só soma trabalho a uma GPU no limite.
    // `low` fica com o grade barato (curva + vinheta + grão + dither).
    bloomLevels: 0,
  },
  mid: {
    // 1.5 é o meio-termo em telas de celular: nítido o bastante, ~2.2x menos
    // pixels que dpr 2.
    dpr: 1.5,
    // 4 passos mantêm a direção da sombra legível num campo de altura raso.
    // Piso recomendado para `mid`; é o que cabe no orçamento de fetch de um
    // celular a dpr 1.5.
    rayMarchSamples: 4,
    fboScale: 0.75,
    // Bloom inline ligado (ver a nota do módulo em `shaders/grade.ts`): um
    // único passe, 8 taps, sem `setRenderTarget` extra.
    bloomLevels: 1,
  },
  high: {
    // Teto em 2 mesmo em telas 3x: acima de 2 o ganho visual não paga o custo
    // quadrático (é o mesmo teto que a maioria dos motores adota).
    dpr: 2,
    // 8 passos. Regra para calibrar num campo de altura: a sombra mais longa
    // que ele projeta é `profundidade / tan(elevação)`; escolha o número de
    // passos que amostre esse alcance na mesma ordem de grandeza da penumbra.
    // Acima disso os passos reamostram o mesmo platô e só custam fetch — e é
    // fetch que decide o fps a dpr 2.
    rayMarchSamples: 8,
    fboScale: 1,
    bloomLevels: 1,
  },
};

/*
 * Lição de medição que veio junto com estes números, e que economiza um dia:
 * para decidir orçamento de GPU olhe a **mediana** do tempo de GPU por quadro
 * (é o custo do *seu* quadro), não o p5 de fps. O p5 despenca quando outra
 * coisa disputa a GPU da máquina de medição (outro navegador aberto, player de
 * vídeo) e leva a desligar efeitos que cabiam folgados. Teto de um quadro a
 * 60 fps: 16,67 ms.
 */

export interface TierReport {
  tier: Tier;
  /** String crua do driver — o `measure-fps.ts` aborta se contiver SwiftShader. */
  renderer: string;
  reducedMotion: boolean;
}

/**
 * Renderizadores por software. Não é sobre serem lentos: é que o custo por
 * pixel é ordens de grandeza maior, então só `low` sobrevive.
 */
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|basic render|mesa offscreen/i;

/**
 * Menor lado da viewport, em px CSS, abaixo do qual uma tela densa é tratada
 * como celular. 900 fica acima de qualquer celular em retrato e abaixo de um
 * laptop em paisagem.
 */
const SMALL_VIEWPORT_PX = 900;

/** Acima deste dpr, o custo por pixel real já dobrou frente ao dpr 2. */
const DENSE_DISPLAY_DPR = 2;

function readRendererName(gl: WebGL2RenderingContext): string {
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  if (debugInfo !== null) {
    const unmasked: unknown = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
    if (typeof unmasked === 'string' && unmasked.length > 0) return unmasked;
  }
  // Fallback: navegadores com anti-fingerprinting mascaram o unmasked e alguns
  // já nem expõem a extensão. `RENDERER` sempre existe, mesmo que genérico.
  const masked: unknown = gl.getParameter(gl.RENDERER);
  return typeof masked === 'string' && masked.length > 0 ? masked : 'unknown';
}

export function detectTier(gl: WebGL2RenderingContext): TierReport {
  const renderer = readRendererName(gl);
  // ── MOVIMENTO REDUZIDO: IGNORADO, DE PROPÓSITO ────────────────────────────
  //
  // Isto **não é um esquecimento**. É decisão de produto do dono, tomada em
  // 26/08/2026 e registrada na §5.1 da spec do plugin: os sites gerados animam
  // em qualquer máquina, como a maioria da web faz.
  //
  // O que a motivou: num Windows com "Efeitos de animação" desligado nas
  // configurações de acessibilidade, um site gerado aparecia parado e o scroll
  // andava em degraus — um quadro por evento (`engine/index.ts`, modo
  // `demand`). Como quase nenhum outro site respeita a preferência, o nosso era
  // o único que parava, e a usuária leu isso como "site travado".
  //
  // ⚠️ O CUSTO, ESCRITO PORQUE É REAL: quem desliga animações por distúrbio
  // vestibular — enjoo, vertigem, enxaqueca com movimento na tela — vê tudo se
  // mexendo aqui, e não tem como pedir que pare. Foi escolha consciente, com o
  // custo conhecido. Pela mesma razão o site **não** pode ser anunciado como
  // "WCAG 2.2 AA" sem a ressalva de que o critério 2.3.3 não é atendido.
  //
  // PARA REVERTER, três pontos — e são só estes três:
  //   1. esta linha  ->  window.matchMedia('(prefers-reduced-motion: reduce)').matches
  //   2. src/styles/base.css -> reponha o `@media (prefers-reduced-motion: no-preference)`
  //      em volta do `scroll-behavior: smooth`
  //   3. o CSS das suas seções -> qualquer animação declarativa volta a nascer
  //      dentro de um `@media (prefers-reduced-motion: no-preference)`
  //
  // O resto do motor já obedece a este valor sozinho (o ticker volta a `demand`
  // em `engine/index.ts`, o grão do passe de grade congela em `main.ts`): não
  // há um quarto ponto escondido.
  const reducedMotion = false;

  if (SOFTWARE_RENDERER.test(renderer)) {
    return { tier: 'low', renderer, reducedMotion };
  }

  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const smallDenseScreen =
    window.devicePixelRatio > DENSE_DISPLAY_DPR &&
    Math.min(window.innerWidth, window.innerHeight) < SMALL_VIEWPORT_PX;

  if (coarsePointer || smallDenseScreen) {
    return { tier: 'mid', renderer, reducedMotion };
  }

  return { tier: 'high', renderer, reducedMotion };
}
