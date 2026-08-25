import { Color, GLSL3, Mesh, PlaneGeometry, RawShaderMaterial, Scene, Vector2 } from 'three';
import { createDamped } from '@/engine';
import { createDomSync } from '@/engine/domSync';
import { fragment, vertex } from '@/shaders/domPlane';
import { PAPER_GRAIN_SIZE, createPaperGrain } from '@/sections/catalogo/grain';
import type { Beat, DampOptions, Engine } from '@/engine';
import type { DataTexture, IUniform, PerspectiveCamera } from 'three';

/**
 * A camada de tinta da variante C: um plano WebGL atrás de cada bloco de texto,
 * sincronizado com o DOM em px (`engine/domSync`, técnica I.2).
 *
 * O texto **não** vai para o canvas: continua HTML, selecionável e legível por
 * leitor de tela. O que o WebGL faz é pintar o papel sob ele.
 */

/** Cor do papel. Também vira o `clearColor`, senão a junção plano/página apareceria. */
export const PAPER_HEX = '#f4f1ea';

/** Cor da tinta. Mesma do texto no CSS — o efeito é a própria tinta se espalhando. */
export const INK_HEX = '#141312';

/**
 * Teto de tinta depositada, 0–1. É o guarda do contraste: com 0.16 o papel cai
 * de L≈0.878 para L≈0.74, o que mantém o texto (#141312, L≈0.006) acima de 14:1
 * — folga larga sobre os 7:1 exigidos. Nada no shader passa deste valor.
 */
const INK_MAX = 0.16;

/**
 * Tinta de repouso. 0.018 é uma queda de ~1,5% na luminância do papel: some
 * numa foto e num olhar rápido, mas tira a lisura de "cor chapada" do fundo.
 * Foi baixado de 0.035 depois do primeiro teste, onde a área do bloco ainda se
 * lia como um retângulo mais escuro ao lado do texto.
 */
const REST_INK = 0.018;

/** Tinta máxima que o cursor deposita no centro do bleed. */
const BLEED_INK = 0.1;

/** Tinta máxima que o scroll acumula na base do bloco. */
const SOAK_INK = 0.075;

/**
 * Raio do bleed como fração da diagonal do bloco. 0.42 faz a mancha cobrir
 * pouco menos da metade de um título — perto o bastante para o cursor parecer
 * a causa, longe de virar um holofote que cobre o bloco inteiro.
 */
const BLEED_RADIUS_RATIO = 0.42;

/** Raio mínimo e máximo em px: blocos minúsculos e blocos gigantes ainda leem igual. */
const BLEED_RADIUS_MIN_PX = 120;
const BLEED_RADIUS_MAX_PX = 420;

/** Deformação da borda do bleed pelo grão, como fração do raio. */
const FIBER_RATIO = 0.34;

/**
 * Desalinhamento entre canais, em px. 1.6 px é o erro de registro típico de
 * impressão barata: some no texto e aparece só como uma franja fria/quente na
 * borda da mancha. Acima de ~3 px vira efeito de glitch, que é outro assunto.
 */
const MISREGISTRATION_PX = 1.6;

/**
 * px de tela por texel do grão. 2.5 mantém a fibra no limiar da percepção em
 * 1×; em 1 texel/px o grão vira chuvisco e come a taxa de quadros com mipmap
 * trashing.
 */
const GRAIN_TEXEL_PX = 2.5;

/**
 * Amortecimento do cursor. Mais lento que o `DEFAULT_DAMP` de propósito: tinta
 * em papel não persegue o dedo, ela chega atrasada e assenta.
 */
const INK_DAMP: DampOptions = { settle: 3, reach: 9, reachDistance: 0.35 };

export interface InkTarget {
  /** Elemento de texto cujo retângulo o plano vai seguir. */
  el: Element;
  /** Quanto o scroll molha este bloco, 0–1 relativo a `SOAK_INK`. */
  soakGain?: number;
}

/** Par elemento ↔ plano exposto para verificação. */
export interface TrackedPlane {
  readonly el: Element;
  readonly mesh: Mesh;
}

export interface InkLayer {
  /** Um por quadro: mede o DOM, atualiza os uniforms e desenha. */
  update(dt: number): void;
  /** Câmera px→unidade da camada (`engine/domSync`). */
  readonly camera: PerspectiveCamera;
  /**
   * Elementos rastreados e seus planos. Existe para a página de verificação
   * (`dev/variant-c.html?check=1`) poder projetar o mesh de volta para px de
   * tela e comparar com o `getBoundingClientRect()` do elemento — a única
   * forma de provar a sincronia da técnica I.2 em vez de acreditar nela.
   */
  tracked(): readonly TrackedPlane[];
  dispose(): void;
}

/**
 * `RawShaderMaterial` pede um mapa aberto de uniforms; a assinatura de índice
 * herdada mantém isso, e os campos nomeados garantem que um erro de digitação
 * em `uRadiusPx` seja erro de compilação, e não um uniform silenciosamente nulo.
 */
interface PlaneUniforms extends Record<string, IUniform> {
  uGrain: IUniform<DataTexture>;
  uGrainScale: IUniform<number>;
  uPaper: IUniform<Color>;
  uInk: IUniform<Color>;
  uPlanePx: IUniform<Vector2>;
  uPointerRay: IUniform<Vector2>;
  uPointer: IUniform<number>;
  uBleedInk: IUniform<number>;
  uRadiusPx: IUniform<number>;
  uFiberPx: IUniform<number>;
  uMisregPx: IUniform<number>;
  uSoak: IUniform<number>;
  uRest: IUniform<number>;
  uInkMax: IUniform<number>;
}

