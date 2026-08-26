import { createBeats } from './beats';
import { createComposite } from './composite';
import { createGL } from './gl';
import { createPointer } from './pointer';
import { createTicker } from './ticker';
import type { Beats } from './beats';
import type { Composite } from './composite';
import type { GL } from './gl';
import type { Pointer } from './pointer';
import type { Ticker } from './ticker';

/**
 * O motor inteiro num objeto só.
 *
 * Cada módulo abaixo é independente e testável isolado; o que este arquivo faz
 * é decidir **como eles se ligam**, e essa decisão precisa existir num lugar só.
 * Se cada seção montasse suas peças, teríamos vários tickers, vários pointers e
 * a ordem entre medir e desenhar voltaria a ser acidente.
 *
 * Ordem dentro do quadro: `beats` mede (todos os `getBoundingClientRect` de uma
 * vez, antes de qualquer escrita), depois rodam os callbacks que as seções
 * inscreveram no ticker. `composite.render()` **não** é chamado aqui — quem
 * compõe as camadas decide quando desenhar, e chamar por conta própria daria
 * dois renders por quadro.
 */

export interface Engine {
  gl: GL;
  ticker: Ticker;
  /** Progresso de scroll ancorado no DOM. Já inscrito no `ticker`. */
  beats: Beats;
  /** Cursor global. `setCamera` é chamado por quem conhece a câmera da cena. */
  pointer: Pointer;
  composite: Composite;
  /**
   * ⚠️ **Hoje isto é sempre `false`** — o motor ignora
   * `prefers-reduced-motion: reduce` por decisão de produto, e a decisão, o
   * custo em acessibilidade e as três linhas que a revertem estão em
   * `engine/tier.ts`.
   *
   * O campo continua existindo, e continua sendo o lugar certo para uma
   * animação própria (órbita, ruído no tempo, pulsação) perguntar se deve
   * parar: quando a política mudar, uma linha em `tier.ts` volta a alimentá-lo
   * e o site inteiro obedece sem outra edição. Movimento dirigido por scroll ou
   * cursor nunca olhou aqui — quem comanda é o usuário.
   */
  reducedMotion: boolean;
  dispose(): void;
}

/**
 * Monta o motor sobre um canvas. Devolve `null` quando não há WebGL2 — o caller
 * mostra o fallback estático em vez de deixar um canvas preto na tela.
 */
export function createEngine(canvas: HTMLCanvasElement): Engine | null {
  const gl = createGL(canvas);
  if (gl === null) return null;

  const { reducedMotion } = gl;
  const ticker = createTicker();
  // Com movimento reduzido nada deve rodar sozinho: o quadro passa a ser pedido,
  // não contínuo. Na política atual `reducedMotion` é sempre `false`
  // (`engine/tier.ts`), então o ticker fica em `always` — e é isso que mantém o
  // movimento por scroll **fluido**: um quadro por evento de scroll não é
  // movimento contínuo, porque o navegador agrupa os eventos e o resultado lê
  // como engasgo. O caminho fica aqui para que reverter a política custe uma
  // linha, não uma reescrita.
  if (reducedMotion) ticker.setMode('demand');

  const beats = createBeats({
    onFrame: (fn) => ticker.subscribe(fn),
    // Ligado **sempre**, e os dois modos precisam dele por motivos diferentes:
    //
    //  · em `demand` ninguém agendaria o quadro em que a medição aconteceria, e
    //    o scroll não moveria nada. Um `invalidate` por evento sujo dá
    //    exatamente um quadro por gesto;
    //  · em `always` ele é o **rearme** da cadeia de rAF (`ticker.ts`,
    //    "REARME"). Enquanto isto ficou condicionado a `reducedMotion`, nada
    //    trazia o loop de volta depois de a corrente ser cortada por fora, e a
    //    página ficava parada no último quadro desenhado — que podia ser o de
    //    outra seção, com fundo de luminância oposta.
    //
    // Com a cadeia viva a chamada custa duas comparações e um retorno
    // (`ticker.ts`, `framePending`): não é um segundo agendador.
    onDirty: (): void => ticker.invalidate(),
  });

  // O alvo é a janela, e não o canvas: seções com conteúdo por cima do canvas
  // capturariam o ponteiro e o cursor "sumiria" ao passar sobre um parágrafo.
  const pointer = createPointer(window);
  const composite = createComposite(gl);

  return {
    gl,
    ticker,
    beats,
    pointer,
    composite,
    reducedMotion,
    dispose(): void {
      // Ordem inversa da criação: quem depende do renderer sai antes dele.
      composite.dispose();
      pointer.dispose();
      beats.dispose();
      ticker.dispose();
      gl.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// Superfície pública do motor — seções e variantes importam só de `@/engine`.
// ---------------------------------------------------------------------------

export { computeBeatProgress, createBeats } from './beats';
export { MASK_ASPECT, createComposite } from './composite';
export { DEFAULT_DAMP, createDamped, damp, dampingRate } from './damp';
export {
  CAMERA_DISTANCE_PX,
  createDomSync,
  domRectToWorld,
  fovForHeight,
  projectMeshToScreen,
  screenRectDelta,
} from './domSync';
export { createGL } from './gl';
export { POINTER_RAY_GLSL, createPointer, pointerOffset } from './pointer';
export { TIER_SETTINGS, detectTier } from './tier';
export { createTicker } from './ticker';

export type { Beat, BeatEnd, BeatOptions, BeatStart, Beats, BeatsOptions } from './beats';
export type { Composite, Layer } from './composite';
export type { DampOptions, Damped } from './damp';
export type {
  DomRectLike,
  DomSync,
  DomSyncHost,
  ScreenRect,
  ViewportSize,
  WorldPoint,
} from './domSync';
export type { GL, GLSize, ResizeListener } from './gl';
export type { Pointer, Vec2, Vec3 } from './pointer';
export type { Tier, TierReport, TierSettings } from './tier';
export type { TickFn, Ticker, TickerMode } from './ticker';
