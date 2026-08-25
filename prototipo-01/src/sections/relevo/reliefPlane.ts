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
} from 'three';
import { AMBIENT_COLOR_HEX, createRelightUniforms, fragment, vertex } from '@/shaders/relight';
import { cameraDistanceForCover, plateCoverFraction, MIN_SIZE_PX } from './geometry';
import type { RelightUniforms } from '@/shaders/relight';
import type { Texture } from 'three';

/**
 * O espécime da seção F4: uma chapa gravada, montada no meio da faixa livre e
 * **viajando em profundidade** conforme a seção atravessa a tela.
 *
 * A viagem não é enfeite: é a prova do V.4. A luz mora onde o raio do cursor
 * cruza a chapa, resolvido na profundidade de cada fragmento — então a poça
 * continua exatamente sob o cursor enquanto o espécime vai de z −1.73 a −1.25.
 * Uma luz num ponto fixo do mundo faria o contrário: o brilho escorregaria pela
 * chapa a cada pixel de scroll, que é o sintoma clássico de tratar o cursor
 * como ponto 2D.
 *
 * Este módulo cuida só do lado GL. Quem decide para onde a luz aponta e em que
 * pedaço do canvas isso é desenhado é o `index.ts` da seção.
 */

const DEPTH_URL = '/relief/forja-depth.png';
const ALBEDO_URL = '/relief/forja-albedo.webp';
const GRAIN_URL = '/relief/forja-grain.png';

/** Quantas texturas a chapa precisa antes de aparecer inteira. */
const TEXTURE_COUNT = 3;

/** Mesmo fov do resto do protótipo — o raio do cursor é calculado com ele. */
export const CAMERA_FOV = 50;

export const TAN_HALF_FOV = Math.tan((CAMERA_FOV * Math.PI) / 360);

/**
 * Fundo da seção inteira. **Tem que ser o mesmo hex das faixas de texto**
 * (`style.css` recebe este valor como custom property): a chapa flutua no meio
 * do canvas e o resto do retângulo da seção é este clear — qualquer diferença
 * viraria um degrau visível na junta entre HTML e WebGL.
 *
 * #0b0b0d é um degrau abaixo do carvão do albedo (#1c1c1e): a chapa se destaca
 * do fundo por luz própria, sem precisar de moldura desenhada.
 */
export const BACKGROUND_HEX = '#0b0b0d';

/** Altura da chapa em unidades de mundo. 1 mantém os números longe de precisão. */
const PLATE_WORLD_HEIGHT = 1;

/** Aspecto do asset (1280×720, ver README do relevo) até o depth carregar. */
const ASSET_ASPECT = 1280 / 720;

/**
 * Fração da faixa livre que a chapa ocupa no ponto mais **perto** (seção
 * centrada). 0.86 deixa 7% de carvão de cada lado: margem suficiente para o
 * espécime ler como montado na página, e não como imagem cortada pela faixa.
 */
const PLATE_NEAR_COVER = 0.86;

/**
 * Quanto a chapa encolhe no ponto mais **longe** (seção entrando ou saindo).
 *
 * 0.72 não é gosto: como o encolhimento é puro perspectiva, ele fixa a viagem
 * de profundidade em 1/0.72 = **+39%** de distância (z −1.25 → −1.73 numa faixa
 * de 470 px). É a faixa de z que o aceite "a superfície a qualquer profundidade"
 * exercita. Abaixo de ~0.6 a chapa entra na tela como selo e a palavra deixa de
 * ser legível antes de chegar ao centro.
 */
const PLATE_FAR_RATIO = 0.72;

/**
 * Distância (em unidades de campo) em que a luz cai à metade.
 *
 * O default de `relight.ts` é 0.35, medido para a chapa em **tela cheia** do
 * hero: lá o cursor está sempre em cima da chapa, e uma poça pequena é o efeito
 * desejado (carvão com uma brasa). Aqui a chapa é uma ilha no meio da faixa, e
 * a mesma poça deixava o espécime praticamente preto assim que o cursor saía
 * dele — medido no canto esquerdo da faixa a 1.58 unidades de campo do centro,
 * a queda devolvia 0.7% da luz. Com 1.1 a mesma distância devolve 17%: o
 * espécime continua lido como metal iluminado de lado, e quem faz o drama passa
 * a ser a normal (a face virada para a luz contra a oposta), que é o assunto da
 * técnica.
 */
const SECTION_LIGHT_RADIUS = 1.1;

/**
 * Intensidade. A queda mais aberta entrega ~0.94 da luz sob o cursor, contra
 * 0.59 do hero: manter os 5.5 do default estouraria a chapa. 3.6 é
 * `5.5 × 0.59/0.94` arredondado — o pico volta para o mesmo byte 165 que a
 * captura do hero mediu como "metal quente, não papel branco".
 */
export const LIGHT_INTENSITY = 3.6;

/**
 * Nível do ambiente. 0.075 do hero deixava o espécime a byte 25 contra o fundo
 * de byte 11 quando a luz estava longe — visível, mas quase indistinguível da
 * mesa. 0.16 põe o metal apagado em ~byte 45: continua sendo o mesmo carvão,
 * mas o espécime nunca some da página.
 */
