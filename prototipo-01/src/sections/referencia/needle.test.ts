import { describe, expect, it } from 'vitest';
import { computeBeatProgress } from '@/engine/beats';
import { DEFAULT_DAMP, damp } from '@/engine/damp';
import { activeIndexAt, computeNeedleTarget, needleAt } from './needle';

/**
 * Geometria de referência do layout desktop de F3, em px: viewport de 720
 * (1280×720 é a tela em que a spec §6 mede FPS e contraste) e blocos de fator
 * com 260 px de altura separados por `--space-xl` (~64 px no desktop) — o que
 * dá um passo de 324 px entre centros. Com 5 blocos, o percurso inteiro da
 * agulha cabe em 4 × 324 = 1296 px, menos de 2 telas: é isso que garante que um
 * salto de 2 telas produza um gap grande o bastante para o `reach` do damp
 * entrar em ação — o teste do fim deste arquivo é quem verifica isso.
 */
const VIEWPORT_H = 720;
const BLOCK_H = 260;
const BLOCK_PITCH = 324;
const FIRST_BLOCK_TOP = 900;
const FACTOR_COUNT = 5;

const FRAME_DT = 1 / 60;
const BEAT_OPTIONS = { start: 'enter', end: 'center', margin: 0 } as const;

/** Alvo da agulha com a página rolada `scrollY` px a partir do topo. */
function targetAtScroll(scrollY: number): number {
  let arrived = 0;
  for (let index = 0; index < FACTOR_COUNT; index += 1) {
    const top = FIRST_BLOCK_TOP + index * BLOCK_PITCH - scrollY;
    arrived += computeBeatProgress({ top, height: BLOCK_H }, VIEWPORT_H, BEAT_OPTIONS);
  }
  return computeNeedleTarget(arrived, FACTOR_COUNT);
}

describe('needle — mapeamento da trilha', () => {
  it('põe o marcador no centro da fatia de cada fator', () => {
    expect(needleAt(0, FACTOR_COUNT)).toBeCloseTo(0.1, 6);
    expect(needleAt(4, FACTOR_COUNT)).toBeCloseTo(0.9, 6);
  });

  it('crava a agulha no marcador quando o bloco chega ao centro da tela', () => {
    // Bloco 0 centrado: sua parcela vale 1 e as demais ainda não começaram.
    expect(computeNeedleTarget(1, FACTOR_COUNT)).toBeCloseTo(needleAt(0, FACTOR_COUNT), 6);
    expect(computeNeedleTarget(5, FACTOR_COUNT)).toBeCloseTo(needleAt(4, FACTOR_COUNT), 6);
  });

  it('não sai de 0–1 nos extremos', () => {
    expect(computeNeedleTarget(0, FACTOR_COUNT)).toBe(0);
    expect(computeNeedleTarget(99, FACTOR_COUNT)).toBe(1);
  });

  it('destaca a fatia em que a agulha está, não a que o scroll já pediu', () => {
    expect(activeIndexAt(needleAt(2, FACTOR_COUNT), FACTOR_COUNT)).toBe(2);
    expect(activeIndexAt(0, FACTOR_COUNT)).toBe(0);
    expect(activeIndexAt(1, FACTOR_COUNT)).toBe(FACTOR_COUNT - 1);
  });

  it('avança de forma monótona conforme a página desce', () => {
    let previous = -1;
    for (let scrollY = 0; scrollY <= 3200; scrollY += 40) {
      const target = targetAtScroll(scrollY);
      expect(target).toBeGreaterThanOrEqual(previous);
      previous = target;
    }
  });
});

describe('needle — critério de aceite do damping (V.3)', () => {
  /** Salto de 2 telas a partir do momento em que o primeiro fator está centrado. */
  const scrollBefore = FIRST_BLOCK_TOP + BLOCK_H / 2 - VIEWPORT_H / 2;
  const from = targetAtScroll(scrollBefore);
  const to = targetAtScroll(scrollBefore + 2 * VIEWPORT_H);

  it('o salto de 2 telas move a agulha o bastante para o damp usar `reach`', () => {
    expect(to - from).toBeGreaterThan(DEFAULT_DAMP.reachDistance);
  });

  it('fecha 90% do gap em <= 0,35 s (250 ms aqui; 234 ms no Chrome 151)', () => {
    let value = from;
    const limit = (to - from) * 0.1;
    let elapsedMs = 0;
    for (let frame = 1; frame <= 600; frame += 1) {
      value = damp(value, to, FRAME_DT, DEFAULT_DAMP);
      if (to - value <= limit) {
        elapsedMs = frame * FRAME_DT * 1000;
        break;
      }
    }
    expect(elapsedMs).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThanOrEqual(350);
  });

  it('assenta sem overshoot: o gap nunca troca de sinal', () => {
    let value = from;
    let signChanges = 0;
    let previousSign = Math.sign(to - value);
    for (let frame = 0; frame < 600; frame += 1) {
      value = damp(value, to, FRAME_DT, DEFAULT_DAMP);
      const sign = Math.sign(to - value);
      if (sign !== 0 && sign !== previousSign) {
        signChanges += 1;
        previousSign = sign;
      }
    }
    expect(signChanges).toBe(0);
  });
});
