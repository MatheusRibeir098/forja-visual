import { describe, expect, it } from 'vitest';
import { computeBeatProgress } from '@/engine';
import {
  approachEase,
  cameraDistanceForCover,
  ndcInsideRect,
  plateCoverFraction,
  rayFromNdc,
  sectionTopFromProgress,
  toGlBottom,
} from './geometry';

const VIEWPORT_HEIGHT = 720;
const SECTION_HEIGHT = 720;

describe('sectionTopFromProgress', () => {
  it('inverte exatamente o progresso do beat enter→exit', () => {
    // Ida e volta: o progresso vem de um topo conhecido, e a função tem que
    // devolver o mesmo topo. É este par que substitui o rect por quadro.
    for (const top of [720, 360, 0, -360, -720]) {
      const progress = computeBeatProgress({ top, height: SECTION_HEIGHT }, VIEWPORT_HEIGHT, {
        start: 'enter',
        end: 'exit',
        margin: 0,
      });
      expect(sectionTopFromProgress(progress, SECTION_HEIGHT, VIEWPORT_HEIGHT)).toBeCloseTo(
        top,
        6,
      );
    }
  });

  it('não desalinha quando algo cresce acima da seção', () => {
    // O teste do `document.body.prepend` da spec, em unidade: o que muda é o
    // progresso, não a conta — nenhum offset é cravado.
    const before = computeBeatProgress({ top: 200, height: SECTION_HEIGHT }, VIEWPORT_HEIGHT, {
      start: 'enter',
      end: 'exit',
      margin: 0,
    });
    const after = computeBeatProgress({ top: 1000, height: SECTION_HEIGHT }, VIEWPORT_HEIGHT, {
      start: 'enter',
      end: 'exit',
      margin: 0,
    });
    expect(sectionTopFromProgress(before, SECTION_HEIGHT, VIEWPORT_HEIGHT)).toBeCloseTo(200, 6);
    // Fora da janela o beat satura em 0 e a seção fica logo abaixo da dobra.
    expect(after).toBe(0);
    expect(sectionTopFromProgress(after, SECTION_HEIGHT, VIEWPORT_HEIGHT)).toBe(
      VIEWPORT_HEIGHT,
    );
  });
});

