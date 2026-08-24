import {
  Color,
  GLSL3,
  Mesh,
  NearestFilter,
  NoColorSpace,
  PerspectiveCamera,
  PlaneGeometry,
  RawShaderMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  Scene,
  TextureLoader,
  Vector2,
} from 'three';
import type { Texture } from 'three';
import {
  AMBIENT_COLOR_HEX,
  AMBIENT_LEVEL,
  DEFAULT_ALBEDO_GAIN,
  DEFAULT_GRAIN_AMPLITUDE,
  DEFAULT_FALLOFF_CURVE,
  DEFAULT_GRAIN_TILES,
  DEFAULT_HEIGHT_SCALE,
  DEFAULT_LIGHT_HEIGHT,
  DEFAULT_LIGHT_RADIUS,
  DEFAULT_MARCH_DISTANCE,
  DEFAULT_PLATE_HEIGHT,
  DEFAULT_SHADOW_SOFTNESS,
  DEFAULT_SHADOW_STRENGTH,
  DEFAULT_SHININESS,
  DEFAULT_SPECULAR_STRENGTH,
  LIGHT_COLOR_HEX,
  fragment,
  vertex,
} from '@/shaders/relight';
import type { RelightUniforms } from '@/shaders/relight';

/**
 * A chapa do hero: um plano chato que cobre a viewport e é iluminado pelo
 * shader IV.1. Este módulo cuida só do lado GL — quem decide onde a luz está é
 * `index.ts`.
 */

const DEPTH_URL = '/relief/forja-depth.png';
const ALBEDO_URL = '/relief/forja-albedo.webp';
const GRAIN_URL = '/relief/forja-grain.png';

/** Mesmo fov do resto do protótipo — o raio do cursor é calculado com ele. */
export const CAMERA_FOV = 50;

/**
 * Distância da câmera até a chapa. O valor é arbitrário por construção: o plano
 * é escalado para preencher exatamente o frustum nesta profundidade, então tudo
 * que o shader usa (`uFieldPerWorld`) se cancela. 1 mantém os números perto de
 * 1 e longe de qualquer perda de precisão em float.
 */
const CAMERA_DISTANCE = 1;
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 10;

/** Fundo antes de a chapa carregar — o mesmo carvão das faixas de texto. */
const BACKGROUND_HEX = '#08080a';

/**
 * Teto de amostras do ray march **neste hero**.
 *
 * `TIER_SETTINGS` pede 48/24/12, dimensionado para o relevo em tela cheia da
 * seção "Relevo", que ocupa a tela inteira sozinho. Aqui a sombra mais longa
 * que o relevo consegue projetar é de ~0.025 unidades de campo (≈18 px) e a
 * marcha varre 0.06: com 8 passos as amostras caem a cada 0.0075 (≈5 px), que
 * já é mais fino que a penumbra de 0.006. Passos além disso reamostram o mesmo
 * platô e só custam fetch — e é fetch que decide o FPS em dpr 2.
 */
const MAX_RAY_MARCH_SAMPLES = 8;

/** Menor lado aceito para o cálculo de aspecto — evita divisão por zero no boot. */
const MIN_SIZE_PX = 1;

/**
 * Caixa da palavra dentro do asset, em uv — medida no próprio
 * `forja-depth.png` varrendo os pixels que se afastam mais de 1% da altura da
 * chapa: 0.775 × 0.624, centrada em v = 0.4965. É o que permite enquadrar a
 * palavra na faixa que as barras de texto deixam livre, em vez de centralizá-la
 * na viewport e deixar a barra de baixo comer o pé do J.
 */
const WORD_HEIGHT_UV = 0.6236;
const WORD_CENTER_V = 0.4965;

/**
 * Folga acima e abaixo da palavra dentro da faixa livre, como fração da faixa.
 * 0.09 de cada lado é o mínimo em que a palavra ainda respira; abaixo disso ela
 * encosta na barra e o enquadramento lê como acidente.
 */
const WORD_MARGIN = 0.09;

export interface RelightPlane {
  scene: Scene;
  camera: PerspectiveCamera;
  uniforms: RelightUniforms;
  /** Passos de ray march efetivamente em uso — vai para o rótulo da técnica. */
  readonly samples: number;
  /** `true` quando as três texturas chegaram e a chapa está desenhando. */
  readonly ready: boolean;
  /**
   * Reencaixa o plano na viewport. `insetTopPx` e `insetBottomPx` são as faixas
   * de HTML que cobrem a chapa — a palavra é enquadrada no que sobra entre elas.
   * Devolve o aspecto usado.
   */
  resize(widthPx: number, heightPx: number, insetTopPx: number, insetBottomPx: number): number;
  dispose(): void;
}

