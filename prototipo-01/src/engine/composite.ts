import {
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  DataTexture,
  GLSL3,
  HalfFloatType,
  LinearFilter,
  LinearSRGBColorSpace,
  Mesh,
  NoColorSpace,
  OrthographicCamera,
  RGBAFormat,
  RawShaderMaterial,
  RedFormat,
  Scene,
  UnsignedByteType,
  Vector2,
  WebGLRenderTarget,
} from 'three';
import type { Camera, Texture, TextureDataType } from 'three';
import {
  DEFAULT_CURVE,
  DEFAULT_MASK_SCALE,
  DEFAULT_SOFTNESS,
  fragment,
  vertex,
} from '@/shaders/thresholdMask';
import type { GL, GLSize } from './gl';

/**
 * Composite rendering (catálogo I.1): duas cenas vão para render targets e um
 * quad decide, pixel a pixel, qual das duas aparece.
 *
 * O catálogo também diz **quando não usar**: sem transição em curso, o segundo
 * render target e o quad final são custo puro. Por isso `render()` desvia para
 * um pass único quando `progress` está em 0 ou 1.
 *
 * Nos dois casos, o destino final não é mais o backbuffer: é o FBO de página
 * compartilhado (`gl.frame.target`, ver `engine/frame.ts`). O hero e a F2 são
 * as únicas seções que passam por este módulo; as outras (`campo`, `relevo`,
 * `catalogo/planes`) desenham direto nesse mesmo FBO sem nunca chamar
 * `setRenderTarget` — confiam que ele já está ligado, e continua ligado
 * depois que este módulo termina de desenhar.
 */

export interface Layer {
  scene: Scene;
  camera: Camera;
}

export interface Composite {
  setLayers(a: Layer, b: Layer): void;
  setMask(texture: Texture): void;
  /** 0 = só a camada A, 1 = só a camada B. Fora da faixa, é clampado. */
  progress: number;
  render(): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Máscara padrão
// ---------------------------------------------------------------------------

/**
 * 256x256. Regra VI.5 do catálogo: padrão vira textura, não ruído por fragment
 * — o fbm de 3 oitavas custa ~20 instruções por pixel por quadro; a textura
 * custa uma amostra. 256 é o menor lado em que o filtro linear ainda esconde a
 * quantização de 8 bits: a **armadilha** aqui é máscara pequena (64/128), que
 * produz degraus visíveis na borda da transição. 256 + LinearFilter +
 * `uSoftness` de 0.05 resolvem; abaixo disso, banding.
 */
const MASK_SIZE = 256;

/** A máscara padrão é quadrada; `coverUv` cuida do encaixe em telas largas. */
export const MASK_ASPECT = 1;

/** Bins do histograma de equalização. 1024 = erro < 0.1% na CDF, custo O(n). */
const HISTOGRAM_BINS = 1024;

/**
 * Expoente aplicado à máscara já equalizada.
 *
 * A equalização deixa a máscara com histograma plano, o que faria a *área*
 * revelada crescer linearmente com o threshold. Como o shader aplica
 * `pow(progress, uCurve)`, a máscara é pré-distorcida com o mesmo expoente para
 * que a área revelada volte a ser linear no progresso — assim `uCurve` governa
 * só o ritmo da borda, e não injeta um segundo easing pelas costas.
 */
const MASK_AREA_EXPONENT = DEFAULT_CURVE;

/**
 * Pesos da forma. Não são gosto: foram varridos numericamente exigindo que, em
 * `progress` 0.5, sobrem >= 30% de pixels 100% A e >= 30% 100% B nas telas
 * 9:16, 1:1, 4:3, 16:9 e 21:9 *depois* do corte do `object-fit: cover`. Estes
 * valores dão 43.6% no pior caso; a combinação radial pura caía para 27.8%,
 * porque numa tela larga o cover come justamente a faixa de raio alto.
 */
const SWEEP_WEIGHT = 0.45;
const SPIRAL_WEIGHT = 0.3;
const NOISE_WEIGHT = 0.25;

/**
 * Inclinação da varredura: 0.8 de X + 0.2 de Y. X domina porque o cover nunca
 * corta a horizontal numa tela larga — é o eixo cuja distribuição sobrevive
 * intacta ao recorte.
 */
const SWEEP_BIAS_X = 0.8;

/** Braços e voltas da espiral — 3 braços leem como rotação sem virar cata-vento. */
const SPIRAL_ARMS = 3;
const SPIRAL_TURNS = 1.75;

/** Oitavas do fbm. A 4ª já cai abaixo de 1 px em 256² — grão invisível, custo real. */
const NOISE_OCTAVES = 3;
const NOISE_BASE_FREQUENCY = 3.5;
const TAU = Math.PI * 2;

/** Hash determinístico em [0,1). Sem seed externo: a máscara tem que ser reproduzível. */
function hash2(x: number, y: number): number {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

/** Mesma curva do `smoothstep` do GLSL: derivada zero nas pontas, sem quinas. */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smoothstep(x - ix);
  const fy = smoothstep(y - iy);

  const top = hash2(ix, iy) * (1 - fx) + hash2(ix + 1, iy) * fx;
  const bottom = hash2(ix, iy + 1) * (1 - fx) + hash2(ix + 1, iy + 1) * fx;
  return top * (1 - fy) + bottom * fy;
}

function fbm(x: number, y: number): number {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = NOISE_BASE_FREQUENCY;
  let total = 0;
  for (let octave = 0; octave < NOISE_OCTAVES; octave += 1) {
    sum += valueNoise(x * frequency, y * frequency) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / total;
}

/**
 * Forma bruta da máscara: uma varredura diagonal (a transição tem direção),
 * torcida por uma espiral centrada (o padrão gira em vez de deslizar) e
 * quebrada por grão — a borda geometricamente perfeita é o que denuncia efeito
 * de biblioteca.
 */
function maskShape(nx: number, ny: number): number {
  const dx = nx - 0.5;
  const dy = ny - 0.5;
  const radius = Math.min(1, Math.hypot(dx, dy) * 2);
  const angle = Math.atan2(dy, dx);
  const spiral = 0.5 + 0.5 * Math.cos(angle * SPIRAL_ARMS + radius * SPIRAL_TURNS * TAU);
  const sweep = nx * SWEEP_BIAS_X + ny * (1 - SWEEP_BIAS_X);
  return sweep * SWEEP_WEIGHT + spiral * SPIRAL_WEIGHT + fbm(nx, ny) * NOISE_WEIGHT;
}

/** Equaliza para histograma plano e aplica `MASK_AREA_EXPONENT`, em 8 bits. */
function equalizeToBytes(values: Float32Array): Uint8Array {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i] ?? 0;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const span = max - min || 1;

  const histogram = new Uint32Array(HISTOGRAM_BINS);
  const bins = new Uint16Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    const normalized = ((values[i] ?? 0) - min) / span;
    const bin = Math.min(HISTOGRAM_BINS - 1, Math.floor(normalized * HISTOGRAM_BINS));
    bins[i] = bin;
    histogram[bin] = (histogram[bin] ?? 0) + 1;
  }