describe('approachEase', () => {
  it('vale 0 nas bordas e 1 no centro', () => {
    expect(approachEase(0)).toBe(0);
    expect(approachEase(1)).toBe(0);
    expect(approachEase(0.5)).toBe(1);
  });

  it('é simétrico e monótono até o centro', () => {
    expect(approachEase(0.25)).toBeCloseTo(approachEase(0.75), 12);
    let previous = -1;
    for (let p = 0; p <= 0.5; p += 0.05) {
      const value = approachEase(p);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('chega ao centro sem quina (derivada ~0 nas pontas)', () => {
    const step = 1e-4;
    const slopeAt = (p: number): number =>
      Math.abs(approachEase(p + step) - approachEase(p)) / step;
    // O triângulo cru teria a mesma inclinação em toda parte; aqui a borda e o
    // centro chegam com inclinação 3 ordens de grandeza abaixo do trecho mais
    // rápido, que é o que impede a chapa de parar de avançar num degrau.
    const steepest = slopeAt(0.25);
    expect(slopeAt(0)).toBeLessThan(steepest / 1000);
    expect(slopeAt(0.5 - step)).toBeLessThan(steepest / 1000);
  });
});

describe('plateCoverFraction', () => {
  const ASPECT = 1280 / 720;

  it('em paisagem manda a altura', () => {
    const fraction = plateCoverFraction({ width: 1280, height: 470 }, ASPECT, 0.86, 0.86);
    expect(fraction).toBeCloseTo(0.86, 6);
    // 404 px de altura por 718 px de largura: cabe folgado nos 1280.
    expect(470 * fraction * ASPECT).toBeLessThan(1280 * 0.86);
  });

  it('em retrato manda a largura, e a chapa não vaza', () => {
    const band = { width: 375, height: 407 };
    const fraction = plateCoverFraction(band, ASPECT, 0.86, 0.86);
    expect(fraction).toBeLessThan(0.86);
    expect(band.height * fraction * ASPECT).toBeCloseTo(band.width * 0.86, 6);
  });
});

describe('cameraDistanceForCover', () => {
  const TAN_HALF_FOV = Math.tan((50 * Math.PI) / 360);

  it('devolve a distância em que o plano ocupa a fração pedida', () => {
    const distance = cameraDistanceForCover(0.86, 1, TAN_HALF_FOV);
    const visibleHeight = 2 * TAN_HALF_FOV * distance;
    expect(1 / visibleHeight).toBeCloseTo(0.86, 12);
  });

  it('afasta a câmera quando a chapa encolhe', () => {
    const near = cameraDistanceForCover(0.86, 1, TAN_HALF_FOV);
    const far = cameraDistanceForCover(0.86 * 0.72, 1, TAN_HALF_FOV);
    expect(far).toBeGreaterThan(near);
    // A viagem de profundidade que o aceite "qualquer z" exercita: +39%.
    expect(far / near).toBeCloseTo(1 / 0.72, 6);
  });
});

describe('ndcInsideRect', () => {
  const VIEWPORT_WIDTH = 1280;
  const out = { x: 0, y: 0 };

  it('é identidade quando a faixa é a viewport inteira', () => {
    const rect = { x: 0, y: 0, width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT };
    expect(
      ndcInsideRect({ x: -0.5, y: 0.25 }, VIEWPORT_WIDTH, VIEWPORT_HEIGHT, rect, out),
    ).toEqual({ x: -0.5, y: 0.25 });
  });

  it('recentra no meio da faixa deslocada', () => {
    // Faixa de 400 px começando em y=160: o centro dela está em y=360, que é o
    // centro da janela — logo o NDC vertical do cursor centrado é 0.
    const rect = { x: 0, y: 160, width: VIEWPORT_WIDTH, height: 400 };
    ndcInsideRect({ x: 0, y: 0 }, VIEWPORT_WIDTH, VIEWPORT_HEIGHT, rect, out);
    expect(out.y).toBeCloseTo(0, 12);
    // Cursor no topo da janela: 160 px acima da faixa, ou seja 0.8 de meia-faixa.
    ndcInsideRect({ x: 0, y: 1 }, VIEWPORT_WIDTH, VIEWPORT_HEIGHT, rect, out);
    expect(out.y).toBeCloseTo(1.8, 12);
  });

  it('mantém a luz no raio certo com o cursor fora da faixa', () => {
    // Aceite "cursor em qualquer canto da tela": passar de ±1 é o resultado
    // correto, não um caso a clampar — o raio existe fora do espécime.
    const rect = { x: 0, y: 160, width: VIEWPORT_WIDTH, height: 400 };
    ndcInsideRect({ x: -1, y: -1 }, VIEWPORT_WIDTH, VIEWPORT_HEIGHT, rect, out);
    expect(out.x).toBeCloseTo(-1, 12);
    expect(out.y).toBeLessThan(-1);
  });
});

describe('rayFromNdc', () => {
  it('reproduz a conta do pointer do motor', () => {
    const tanHalfFov = Math.tan((50 * Math.PI) / 360);
    const out = rayFromNdc(1, 1, 16 / 9, tanHalfFov, { x: 0, y: 0 });
    expect(out.x).toBeCloseTo(tanHalfFov * (16 / 9), 12);
    expect(out.y).toBeCloseTo(tanHalfFov, 12);
  });
});

describe('toGlBottom', () => {
  it('vira a origem do retângulo para o canto de baixo', () => {
    expect(toGlBottom(0, 720, 720)).toBe(0);
    expect(toGlBottom(100, 500, 720)).toBe(120);
    // Seção entrando pelo rodapé: o retângulo começa abaixo do canvas.
    expect(toGlBottom(700, 720, 720)).toBe(-700);
  });
});
