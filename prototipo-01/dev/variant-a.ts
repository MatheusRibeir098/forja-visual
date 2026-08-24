import '@/styles/tokens.css';
import '@/styles/base.css';
import '@/styles/typography.css';
import { createEngine } from '@/engine';
import { mountHero } from '@/variants/a';
import type { GL } from '@/engine';

/**
 * Página interna para olhar a variante A (não entra no build: só `index.html`
 * é input do Vite).
 *
 *   ?stats=1     mostra fps/tier/viewport no canto
 *   ?contrast=1  mede o pixel mais claro atrás do texto e reporta o contraste
 */

const STATS_EVERY_N_FRAMES = 15; // ~4 atualizações/s: legível sem thrash de layout

/** Cor do texto do hero, em sRGB — a mesma de `variants/a/style.css`. */
const TEXT_SRGB: readonly [number, number, number] = [0xf4, 0xf2, 0xee];

/** Piso do critério de aceite da variante. */
const MIN_CONTRAST = 7;

declare global {
  interface Window {
    __forjaVariantAContrast?: { ratio: number; brightest: string; samples: number };
  }
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) throw new Error(`forja/dev: elemento ausente: ${selector}`);
  return element;
}

/** Canal sRGB 0–255 para luz linear, segundo a WCAG. */
function toLinear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function contrastRatio(a: number, b: number): number {
  const [light, dark] = a > b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}

/**
 * Lê o retângulo do texto no backbuffer e devolve o **pior** pixel: o mais
 * claro, que é o que decide o contraste mínimo. Precisa rodar dentro do quadro,
 * logo depois do render — sem `preserveDrawingBuffer` o buffer já foi entregue
 * ao compositor no próximo tick.
 */
function measureWorstContrast(gl: GL, rect: DOMRect): void {
  const context = gl.renderer.getContext();
  if (!(context instanceof WebGL2RenderingContext)) return;

  const { dpr } = gl.size;
  const bufferHeight = context.drawingBufferHeight;
  const x = Math.max(0, Math.floor(rect.left * dpr));
  const y = Math.max(0, Math.floor(bufferHeight - rect.bottom * dpr));
  const width = Math.min(context.drawingBufferWidth - x, Math.ceil(rect.width * dpr));
  const height = Math.min(bufferHeight - y, Math.ceil(rect.height * dpr));
  if (width <= 0 || height <= 0) return;

  const pixels = new Uint8Array(width * height * 4);
  context.readPixels(x, y, width, height, context.RGBA, context.UNSIGNED_BYTE, pixels);

  let worst = Number.POSITIVE_INFINITY;
  let brightest = '#000000';
  const textLuminance = relativeLuminance(TEXT_SRGB[0], TEXT_SRGB[1], TEXT_SRGB[2]);

  for (let offset = 0; offset < pixels.length; offset += 4) {
    const r = pixels[offset] ?? 0;
    const g = pixels[offset + 1] ?? 0;
    const b = pixels[offset + 2] ?? 0;
    const ratio = contrastRatio(textLuminance, relativeLuminance(r, g, b));
    if (ratio < worst) {
      worst = ratio;
      brightest = `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
    }
  }

  const result = { ratio: worst, brightest, samples: width * height };
  window.__forjaVariantAContrast = result;
  const line = `contraste mínimo ${worst.toFixed(2)}:1 (pior pixel ${brightest}, ${result.samples} px)`;
  if (worst >= MIN_CONTRAST) console.info(`forja/dev: PASSOU — ${line}`);
  else console.error(`forja/dev: FALHOU — ${line} (mínimo ${MIN_CONTRAST}:1)`);
}

function boot(): void {
  const canvas = requireElement<HTMLCanvasElement>('#gl');
  const hero = requireElement<HTMLElement>('#hero');
  const stats = requireElement<HTMLElement>('#stats');

  const engine = createEngine(canvas);
  if (engine === null) {
    hero.textContent = 'WebGL2 indisponível neste navegador.';
    return;
  }

  mountHero(hero, engine);

  const params = new URLSearchParams(window.location.search);
  const wantsStats = params.get('stats') === '1';
  const wantsContrast = params.get('contrast') === '1';
  if (wantsStats) stats.hidden = false;

  let frameIndex = 0;
  let contrastDone = false;

  // Inscrito **depois** de `mountHero`: o ticker roda os callbacks na ordem de
  // inscrição, então o render vê o progresso já atualizado neste quadro.
  engine.ticker.subscribe(() => {
    engine.composite.render();

    if (wantsContrast && !contrastDone && engine.composite.progress >= 1) {
      contrastDone = true;
      const block = hero.querySelector('.va-block');
      if (block !== null) measureWorstContrast(engine.gl, block.getBoundingClientRect());
    }

    frameIndex += 1;
    if (wantsStats && frameIndex % STATS_EVERY_N_FRAMES === 0) {
      stats.textContent = [
        `fps      ${engine.ticker.fps.toFixed(1)}`,
        `tier     ${engine.gl.tier} (dpr ${engine.gl.size.dpr}, fbo ${engine.gl.settings.fboScale})`,
        `viewport ${engine.gl.size.w}×${engine.gl.size.h}`,
        `progress ${engine.composite.progress.toFixed(3)}`,
        `renderer ${engine.gl.rendererName}`,
      ].join('\n');
    }
  });
}

boot();
