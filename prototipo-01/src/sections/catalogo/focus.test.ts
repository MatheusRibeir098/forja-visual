import { describe, expect, it } from 'vitest';
import {
  RATING_MAX,
  bandToScissor,
  formatRating,
  readingFocus,
  unionBand,
} from '@/sections/catalogo/focus';
import type { DomRectLike, ViewportSize } from '@/engine';

const VIEWPORT: ViewportSize = { width: 1280, height: 720 };

function rect(top: number, height: number, width = 900): DomRectLike {
  return { left: 0, top, width, height };
}

describe('readingFocus', () => {
  it('acende no meio da tela e apaga nas duas bordas', () => {
    expect(readingFocus(0)).toBe(0);
    expect(readingFocus(1)).toBe(0);
    expect(readingFocus(0.5)).toBe(1);
  });

  it('é simétrico: entrar e sair rendem a mesma tinta', () => {
    expect(readingFocus(0.25)).toBeCloseTo(readingFocus(0.75), 12);
  });

  it('trata progresso fora de 0–1 como borda, e não como valor negativo', () => {
    expect(readingFocus(-3)).toBe(0);
    expect(readingFocus(4)).toBe(0);
  });
});

describe('unionBand', () => {
  it('cobre da primeira à última ficha', () => {
    expect(unionBand([rect(100, 80), rect(200, 80), rect(300, 80)])).toEqual({
      top: 100,
      bottom: 380,
    });
  });

  it('ignora retângulo degenerado — ficha ainda sem layout não estica a faixa', () => {
    expect(unionBand([rect(100, 80), { left: 0, top: -9000, width: 0, height: 0 }])).toEqual({
      top: 100,
      bottom: 180,
    });
  });

  it('devolve null quando nada está visível', () => {
    expect(unionBand([])).toBeNull();
  });
});

describe('bandToScissor', () => {
  it('mede Y a partir do fundo da tela, não do topo', () => {
    // Faixa 100..300 a partir do topo => 420..620 a partir do fundo de 720.
    expect(bandToScissor({ top: 100, bottom: 300 }, VIEWPORT)).toEqual({
      x: 0,
      y: 420,
      width: 1280,
      height: 200,
    });
  });

  it('recorta no viewport: ficha meio fora da tela não amplia a faixa', () => {
    const scissor = bandToScissor({ top: -500, bottom: 1200 }, VIEWPORT);
    expect(scissor).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
  });

  it('devolve null quando a faixa está inteiramente fora da tela', () => {
    expect(bandToScissor({ top: -400, bottom: -100 }, VIEWPORT)).toBeNull();
    expect(bandToScissor({ top: 900, bottom: 1200 }, VIEWPORT)).toBeNull();
  });
});

describe('formatRating', () => {
  it('mantém três posições em qualquer nota', () => {
    expect(formatRating(3, '*', '.')).toBe('***');
    expect(formatRating(2, '*', '.')).toBe('**.');
    expect(formatRating(1, '*', '.')).toBe('*..');
    expect(formatRating(1, '*', '.')).toHaveLength(RATING_MAX);
  });

  it('não estoura a coluna com uma nota fora da escala', () => {
    expect(formatRating(9, '*', '.')).toBe('***');
    expect(formatRating(-1, '*', '.')).toBe('...');
  });
});
