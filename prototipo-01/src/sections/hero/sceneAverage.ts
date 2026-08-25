import {
  BufferAttribute,
  BufferGeometry,
  GLSL3,
  Mesh,
  OrthographicCamera,
  RawShaderMaterial,
  Scene,
} from 'three';
import { fragment, vertex } from '@/shaders/variantAAverage';
import type { Layer } from '@/engine';

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

export interface AverageScene extends Layer {
  setAspect(aspect: number): void;
  /**
   * `true` quando o composite vai desenhar esta cena direto na tela: aí a saída
   * precisa já estar em sRGB, porque `RawShaderMaterial` não recebe o chunk de
   * color space do three.
   */
  setDirectToScreen(direct: boolean): void;
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

    dispose(): void {
      geometry.dispose();
      material.dispose();
    },
  };
}