export interface RelightPlaneOptions {
  /** Vem de `engine.gl.settings.rayMarchSamples`, e é limitado por este módulo. */
  tierSamples: number;
  /** Chamado a cada textura que chega — serve para pedir quadro em `demand`. */
  onTextureReady?: () => void;
}

function configureDepth(texture: Texture): void {
  // NearestFilter é obrigatório: o byte baixo do packing de 16 bits estoura a
  // cada 1/256 de altura, e o filtro linear inventaria um pico em cada estouro.
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  // Dado, não cor: passar pela transferência sRGB deformaria a altura.
  texture.colorSpace = NoColorSpace;
  texture.generateMipmaps = false;
}

function configureAlbedo(texture: Texture): void {
  texture.colorSpace = SRGBColorSpace;
  texture.generateMipmaps = false;
}

function configureGrain(texture: Texture): void {
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = NoColorSpace;
  texture.generateMipmaps = false;
}

function readImageSize(texture: Texture): { width: number; height: number } | null {
  const image: unknown = texture.image;
  if (typeof image !== 'object' || image === null) return null;
  if (!('width' in image) || !('height' in image)) return null;
  const { width, height } = image as { width: unknown; height: unknown };
  if (typeof width !== 'number' || typeof height !== 'number') return null;
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

function createUniforms(): RelightUniforms {
  return {
    uDepth: { value: null },
    uAlbedo: { value: null },
    uGrain: { value: null },
    uTexel: { value: new Vector2(1, 1) },
    uUvScale: { value: new Vector2(1, 1) },
    uUvOffset: { value: new Vector2(0, 0) },
    uFieldAspect: { value: 1 },
    uGrainTiles: { value: DEFAULT_GRAIN_TILES },
    uGrainAmplitude: { value: DEFAULT_GRAIN_AMPLITUDE },
    uHeightScale: { value: DEFAULT_HEIGHT_SCALE },
    uPlateHeight: { value: DEFAULT_PLATE_HEIGHT },
    uAlbedoGain: { value: DEFAULT_ALBEDO_GAIN },
    uPointerRay: { value: new Vector2(0, 0) },
    uFieldPerWorld: { value: 1 },
    uLightHeight: { value: DEFAULT_LIGHT_HEIGHT },
    uLightColor: { value: new Color(LIGHT_COLOR_HEX) },
    uAmbientColor: { value: new Color(AMBIENT_COLOR_HEX).multiplyScalar(AMBIENT_LEVEL) },
    // Começa apagada: `index.ts` sobe a intensidade quando a chapa carrega, e
    // "a brasa acende" é melhor do que a chapa aparecer pronta num quadro.
    uLightIntensity: { value: 0 },
    uLightRadius: { value: DEFAULT_LIGHT_RADIUS },
    uFalloffCurve: { value: DEFAULT_FALLOFF_CURVE },
    uSpecularStrength: { value: DEFAULT_SPECULAR_STRENGTH },
    uShininess: { value: DEFAULT_SHININESS },
    uSamples: { value: 0 },
    uMarchDistance: { value: DEFAULT_MARCH_DISTANCE },
    uShadowSoftness: { value: DEFAULT_SHADOW_SOFTNESS },
    uShadowStrength: { value: DEFAULT_SHADOW_STRENGTH },
  };
}

export function createRelightPlane(options: RelightPlaneOptions): RelightPlane {
  const samples = Math.max(0, Math.min(options.tierSamples, MAX_RAY_MARCH_SAMPLES));
  const uniforms = createUniforms();
  uniforms.uSamples.value = samples;

  const material = new RawShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    glslVersion: GLSL3,
    // A chapa é o único objeto da cena e cobre tudo: teste de profundidade só
    // poderia custar.
    depthTest: false,
    depthWrite: false,
    uniforms,
  });

  const geometry = new PlaneGeometry(1, 1);
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.visible = false;

  const scene = new Scene();
  scene.background = new Color(BACKGROUND_HEX);
  scene.add(mesh);

  const camera = new PerspectiveCamera(CAMERA_FOV, 1, CAMERA_NEAR, CAMERA_FAR);
  camera.position.z = CAMERA_DISTANCE;

  const loader = new TextureLoader();
  const loaded = new Set<string>();
  let disposed = false;

  /** Altura do plano em unidades de mundo — constante, o frustum não muda. */
  const planeWorldHeight = 2 * Math.tan((CAMERA_FOV * Math.PI) / 360) * CAMERA_DISTANCE;

  function announce(url: string): void {
    loaded.add(url);
    // A chapa só aparece inteira: sem albedo ela seria preta, sem grão o metal
    // fica liso demais, e um quadro intermediário lê como bug.
    mesh.visible = loaded.size === 3;
    options.onTextureReady?.();
  }

  function load(url: string, configure: (texture: Texture) => void): Texture {
    const texture = loader.load(
      url,
      (ready) => {
        if (disposed) {
          ready.dispose();
          return;
        }
        announce(url);
      },
      undefined,
      (error) => {
        console.error(`forja/variante-b: falha ao carregar ${url}`, error);
      },
    );
    configure(texture);
    return texture;
  }

  const depth = load(DEPTH_URL, configureDepth);
  const albedo = load(ALBEDO_URL, configureAlbedo);
  const grain = load(GRAIN_URL, configureGrain);

  uniforms.uDepth.value = depth;
  uniforms.uAlbedo.value = albedo;
  uniforms.uGrain.value = grain;

  /** Lê o tamanho real do depth assim que a imagem existe. */
  function syncFieldFromDepth(): void {
    const size = readImageSize(depth);
    if (size === null) return;
    uniforms.uTexel.value.set(1 / size.width, 1 / size.height);
    uniforms.uFieldAspect.value = size.width / size.height;
  }

  return {
    scene,
    camera,
    uniforms,
    get samples(): number {
      return samples;
    },
    get ready(): boolean {
      return loaded.size === 3;
    },

    resize(
      widthPx: number,
      heightPx: number,
      insetTopPx: number,
      insetBottomPx: number,
    ): number {
      syncFieldFromDepth();

      const width = Math.max(widthPx, MIN_SIZE_PX);
      const height = Math.max(heightPx, MIN_SIZE_PX);
      const aspect = width / height;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();

      // O plano preenche o frustum; a textura é encaixada por `uUvScale`.
      mesh.scale.set(planeWorldHeight * aspect, planeWorldHeight, 1);

      // Encaixe "contain", e não "cover": em retrato o cover cortaria a palavra
      // ao meio. Como a palavra tem ~11% de margem de chapa lisa em volta e as
      // texturas usam ClampToEdge, o excesso vira chapa lisa — que é
      // exatamente o que continuaria ali numa placa real.
      const uvScale = uniforms.uUvScale.value;
      const fieldAspect = uniforms.uFieldAspect.value;
      if (aspect > fieldAspect) {
        uvScale.set(aspect / fieldAspect, 1);
      } else {
        uvScale.set(1, fieldAspect / aspect);
      }

      // Afasta a chapa só o quanto for preciso para a palavra caber na faixa
      // livre. `max(1, …)`: nunca aproximar além do encaixe contain, senão a
      // palavra volta a ser cortada nas laterais.
      const bandPx = Math.max(height - insetTopPx - insetBottomPx, MIN_SIZE_PX);
      const usableFraction = (bandPx / height) * (1 - 2 * WORD_MARGIN);
      const zoom = Math.max(1, WORD_HEIGHT_UV / usableFraction / uvScale.y);
      uvScale.multiplyScalar(zoom);

      // Centro da faixa livre, em coordenada de tela com y para cima.
      const bandCenter = (insetBottomPx + bandPx / 2) / height;
      uniforms.uUvOffset.value.set(0, WORD_CENTER_V - 0.5 - (bandCenter - 0.5) * uvScale.y);

      // Mundo → campo. Isotrópico: o mesmo fator vale nos dois eixos porque o
      // plano e o encaixe da textura são escalados juntos.
      uniforms.uFieldPerWorld.value = uvScale.y / planeWorldHeight;

      return aspect;
    },

    dispose(): void {
      disposed = true;
      geometry.dispose();
      material.dispose();
      depth.dispose();
      albedo.dispose();
      grain.dispose();
      scene.clear();
    },
  };
}
