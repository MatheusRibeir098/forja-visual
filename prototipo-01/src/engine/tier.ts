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
  /** Passos do ray march do relight (IV.1). Custo é linear neste número. */
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
    // 0 = só as normais do depth, sem sombra projetada — o que a spec §3 F4 pede
    // para `low`. Não vira caminho de código: o `uSamples` chega no mesmo
    // shader, que sai do laço na primeira linha (`if (uSamples <= 0)`), e o
    // relevo continua reagindo à luz porque quem faz isso é a normal, não a
    // marcha. Em GPU de software cada fetch do laço é CPU pura: eram 12 fetches
    // extras por pixel para uma sombra de 29 px que ninguém compara lado a lado.
    rayMarchSamples: 0,
    // Metade da resolução nos FBOs — o quad final reescala e o softness da
    // máscara esconde a interpolação.
    fboScale: 0.5,
    // Medido em `measure-fps.ts`: `low` tem 15x menos pixels que `high` mas
    // gasta *mais* tempo de GPU (10,54 ms vs 14,21 ms) — o gargalo lá é
    // overhead de geometria/draw call, não fill rate. Um bloom cujo custo
    // escala com pixels não ataca esse gargalo, só soma trabalho a uma GPU
    // já no limite. `low` fica só com o grade barato (curva+vinheta+grão+
    // dither), que não escala com o problema real do tier.
    bloomLevels: 0,
  },
  mid: {
    // 1.5 é o meio-termo em telas de celular: nítido o bastante, ~2.2x menos
    // pixels que dpr 2.
    dpr: 1.5,
    // 4 passos varrem os 0.06 unidades de campo de alcance a cada 0.015 (≈11 px
    // na chapa de 720 px do asset): a sombra mais longa, de ≈29 px, ainda recebe
    // 2–3 amostras e a direção continua legível. É o piso que a spec §3 F4 fixa
    // para `mid`, e o que cabe no orçamento de fetch em celular a dpr 1.5.
    rayMarchSamples: 4,
    fboScale: 0.75,
    // Bloom inline ligado (ver a nota do módulo em `grade.ts`): um único
    // passe, 8 taps, sem `setRenderTarget` extra — cabe no orçamento de
    // `mid` sem o risco de cauda que a antiga cadeia de mips tinha.
    bloomLevels: 1,
  },
  high: {
    // Teto em 2 mesmo em telas 3x: acima de 2 o ganho visual não paga o custo
    // quadrático (é o mesmo teto que a maioria dos motores adota).
    dpr: 2,
    // 8 passos. Medido no relevo FORJA (variante B, run de 2026-08-24): a sombra
    // mais longa que este campo de altura consegue projetar é
    // `profundidade / tan(elevação)` = (0.35 × 0.05) / tan(24°) ≈ 0.04 unidades
    // de campo, ou ≈29 px sobre a chapa de 720 px. A marcha varre 0.06, então 8
    // passos amostram a cada 0.0075 (≈5 px) — a mesma ordem da penumbra de
    // 0.006 (≈4.3 px), que é o que impede a escada na borda. Acima disso os
    // passos reamostram o mesmo platô e só custam fetch, e é fetch que decide o
    // FPS a dpr 2: os 48 daqui eram 6× o custo do laço pela mesma imagem.
    rayMarchSamples: 8,
    fboScale: 1,
    // Religado em 2026-08-25 após diagnóstico correto da cauda de p5.
    // O bloom (inline, `grade.ts`, zero `setRenderTarget` extra) nunca foi a
    // causa da instabilidade: com bloom OFF a cauda persiste idêntica (p5
    // 30,0 / 30,1 / 30,0 em 3 execuções) e com bloom ON a mediana de GPU
    // fica em 11,2–11,3 ms / p95 14,8–16,5 ms — bem dentro do teto de
    // 16,67 ms de um quadro a 60 fps. A GPU cabe nos dois casos; quem some
    // é o vsync do navegador. Esta máquina de medição roda o Chrome de
    // teste ao lado do desktop do dono, com Spotify a ~49% de CPU (processo
    // de GPU próprio) e um Chrome pessoal com ~30 processos disputando a
    // mesma GPU integrada — é contenção de ambiente compartilhado, não
    // custo do nosso quadro. Métrica correta pra decidir orçamento de GPU é
    // a MEDIANA (reflete o nosso frame), não o p5 (reflete quem mais está
    // rodando na máquina nesse instante). Não desligue o bloom de novo por
    // causa do p5 sem medir a mediana de GPU primeiro.
    bloomLevels: 1,
  },
};

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
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
