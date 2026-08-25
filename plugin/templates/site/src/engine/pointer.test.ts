import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POINTER_RAY_GLSL, createPointer, pointerOffset } from '@/engine/pointer';
import type { Pointer, Vec3 } from '@/engine/pointer';

const VIEWPORT_WIDTH = 1200;
const VIEWPORT_HEIGHT = 800;
const FOV_DEG = 50;
const ASPECT = VIEWPORT_WIDTH / VIEWPORT_HEIGHT;

function movePointer(x: number, y: number, pointerType = 'mouse'): void {
  window.dispatchEvent(
    new PointerEvent('pointermove', { clientX: x, clientY: y, pointerType, bubbles: true }),
  );
}

describe('pointer', () => {
  let pointer: Pointer | null = null;

  beforeEach(() => {
    window.innerWidth = VIEWPORT_WIDTH;
    window.innerHeight = VIEWPORT_HEIGHT;
    pointer = createPointer();
    pointer.setCamera(FOV_DEG, ASPECT);
  });

  afterEach(() => {
    pointer?.dispose();
    pointer = null;
  });

  it('converte coordenadas de tela em NDC com y para cima', () => {
    if (!pointer) throw new Error('pointer não inicializado');
    movePointer(VIEWPORT_WIDTH / 2, VIEWPORT_HEIGHT / 2);
    expect(pointer.ndc.x).toBeCloseTo(0, 6);
    expect(pointer.ndc.y).toBeCloseTo(0, 6);
    expect(pointer.active).toBe(true);

    movePointer(VIEWPORT_WIDTH, 0);
    expect(pointer.ndc.x).toBeCloseTo(1, 6);
    expect(pointer.ndc.y).toBeCloseTo(1, 6);
  });

  it('deriva o raio de fov e aspect', () => {
    if (!pointer) throw new Error('pointer não inicializado');
    movePointer(VIEWPORT_WIDTH, VIEWPORT_HEIGHT / 2);
    const tanHalfFov = Math.tan((FOV_DEG * Math.PI) / 180 / 2);
    expect(pointer.ray.x).toBeCloseTo(tanHalfFov * ASPECT, 6);
    expect(pointer.ray.y).toBeCloseTo(0, 6);
  });

  it('a repulsão independe da profundidade: o mesmo NDC vale em z=-1 e z=-10', () => {
    if (!pointer) throw new Error('pointer não inicializado');
    movePointer(VIEWPORT_WIDTH * 0.75, VIEWPORT_HEIGHT * 0.25);
    const { ray } = pointer;

    // Ponto exatamente sobre o raio em cada profundidade: offset zero nas duas.
    const onRayNear: Vec3 = { x: ray.x * 1, y: ray.y * 1, z: -1 };
    const onRayFar: Vec3 = { x: ray.x * 10, y: ray.y * 10, z: -10 };
    expect(pointerOffset(onRayNear, ray).x).toBeCloseTo(0, 10);
    expect(pointerOffset(onRayNear, ray).y).toBeCloseTo(0, 10);
    expect(pointerOffset(onRayFar, ray).x).toBeCloseTo(0, 10);
    expect(pointerOffset(onRayFar, ray).y).toBeCloseTo(0, 10);

    // Um ponto deslocado do raio pela mesma quantidade dá o mesmo offset em
    // qualquer z — é isso que faz a repulsão pegar a cena inteira, não uma fatia.
    const sideStep = 0.7;
    const nearOffset = pointerOffset({ x: onRayNear.x + sideStep, y: onRayNear.y, z: -1 }, ray);
    const farOffset = pointerOffset({ x: onRayFar.x + sideStep, y: onRayFar.y, z: -10 }, ray);
    expect(nearOffset.x).toBeCloseTo(sideStep, 10);
    expect(farOffset.x).toBeCloseTo(sideStep, 10);
    expect(nearOffset.y).toBeCloseTo(farOffset.y, 10);
  });

  it('desliga em touch: a cena cai para órbita automática', () => {
    if (!pointer) throw new Error('pointer não inicializado');
    movePointer(VIEWPORT_WIDTH * 0.75, VIEWPORT_HEIGHT * 0.25);
    expect(pointer.active).toBe(true);
    const ndcBeforeTouch = { x: pointer.ndc.x, y: pointer.ndc.y };

    movePointer(10, 10, 'touch');
    expect(pointer.active).toBe(false);
    expect(pointer.ndc.x).toBeCloseTo(ndcBeforeTouch.x, 6);
    expect(pointer.velocity.x).toBe(0);
  });

  it('pointerleave desativa e zera a velocidade', () => {
    if (!pointer) throw new Error('pointer não inicializado');
    movePointer(VIEWPORT_WIDTH * 0.6, VIEWPORT_HEIGHT * 0.6);
    movePointer(VIEWPORT_WIDTH * 0.9, VIEWPORT_HEIGHT * 0.6);
    window.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
    expect(pointer.active).toBe(false);
    expect(pointer.velocity.x).toBe(0);
    expect(pointer.velocity.y).toBe(0);
  });

  it('acumula velocidade em movimento contínuo', async () => {
    if (!pointer) throw new Error('pointer não inicializado');
    movePointer(VIEWPORT_WIDTH * 0.4, VIEWPORT_HEIGHT / 2);
    await new Promise((resolve) => setTimeout(resolve, 16));
    movePointer(VIEWPORT_WIDTH * 0.6, VIEWPORT_HEIGHT / 2);
    expect(pointer.velocity.x).toBeGreaterThan(0);
    expect(Math.abs(pointer.velocity.y)).toBeLessThan(1e-6);
  });

  it('setCamera rejeita fov e aspect fora de faixa', () => {
    if (!pointer) throw new Error('pointer não inicializado');
    expect(() => pointer?.setCamera(0, ASPECT)).toThrow(RangeError);
    expect(() => pointer?.setCamera(FOV_DEG, 0)).toThrow(RangeError);
  });

  it('o snippet GLSL exportado é a mesma conta de pointerOffset', () => {
    expect(POINTER_RAY_GLSL).toContain('mv.xy + ray * mv.z');
  });
});
