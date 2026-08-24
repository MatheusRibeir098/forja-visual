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
}

export const TIER_SETTINGS: Record<Tier, TierSettings> = {
  low: {
    // dpr 1: em GPU de software cada pixel extra é CPU pura; 2x dpr = 4x custo.
    dpr: 1,
    // 12 passos ainda resolvem a sombra do relevo; abaixo disso a borda serrilha.
    rayMarchSamples: 12,
    // Metade da resolução nos FBOs — o quad final reescala e o softness da
    // máscara esconde a interpolação.
    fboScale: 0.5,
  },
  mid: {
    // 1.5 é o meio-termo em telas de celular: nítido o bastante, ~2.2x menos
    // pixels que dpr 2.
    dpr: 1.5,
    rayMarchSamples: 24,
    fboScale: 0.75,
  },
  high: {
    // Teto em 2 mesmo em telas 3x: acima de 2 o ganho visual não paga o custo
    // quadrático (é o mesmo teto que a maioria dos motores adota).
    dpr: 2,
    // 48 passos: onde a sombra do relevo para de mudar visivelmente ao dobrar.
    rayMarchSamples: 48,
    fboScale: 1,
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
