import { describe, expect, it } from 'vitest';
import { DEFAULT_DAMP, createDamped, damp, dampingRate } from '@/engine/damp';
import type { DampOptions } from '@/engine/damp';

const FRAME_DT = 1 / 60;
const MAX_FRAMES = 1200; // 20 s: se não assentou aqui, o teste está errado

/** Frames até o resíduo cair abaixo de `tolerance × salto inicial`. */
function framesToSettle(gap: number, options: DampOptions, tolerance: number): number {
  const target = gap;
  const limit = Math.abs(gap) * tolerance;
  let current = 0;
  for (let frame = 1; frame <= MAX_FRAMES; frame += 1) {
    current = damp(current, target, FRAME_DT, options);
    if (Math.abs(target - current) <= limit) return frame;
  }
  return MAX_FRAMES;
}

function millisecondsToSettle(gap: number, options: DampOptions, tolerance: number): number {
  return framesToSettle(gap, options, tolerance) * FRAME_DT * 1000;
}

/** Mesmo λ nas duas pontas = damping clássico, a linha de base a bater. */
function symmetric(lambda: number, reachDistance: number): DampOptions {
  return { settle: lambda, reach: lambda, reachDistance };
}

describe('damp', () => {
  const options = DEFAULT_DAMP;
  const bigJump = 2 * options.reachDistance;

  it('usa reach no gap grande e settle no gap pequeno', () => {
    expect(dampingRate(bigJump, options)).toBeCloseTo(options.reach, 6);
    expect(dampingRate(0, options)).toBeCloseTo(options.settle, 6);
    expect(dampingRate(options.reachDistance / 2, options)).toBeGreaterThan(options.settle);
    expect(dampingRate(options.reachDistance / 2, options)).toBeLessThan(options.reach);
  });

  it('chega a 10% do alvo em <= 0,35 s num salto de 2x reachDistance', () => {
    // Este é o critério perceptual da técnica: o "0,27 s" medido no portfólio.
    expect(millisecondsToSettle(bigJump, options, 0.1)).toBeLessThanOrEqual(350);
  });

  it('assenta a 1% mais rápido que o damping simétrico equivalente', () => {
    const asymmetric = millisecondsToSettle(bigJump, options, 0.01);
    const baseline = millisecondsToSettle(
      bigJump,
      symmetric(options.settle, options.reachDistance),
      0.01,
    );
    expect(asymmetric).toBeLessThan(baseline);
    // Guarda de regressão: 800 ms é o valor exato da configuração atual.
    expect(asymmetric).toBeLessThanOrEqual(850);
  });

  it('nunca ultrapassa o alvo: o sinal do gap não troca nenhuma vez', () => {
    const target = bigJump;
    let current = 0;
    let signChanges = 0;
    let previousSign = Math.sign(target - current);
    for (let frame = 0; frame < MAX_FRAMES; frame += 1) {
      current = damp(current, target, FRAME_DT, options);
      const sign = Math.sign(target - current);
      if (sign !== 0 && sign !== previousSign) {
        signChanges += 1;
        previousSign = sign;
      }
    }
    expect(signChanges).toBe(0);
  });

  it('é assimétrico: gap pequeno demora mais que gap grande para o mesmo 1%', () => {
    const smallJump = 0.2 * options.reachDistance;
    expect(millisecondsToSettle(smallJump, options, 0.01)).toBeGreaterThan(
      millisecondsToSettle(bigJump, options, 0.01),
    );
  });

  it('independe do frame rate: 30, 60 e 144 fps convergem no mesmo valor', () => {
    const target = 1;
    const duration = 0.5;
    const valueAt = (fps: number): number => {
      const dt = 1 / fps;
      let current = 0;
      for (let elapsed = 0; elapsed < duration - dt / 2; elapsed += dt) {
        current = damp(current, target, dt, options);
      }
      return current;
    };
    expect(valueAt(30)).toBeCloseTo(valueAt(144), 2);
    expect(valueAt(60)).toBeCloseTo(valueAt(144), 2);
  });

  it('createDamped acumula estado e converge para o alvo', () => {
    const damped = createDamped(0, options);
    damped.target = bigJump;
    for (let frame = 0; frame < 120; frame += 1) damped.update(FRAME_DT);
    expect(damped.value).toBeCloseTo(bigJump, 3);
    expect(damped.value).toBeLessThanOrEqual(bigJump);
  });
});
