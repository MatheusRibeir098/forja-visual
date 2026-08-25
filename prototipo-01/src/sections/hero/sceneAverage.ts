import {
  BufferAttribute,
  BufferGeometry,
  GLSL3,
  Mesh,
  OrthographicCamera,
  RawShaderMaterial,
  Scene,
  Vector2,
} from 'three';
import { fragment, vertex } from '@/shaders/variantAAverage';
import { SAFE_FEATHER_NDC, rectToSafeUniforms } from './sceneField';
import type { Layer } from '@/engine';
import type { SafeAreaRect } from './sceneField';

/**
 * Camada A: a caricatura do hero médio, num único fullscreen triangle.
 *
 * Não há geometria de página aqui — o desenho inteiro vive no fragment shader
 * (ver `@/shaders/variantAAverage`), então a cena não precisa de resize de
 * meshes, só do aspecto.
 */

/** Vértices do triângulo de tela cheia, em clip space (o mesmo do composite). */
const FULLSCREEN_TRIANGLE = new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]);
const POSITION_COMPONENTS = 3;

/** Centro fora da tela: com nenhum retângulo medido ainda, a proteção fica sem efeito. */
const SAFE_CENTER_OFFSCREEN = new Vector2(0, -10);

export interface AverageScene extends Layer {
  setAspect(aspect: number): void;
  /**
   * `true` quando o composite vai desenhar esta cena direto na tela: aí a saída
   * precisa já estar em sRGB, porque `RawShaderMaterial` não recebe o chunk de
   * color space do three.
   */
  setDirectToScreen(direct: boolean): void;
  /**
   * Retângulo(s) do texto HTML, em px CSS — mesmo contrato de
   * `FieldScene.setSafeArea`, incluindo a segunda região opcional. As duas
   * cenas precisam concordar em pixel: é o que garante que, qualquer que seja
   * o pixel que o threshold escolher (A ou B) durante a varredura, a área por
   * trás do texto já está escura nos dois.
   */
  setSafeArea(
    rect: SafeAreaRect | null,
    widthPx: number,
    heightPx: number,
    rect2?: SafeAreaRect | null,
  ): void;
  /** Progresso 0–1 da varredura — governa só a força da proteção (ver shader). */
  setProgress(progress: number): void;
  dispose(): void;
}

export function createAverageScene(): AverageScene {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(FULLSCREEN_TRIANGLE, POSITION_COMPONENTS),
  );

  const uniforms = {
    uAspect: { value: 1 },
    uDirectToScreen: { value: 1 },
    uSafeCenter: { value: SAFE_CENTER_OFFSCREEN.clone() },
    uSafeHalf: { value: new Vector2(0, 0) },
    uSafeCenter2: { value: SAFE_CENTER_OFFSCREEN.clone() },
    uSafeHalf2: { value: new Vector2(0, 0) },
    uSafeFeather: { value: SAFE_FEATHER_NDC },
    uProgress: { value: 0 },
  };

  const material = new RawShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    glslVersion: GLSL3,
    depthTest: false,
    depthWrite: false,
    uniforms,
  });

  const mesh = new Mesh(geometry, material);
  // O vertex entrega clip space e ignora as matrizes: culling só poderia errar.
  mesh.frustumCulled = false;

  const scene = new Scene();
  scene.add(mesh);

  return {
    scene,
    camera: new OrthographicCamera(),

    setAspect(aspect: number): void {
      uniforms.uAspect.value = aspect;
    },

    setDirectToScreen(direct: boolean): void {
      uniforms.uDirectToScreen.value = direct ? 1 : 0;
    },

    setSafeArea(
      rect: SafeAreaRect | null,
      widthPx: number,
      heightPx: number,
      rect2: SafeAreaRect | null = null,
    ): void {
      const validSize = widthPx > 0 && heightPx > 0;
      if (rect === null || !validSize) {
        uniforms.uSafeCenter.value.copy(SAFE_CENTER_OFFSCREEN);
        uniforms.uSafeHalf.value.set(0, 0);
      } else {
        const { center, half } = rectToSafeUniforms(rect, widthPx, heightPx);
        uniforms.uSafeCenter.value.copy(center);
        uniforms.uSafeHalf.value.copy(half);
      }

      if (rect2 === null || rect2 === undefined || !validSize) {
        uniforms.uSafeCenter2.value.copy(SAFE_CENTER_OFFSCREEN);
        uniforms.uSafeHalf2.value.set(0, 0);
      } else {
        const { center, half } = rectToSafeUniforms(rect2, widthPx, heightPx);
        uniforms.uSafeCenter2.value.copy(center);
        uniforms.uSafeHalf2.value.copy(half);
      }
    },

    setProgress(progress: number): void {
      uniforms.uProgress.value = progress;
    },

    dispose(): void {
      geometry.dispose();
      material.dispose();
    },
  };
}