const SECTION_AMBIENT_LEVEL = 0.16;

const CAMERA_NEAR = 0.1;
/** Teto folgado: a maior distância acontece em retrato, e fica perto de 4. */
const CAMERA_FAR = 20;

export interface ReliefPlane {
  scene: Scene;
  camera: PerspectiveCamera;
  uniforms: RelightUniforms;
  /** `true` quando as três texturas chegaram e a chapa está desenhando. */
  readonly ready: boolean;
  /**
   * Reencaixa o espécime na faixa livre entre as duas barras de texto, em px
   * CSS. Devolve o aspecto do viewport da faixa — é ele que converte NDC em
   * raio do cursor.
   */
  setBand(widthPx: number, heightPx: number): number;
  /** 0 = ponto mais longe (seção entrando/saindo), 1 = mais perto (centrada). */
  setApproach(approach: number): void;
  dispose(): void;
}

export interface ReliefPlaneOptions {
  /** `gl.settings.rayMarchSamples`, cru: o tier é quem decide (ver `tier.ts`). */
  samples: number;
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

export function createReliefPlane(options: ReliefPlaneOptions): ReliefPlane {
  const uniforms = createRelightUniforms();
  uniforms.uSamples.value = options.samples;
  uniforms.uLightRadius.value = SECTION_LIGHT_RADIUS;
  uniforms.uAmbientColor.value.set(AMBIENT_COLOR_HEX).multiplyScalar(SECTION_AMBIENT_LEVEL);
  // A chapa é a unidade de campo: 1 unidade de campo = 1 unidade de mundo.
  uniforms.uFieldPerWorld.value = 1 / PLATE_WORLD_HEIGHT;
  uniforms.uFieldAspect.value = ASSET_ASPECT;

  const material = new RawShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    glslVersion: GLSL3,
    // Objeto único na cena: teste de profundidade aqui só poderia custar.
    depthTest: false,
    depthWrite: false,
    uniforms,
  });

  const geometry = new PlaneGeometry(1, 1);
  const mesh = new Mesh(geometry, material);
  // O espécime é menor que o viewport da faixa e sai dele quando recua; o cull
  // por frustum só gastaria uma conta por quadro para nunca descartar nada.
  mesh.frustumCulled = false;
  mesh.visible = false;

  const scene = new Scene();
  scene.background = new Color(BACKGROUND_HEX);
  scene.add(mesh);

  const camera = new PerspectiveCamera(CAMERA_FOV, 1, CAMERA_NEAR, CAMERA_FAR);

  const loader = new TextureLoader();
  const loaded = new Set<string>();
  let disposed = false;

  /** Distâncias do espécime nos dois extremos da travessia, em unidades de mundo. */
  let nearDistance = cameraDistanceForCover(PLATE_NEAR_COVER, PLATE_WORLD_HEIGHT, TAN_HALF_FOV);
  let farDistance = nearDistance / PLATE_FAR_RATIO;
  let lastApproach = 0;

  function applyPlateScale(): void {
    mesh.scale.set(PLATE_WORLD_HEIGHT * uniforms.uFieldAspect.value, PLATE_WORLD_HEIGHT, 1);
  }
  applyPlateScale();

  function load(url: string, configure: (texture: Texture) => void): Texture {
    const texture = loader.load(
      url,
      (ready) => {
        if (disposed) {
          ready.dispose();
          return;
        }
        loaded.add(url);
        // A chapa só aparece inteira: sem albedo ela seria preta, sem grão o
        // metal fica liso demais, e um quadro intermediário lê como bug.
        mesh.visible = loaded.size === TEXTURE_COUNT;
        options.onTextureReady?.();
      },
      undefined,
      (error) => {
        console.error(`forja/relevo: falha ao carregar ${url}`, error);
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
    applyPlateScale();
  }

  function setApproach(approach: number): void {
    lastApproach = approach;
    const distance = farDistance + (nearDistance - farDistance) * approach;
    // A câmera olha para −z: afastar o espécime é levá-lo para z negativo.
    mesh.position.z = -distance;
  }

  function setBand(widthPx: number, heightPx: number): number {
    syncFieldFromDepth();

    const width = Math.max(widthPx, MIN_SIZE_PX);
    const height = Math.max(heightPx, MIN_SIZE_PX);
    const aspect = width / height;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();

    // A chapa mantém o aspecto do asset (uUvScale fica em 1): não há recorte de
    // uv nenhum, e o que sobra da faixa é fundo. Numa placa real é isso que
    // acontece — ela tem o tamanho que tem, e a mesa em volta é a mesa.
    const cover = plateCoverFraction(
      { width, height },
      uniforms.uFieldAspect.value,
      PLATE_NEAR_COVER,
      PLATE_NEAR_COVER,
    );
    nearDistance = cameraDistanceForCover(cover, PLATE_WORLD_HEIGHT, TAN_HALF_FOV);
    farDistance = nearDistance / PLATE_FAR_RATIO;
    setApproach(lastApproach);

    return aspect;
  }

  return {
    scene,
    camera,
    uniforms,
    setBand,
    setApproach,

    get ready(): boolean {
      return loaded.size === TEXTURE_COUNT;
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
