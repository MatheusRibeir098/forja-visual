import { NoToneMapping, SRGBColorSpace, WebGLRenderer } from 'three';
import { createFrame } from './frame';
import { TIER_SETTINGS, detectTier } from './tier';
import type { Frame } from './frame';
import type { Tier, TierSettings } from './tier';

/**
 * Contexto WebGL único do site: um renderer, um canvas, um observador de
 * tamanho. Tudo que desenha passa por aqui.
 */

export interface GLSize {
  /** Largura em px CSS. */
  w: number;
  /** Altura em px CSS. */
  h: number;
  /** `devicePixelRatio` efetivo, já limitado pelo tier. */
  dpr: number;
}

export type ResizeListener = (size: GLSize) => void;

export interface GL {
  renderer: WebGLRenderer;
  canvas: HTMLCanvasElement;
  /** Objeto estável e mutado no lugar — não guarde cópias, guarde a referência. */
  size: GLSize;
  onResize(fn: ResizeListener): () => void;
  readonly rendererName: string;
  readonly tier: Tier;
  readonly settings: TierSettings;
  readonly reducedMotion: boolean;
  /**
   * O FBO de página compartilhado e o passe de grade final — ver
   * `engine/frame.ts`. Toda seção que desenha usa `frame.target` no lugar do
   * backbuffer; só `main.ts` chama `beginFrame`/`present`.
   */
  readonly frame: Frame;
  dispose(): void;
}

/** Menor dimensão aceita para o drawing buffer — 0 invalida o framebuffer. */
const MIN_SIZE_PX = 1;

export function createGL(canvas: HTMLCanvasElement): GL | null {
  // WebGL1 não roda os shaders GLSL ES 3.00 do projeto; sem WebGL2 não há
  // degradação possível, e a página segue como documento estático.
  if (typeof WebGL2RenderingContext === 'undefined') return null;

  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({
      canvas,
      // Antialias do contexto seria MSAA no backbuffer, que o composite descarta:
      // a imagem final vem de um quad texturizado, não da geometria.
      antialias: false,
      // Sem alpha: o canvas é opaco atrás do conteúdo, e alpha ligado força o
      // compositor do navegador a blendar a página inteira a cada quadro.
      alpha: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
    });
  } catch (error) {
    console.warn('engine: WebGL2 indisponível', error);
    return null;
  }

  const context = renderer.getContext();
  if (!(context instanceof WebGL2RenderingContext)) {
    renderer.dispose();
    return null;
  }

  const report = detectTier(context);
  const settings = TIER_SETTINGS[report.tier];

  renderer.outputColorSpace = SRGBColorSpace;
  // Tone mapping alteraria as cores de forma diferente no caminho direto e no
  // caminho pelo composite (que faz o encode sRGB à mão). Cor é decidida no
  // design, não no filtro.
  renderer.toneMapping = NoToneMapping;

  const size: GLSize = { w: 0, h: 0, dpr: 1 };
  const listeners = new Set<ResizeListener>();

  function applySize(cssWidth: number, cssHeight: number): void {
    const width = Math.max(MIN_SIZE_PX, Math.round(cssWidth));
    const height = Math.max(MIN_SIZE_PX, Math.round(cssHeight));
    const dpr = Math.min(window.devicePixelRatio || 1, settings.dpr);

    if (width === size.w && height === size.h && dpr === size.dpr) return;

    size.w = width;
    size.h = height;
    size.dpr = dpr;

    renderer.setPixelRatio(dpr);
    // updateStyle = false: o CSS já posiciona o canvas; deixar o three escrever
    // width/height inline briga com o layout e pode gerar CLS.
    renderer.setSize(width, height, false);

    for (const fn of listeners) fn(size);
  }

  const observer = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (entry === undefined) return;
    const box = entry.contentBoxSize[0];
    if (box !== undefined) {
      applySize(box.inlineSize, box.blockSize);
      return;
    }
    applySize(entry.contentRect.width, entry.contentRect.height);
  });
  observer.observe(canvas);

  // O ResizeObserver não dispara quando só o dpr muda (zoom do navegador,
  // janela arrastada para outro monitor). O `resize` do window cobre esse caso;
  // `applySize` sai cedo quando nada mudou, então o custo é zero.
  function handleWindowResize(): void {
    applySize(size.w, size.h);
  }
  window.addEventListener('resize', handleWindowResize);

  // Primeira medida imediata: esperar o ResizeObserver deixaria um quadro com
  // o buffer 1x1.
  const rect = canvas.getBoundingClientRect();
  applySize(rect.width || window.innerWidth, rect.height || window.innerHeight);

  function onResize(fn: ResizeListener): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }

  // Construído depois do resto do contexto porque precisa de `renderer`,
  // `size` e `onResize` já prontos — é o próprio `GL` que ele recorta, então
  // não pode nascer antes dele.
  const frame = createFrame({ renderer, size, onResize, settings });

  return {
    renderer,
    canvas,
    size,
    onResize,
    rendererName: report.renderer,
    tier: report.tier,
    settings,
    reducedMotion: report.reducedMotion,
    frame,
    dispose(): void {
      frame.dispose();
      observer.disconnect();
      window.removeEventListener('resize', handleWindowResize);
      listeners.clear();
      renderer.dispose();
    },
  };
}