interface Plane {
  el: Element;
  mesh: Mesh;
  material: RawShaderMaterial;
  uniforms: PlaneUniforms;
  soakGain: number;
  untrack(): void;
}

function createUniforms(grain: DataTexture): PlaneUniforms {
  return {
    uGrain: { value: grain },
    uGrainScale: { value: 1 },
    uPaper: { value: new Color(PAPER_HEX) },
    uInk: { value: new Color(INK_HEX) },
    uPlanePx: { value: new Vector2(1, 1) },
    uPointerRay: { value: new Vector2(0, 0) },
    uPointer: { value: 0 },
    uBleedInk: { value: BLEED_INK },
    uRadiusPx: { value: BLEED_RADIUS_MIN_PX },
    uFiberPx: { value: BLEED_RADIUS_MIN_PX * FIBER_RATIO },
    uMisregPx: { value: MISREGISTRATION_PX },
    uSoak: { value: 0 },
    uRest: { value: REST_INK },
    uInkMax: { value: INK_MAX },
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function createInkLayer(engine: Engine, targets: readonly InkTarget[]): InkLayer {
  const { gl, pointer, beats, reducedMotion } = engine;
  const scene = new Scene();
  const domSync = createDomSync(engine);
  const grain = createPaperGrain();
  // Uma geometria para todos os planos: a escala em px vem do mesh, então o
  // quadrado unitário serve para qualquer bloco de texto.
  const geometry = new PlaneGeometry(1, 1);

  const planes: Plane[] = targets.map((target) => {
    const uniforms = createUniforms(grain);
    const material = new RawShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      glslVersion: GLSL3,
      uniforms,
      // Plano opaco: ele já mistura papel→tinta no shader e o `clearColor` é o
      // mesmo papel. Sem blend, sem ordem de desenho para acertar.
      transparent: false,
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new Mesh(geometry, material);
    scene.add(mesh);
    return {
      el: target.el,
      mesh,
      material,
      uniforms,
      soakGain: target.soakGain ?? 1,
      untrack: domSync.track(target.el, mesh),
    };
  });

  /**
   * Beat do primeiro bloco: mede o quanto o hero já saiu da tela. É o que
   * "molha" o papel conforme se rola. Sob movimento reduzido nem é registrado.
   */
  const soakBeat: Beat | null =
    reducedMotion || targets[0] === undefined
      ? null
      : beats.register(targets[0].el, { start: 'top', end: 'exit' });

  const presence = createDamped(0, INK_DAMP);
  const rayX = createDamped(0, INK_DAMP);
  const rayY = createDamped(0, INK_DAMP);

  const previousClear = new Color();
  gl.renderer.getClearColor(previousClear);
  const previousClearAlpha = gl.renderer.getClearAlpha();
  gl.renderer.setClearColor(PAPER_HEX, 1);

  function updatePointer(dt: number): void {
    if (reducedMotion) return;
    presence.target = pointer.active ? 1 : 0;
    rayX.target = pointer.ray.x;
    rayY.target = pointer.ray.y;
    presence.update(dt);
    rayX.update(dt);
    rayY.update(dt);
  }

  function updatePlane(plane: Plane): void {
    const { uniforms, mesh } = plane;
    const widthPx = mesh.scale.x;
    const heightPx = mesh.scale.y;
    uniforms.uPlanePx.value.set(widthPx, heightPx);

    // O grão acompanha o tamanho do bloco para a fibra ter sempre o mesmo
    // tamanho em px — senão ela cresceria junto com o título no resize.
    const longSidePx = Math.max(widthPx, heightPx);
    uniforms.uGrainScale.value = Math.max(1, longSidePx / (GRAIN_TEXEL_PX * PAPER_GRAIN_SIZE));

    const diagonal = Math.hypot(widthPx, heightPx);
    const radius = clamp(
      diagonal * BLEED_RADIUS_RATIO,
      BLEED_RADIUS_MIN_PX,
      BLEED_RADIUS_MAX_PX,
    );
    uniforms.uRadiusPx.value = radius;
    uniforms.uFiberPx.value = radius * FIBER_RATIO;

    uniforms.uPointerRay.value.set(rayX.value, rayY.value);
    uniforms.uPointer.value = presence.value;
    uniforms.uSoak.value = (soakBeat?.progress ?? 0) * SOAK_INK * plane.soakGain;
  }

  return {
    camera: domSync.camera,

    tracked(): readonly TrackedPlane[] {
      return planes.map(({ el, mesh }) => ({ el, mesh }));
    },

    update(dt: number): void {
      updatePointer(dt);
      // Ordem obrigatória: medir todo o DOM primeiro (domSync), só então ler
      // `mesh.scale` para os uniforms e desenhar.
      domSync.update();
      for (const plane of planes) updatePlane(plane);
      gl.renderer.render(scene, domSync.camera);
    },

    dispose(): void {
      for (const plane of planes) {
        plane.untrack();
        scene.remove(plane.mesh);
        plane.material.dispose();
      }
      soakBeat?.dispose();
      domSync.dispose();
      geometry.dispose();
      grain.dispose();
      gl.renderer.setClearColor(previousClear, previousClearAlpha);
    },
  };
}