  const cdf = new Float32Array(HISTOGRAM_BINS);
  let accumulated = 0;
  for (let bin = 0; bin < HISTOGRAM_BINS; bin += 1) {
    accumulated += histogram[bin] ?? 0;
    cdf[bin] = accumulated / values.length;
  }

  const bytes = new Uint8Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    const uniform = cdf[bins[i] ?? 0] ?? 0;
    bytes[i] = Math.round(Math.pow(uniform, MASK_AREA_EXPONENT) * 255);
  }
  return bytes;
}

/** Gera a máscara padrão uma única vez, na CPU, no boot. */
function createDefaultMask(): DataTexture {
  const values = new Float32Array(MASK_SIZE * MASK_SIZE);
  for (let y = 0; y < MASK_SIZE; y += 1) {
    for (let x = 0; x < MASK_SIZE; x += 1) {
      values[y * MASK_SIZE + x] = maskShape((x + 0.5) / MASK_SIZE, (y + 0.5) / MASK_SIZE);
    }
  }

  // RedFormat: só o canal R é lido no shader, então RGBA desperdiçaria 3/4 dos
  // 256 KB de VRAM. NoColorSpace porque isto é um dado, não uma cor — passar
  // pela transferência sRGB deformaria a distribuição que acabamos de equalizar.
  const texture = new DataTexture(
    equalizeToBytes(values),
    MASK_SIZE,
    MASK_SIZE,
    RedFormat,
    UnsignedByteType,
  );
  texture.colorSpace = NoColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

// ---------------------------------------------------------------------------
// Quad e render targets
// ---------------------------------------------------------------------------

/** Vértices do triângulo de tela cheia, em clip space. */
const FULLSCREEN_TRIANGLE = new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]);
const POSITION_COMPONENTS = 3;

/** Menor lado aceito para um render target — 0 invalidaria o framebuffer. */
const MIN_TARGET_PX = 1;

type ThresholdUniforms = {
  uTexA: { value: Texture | null };
  uTexB: { value: Texture | null };
  uMask: { value: Texture };
  uProgress: { value: number };
  uSoftness: { value: number };
  uCurve: { value: number };
  uAspect: { value: Vector2 };
  uMaskScale: { value: number };
};

function createTarget(width: number, height: number, type: TextureDataType): WebGLRenderTarget {
  return new WebGLRenderTarget(width, height, {
    type,
    format: RGBAFormat,
    // Espaço linear: a mistura entre A e B acontece em luz. O encode sRGB é
    // feito uma vez só, no quad final.
    colorSpace: LinearSRGBColorSpace,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    generateMipmaps: false,
    // As camadas são cenas 3D: sem depth elas se desenham fora de ordem.
    depthBuffer: true,
    stencilBuffer: false,
    // MSAA seria pago duas vezes (A e B) numa imagem que o quad ainda reescala;
    // `fboScale` já é a alavanca de qualidade aqui.
    samples: 0,
  });
}

function createQuad(mask: Texture): {
  mesh: Mesh;
  material: RawShaderMaterial;
  uniforms: ThresholdUniforms;
} {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(FULLSCREEN_TRIANGLE, POSITION_COMPONENTS));

  const uniforms: ThresholdUniforms = {
    uTexA: { value: null },
    uTexB: { value: null },
    uMask: { value: mask },
    uProgress: { value: 0 },
    uSoftness: { value: DEFAULT_SOFTNESS },
    uCurve: { value: DEFAULT_CURVE },
    uAspect: { value: new Vector2(1, MASK_ASPECT) },
    uMaskScale: { value: DEFAULT_MASK_SCALE },
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
  // O vertex já entrega clip space e ignora as matrizes de câmera: culling pelo
  // frustum só poderia errar.
  mesh.frustumCulled = false;

  return { mesh, material, uniforms };
}

function readTextureAspect(texture: Texture): number {
  const image: unknown = texture.image;
  if (typeof image === 'object' && image !== null && 'width' in image && 'height' in image) {
    const { width, height } = image as { width: unknown; height: unknown };
    if (typeof width === 'number' && typeof height === 'number' && height > 0) {
      return width / height;
    }
  }
  return MASK_ASPECT;
}

// ---------------------------------------------------------------------------

export function createComposite(gl: GL): Composite {
  const { renderer, settings } = gl;

  // RGBA16F evita banding quando a cena tem faixa dinâmica alta. Não é
  // universal em WebGL2: sem a extensão, cai para 8 bits — mesmo caminho de
  // código, só o tipo do buffer muda (regra do tier).
  const targetType: TextureDataType = renderer.extensions.has('EXT_color_buffer_float')
    ? HalfFloatType
    : UnsignedByteType;

  const defaultMask = createDefaultMask();
  const { mesh, material, uniforms } = createQuad(defaultMask);
  const quadScene = new Scene();
  quadScene.add(mesh);
  const quadCamera = new OrthographicCamera();

  let targetA: WebGLRenderTarget | null = null;
  let targetB: WebGLRenderTarget | null = null;
  let layerA: Layer | null = null;
  let layerB: Layer | null = null;
  let progress = 0;

  function resizeTargets(size: GLSize): void {
    const scale = settings.fboScale;
    const width = Math.max(MIN_TARGET_PX, Math.round(size.w * size.dpr * scale));
    const height = Math.max(MIN_TARGET_PX, Math.round(size.h * size.dpr * scale));

    if (targetA === null || targetB === null) {
      targetA = createTarget(width, height, targetType);
      targetB = createTarget(width, height, targetType);
    } else {
      targetA.setSize(width, height);
      targetB.setSize(width, height);
    }

    uniforms.uAspect.value.x = size.h > 0 ? size.w / size.h : 1;
  }

  const stopResize = gl.onResize(resizeTargets);
  resizeTargets(gl.size);

  // Nunca `null`: o backbuffer de verdade só é escrito pelo passe de grade
  // final (`engine/frame.ts`), nunca por uma seção.
  function renderLayer(layer: Layer, target: WebGLRenderTarget): void {
    renderer.setRenderTarget(target);
    renderer.render(layer.scene, layer.camera);
  }

  function renderComposed(a: Layer, b: Layer): void {
    if (targetA === null || targetB === null) return;

    renderLayer(a, targetA);
    renderLayer(b, targetB);

    uniforms.uTexA.value = targetA.texture;
    uniforms.uTexB.value = targetB.texture;
    uniforms.uProgress.value = progress;

    // O FBO de página (`engine/frame.ts`), não o backbuffer: toda seção
    // escreve nele, e só o passe de grade final lê o backbuffer de verdade.
    renderer.setRenderTarget(gl.frame.target);
    renderer.render(quadScene, quadCamera);
  }

  return {
    setLayers(a: Layer, b: Layer): void {
      layerA = a;
      layerB = b;
    },

    setMask(texture: Texture): void {
      uniforms.uMask.value = texture;
      uniforms.uAspect.value.y = readTextureAspect(texture);
    },

    get progress(): number {
      return progress;
    },
    set progress(value: number) {
      progress = Math.min(1, Math.max(0, value));
    },

    render(): void {
      if (layerA === null || layerB === null) return;
      // Sem transição: um pass, direto no FBO de página. É o "quando não
      // usar" do I.1 — dois render targets e um quad para exibir uma cena só
      // é custo puro.
      if (progress <= 0) {
        renderLayer(layerA, gl.frame.target);
        return;
      }
      if (progress >= 1) {
        renderLayer(layerB, gl.frame.target);
        return;
      }
      renderComposed(layerA, layerB);
    },

    dispose(): void {
      stopResize();
      targetA?.dispose();
      targetB?.dispose();
      targetA = null;
      targetB = null;
      mesh.geometry.dispose();
      material.dispose();
      defaultMask.dispose();
      renderer.setRenderTarget(null);
    },
  };
}
