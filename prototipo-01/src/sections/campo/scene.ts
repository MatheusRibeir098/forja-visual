import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  GLSL3,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Points,
  RawShaderMaterial,
  Scene,
} from 'three';
import { SIZE_PER_RADIUS, createPointsUniforms, fragment, vertex } from '@/shaders/points';
import type { PointsUniforms } from '@/shaders/points';
import type { Tier } from '@/engine';
import type { HullPayload, PointsPayload } from './payload';

/**
 * A cena da seção: uma câmera em perspectiva, o oclusor invisível e a nuvem
 * aditiva — nesta ordem de desenho, que é a técnica inteira (V.1).
 *
 * A ordem sai de graça do three e ainda assim é declarada: o oclusor usa
 * material opaco e a nuvem é `transparent`, então o renderer já desenha o
 * primeiro antes; `renderOrder` está lá para que trocar um dos dois materiais
 * um dia não inverta a ordem em silêncio, o que apagaria a técnica sem gerar
 * erro nenhum.
 */

/** Mesmo fov do resto do protótipo — o raio do cursor é calculado com ele. */
export const CAMERA_FOV = 50;

/**
 * Distância da câmera, em unidades de mundo. O valor é arbitrário por
 * construção (o raio da nuvem é escolhido em função dele), e 4 mantém os
 * números longe de 0 e de qualquer perda de precisão em float.
 */
const CAMERA_DISTANCE = 4;

/**
 * Plano próximo e distante.
 *
 * Apertados de propósito: a razão far/near é 3,5, o que concentra a precisão do
 * depth buffer justamente na fatia onde o crânio está. **Isto importa mais aqui
 * do que numa cena comum** — a técnica depende de o teste de profundidade
 * distinguir a superfície próxima da distante, e um `near` de 0,1 gastaria
 * metade dos bits do buffer entre a câmera e um objeto que nem existe ali.
 */
const CAMERA_NEAR = 2;
const CAMERA_FAR = 7;

/**
 * Quanto da faixa livre a **silhueta** do objeto ocupa no eixo mais apertado.
 *
 * 0,9 e não 1: o rim (o termo mais claro do shading) fica exatamente sobre a
 * silhueta, e encostá-la na borda do recorte cortaria o único traço que faz o
 * objeto ser lido como crânio.
 */
const FILL_FRACTION = 0.9;

/** Teto do raio, em unidades de mundo, para o objeto nunca furar o `near`. */
const MAX_RADIUS = 1.9;

/** Menor lado aceito no enquadramento — evita divisão por zero no boot. */
const MIN_SIZE_PX = 1;

/**
 * Inclinação fixa para a frente, em radianos (~6°).
 *
 * O bastante para sugerir um objeto tridimensional em vez de um recorte; pouco
 * o bastante para o crânio continuar de pé. Vive aqui, e não na coreografia,
 * porque **nunca é animada** — é justamente esse o ponto: um crânio que
 * cambaleia lê como detrito.
 */
const BASE_TILT_X = 0.1;

/** O oclusor primeiro. Ver o comentário do topo. */
const OCCLUDER_RENDER_ORDER = 0;
const CLOUD_RENDER_ORDER = 1;

/**
 * Fração da nuvem desenhada por tier.
 *
 * Só número, nunca caminho de código: os três tiers rodam o mesmo shader, a
 * mesma cena e o mesmo oclusor. O corte é um `setDrawRange`, e ele só é
 * legítimo porque o arquivo já vem embaralhado com semente fixa — qualquer
 * prefixo é uma amostra uniforme do crânio inteiro (V.5). Sem o embaralho, os
 * primeiros 40% seriam a face que o amostrador visitou primeiro.
 *
 * O custo da nuvem é fill: cada ponto é um quad de até 4,5 px de dispositivo
 * que passa pelo blend. `low` roda a dpr 1 e pode estar num renderizador de
 * software, onde cada fragmento é CPU — daí o corte mais fundo.
 */
const TIER_POINT_FRACTION: Record<Tier, number> = {
  low: 0.4,
  mid: 0.7,
  high: 1,
};

export interface FreeRect {
  /** px CSS, relativos ao palco. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FrameOptions {
  widthPx: number;
  heightPx: number;
  /** Onde, dentro do palco, o objeto pode existir sem o texto por cima. */
  free: FreeRect;
}

export interface CampoScene {
  scene: Scene;
  camera: PerspectiveCamera;
  uniforms: PointsUniforms;
  /** Gira em torno do eixo vertical do modelo. Escreva `rotation.y`. */
  spin: Group;
  /** `true` quando os dois binários chegaram e há o que desenhar. */
  readonly ready: boolean;
  attach(points: PointsPayload, hull: HullPayload): void;
  /** Reenquadra e devolve o aspecto usado — o raio do cursor depende dele. */
  frame(options: FrameOptions): number;
}

function createCloudGeometry(payload: PointsPayload, fraction: number): BufferGeometry {
  const geometry = new BufferGeometry();
  // `normalized: true` é a técnica V.5 inteira: a GPU divide por 32767 na busca
  // de atributo, de graça, e nenhum passe de decode chega a existir.
  geometry.setAttribute('position', new BufferAttribute(payload.position, 3, true));
  geometry.setAttribute('normal', new BufferAttribute(payload.normal, 3, true));
  geometry.setAttribute('curvature', new BufferAttribute(payload.curvature, 1, true));
  geometry.setDrawRange(0, Math.max(1, Math.round(payload.count * fraction)));
  return geometry;
}

function createHullGeometry(payload: HullPayload): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(payload.position, 3, true));
  geometry.setIndex(new BufferAttribute(payload.index, 1));
  return geometry;
}

export function createCampoScene(tier: Tier): CampoScene {
  const scene = new Scene();
  const camera = new PerspectiveCamera(CAMERA_FOV, 1, CAMERA_NEAR, CAMERA_FAR);
  camera.position.set(0, 0, CAMERA_DISTANCE);

  // Dois níveis, e não um `Euler` de dois eixos: assim a inclinação é uma
  // inclinação de mundo (o crânio se apoia para a frente) e o giro continua
  // sendo em torno do eixo vertical *do modelo*, qualquer que seja o ângulo.
  // Com um Euler só, girar meia volta inverteria o sentido da inclinação.
  const pivot = new Group();
  pivot.rotation.x = BASE_TILT_X;
  const spin = new Group();
  pivot.add(spin);
  scene.add(pivot);

  const uniforms = createPointsUniforms();
  const material = new RawShaderMaterial({
    glslVersion: GLSL3,
    uniforms,
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    blending: AdditiveBlending,
    // O par que faz o prepass existir: sem escrita de profundidade os pontos
    // não se ocluem entre si (que com soma aditiva seria ruído de ordem de
    // desenho), com teste de profundidade eles são descartados pelo oclusor.
    depthWrite: false,
    depthTest: true,
  });

  const occluderMaterial = new MeshBasicMaterial({
    // Nenhum pixel muda de cor…
    colorWrite: false,
    // …mas a superfície próxima entra no depth buffer.
    depthWrite: true,
    depthTest: true,
    // O winding da decimação é consistente, mas de direção desconhecida: com
    // descarte de face traseira, um modelo invertido escreveria a profundidade
    // da superfície *distante* e não ocluiria nada. Profundidade guarda o
    // fragmento mais próximo de qualquer jeito, então desenhar os dois lados é
    // correto por construção e custa um cull pulado em 4,4k triângulos.
    side: DoubleSide,
  });

  let cloud: Points | null = null;
  let occluder: Mesh | null = null;
  let aspect = 1;
  let lastFrameOptions: FrameOptions | null = null;

  const fraction = TIER_POINT_FRACTION[tier];
  // A luz somada da nuvem é proporcional à contagem vezes a área do sprite.
  // Cortando a contagem por `f`, um sprite `1/sqrt(f)` maior devolve a mesma
  // soma — o objeto muda de granulação entre tiers, nunca de brilho.
  const tierSizeGain = 1 / Math.sqrt(fraction);

  function applyFrame(options: FrameOptions): number {
    lastFrameOptions = options;
    const width = Math.max(options.widthPx, MIN_SIZE_PX);
    const height = Math.max(options.heightPx, MIN_SIZE_PX);
    aspect = width / height;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();

    const tanHalfFov = Math.tan((CAMERA_FOV * Math.PI) / 360);
    // Meia-altura do frustum na profundidade do centro do objeto: a régua que
    // converte px de layout em unidades de mundo.
    const halfHeightWorld = CAMERA_DISTANCE * tanHalfFov;

    // Enquadramento pela **esfera envolvente**, e não pelas extensões por eixo.
    // Não é conservadorismo: o objeto gira com o scroll, então a extensão
    // vertical de agora é a horizontal de daqui a meia volta, e qualquer
    // enquadramento por eixo estaria errado em algum ponto do percurso. O
    // arquivo garante `max|p| = 1` por construção, então a esfera é a única
    // envoltória independente de pose.
    //
    // A conta é a da silhueta de uma esfera em perspectiva, e não a projeção do
    // centro: o polo próximo está a `D − r` da câmera e amplia. `asin(r/D)` é o
    // meio-ângulo que a esfera subtende; invertê-lo é o que impede o objeto de
    // encostar na borda quando ele gira para a pose mais funda.
    const limitY = tanHalfFov * (options.free.height / height);
    const limitX = tanHalfFov * aspect * (options.free.width / width);
    const limit = Math.min(limitX, limitY) * FILL_FRACTION;
    const radius = Math.min(MAX_RADIUS, CAMERA_DISTANCE * Math.sin(Math.atan(limit)));
    uniforms.uRadius.value = radius;
    // O sprite acompanha o tamanho do objeto na tela, não a viewport: é a razão
    // entre disco e espaçamento que decide a leitura. Ver `SIZE_PER_RADIUS`.
    uniforms.uSize.value = SIZE_PER_RADIUS * radius * tierSizeGain;
    occluder?.scale.setScalar(radius);

    // Centro da faixa livre em NDC do palco, convertido para mundo na mesma
    // profundidade. É isto que tira o crânio de trás do painel de texto sem
    // mexer na câmera — mover a câmera mudaria o raio do cursor junto.
    const centreNdcX = ((options.free.x + options.free.width / 2) / width) * 2 - 1;
    const centreNdcY = 1 - ((options.free.y + options.free.height / 2) / height) * 2;
    pivot.position.set(centreNdcX * halfHeightWorld * aspect, centreNdcY * halfHeightWorld, 0);

    return aspect;
  }

  return {
    scene,
    camera,
    uniforms,
    spin,
    get ready(): boolean {
      return cloud !== null;
    },

    attach(points: PointsPayload, hull: HullPayload): void {
      if (cloud !== null) return;

      cloud = new Points(createCloudGeometry(points, fraction), material);
      // A esfera envolvente do buffer tem raio 1, mas o shader desenha o objeto
      // em `uRadius` e o cursor ainda empurra pontos para fora dela: o culling
      // do three cortaria o objeto cedo demais nas bordas do recorte. Há
      // exatamente um objeto na cena e ele está sempre na tela quando a seção
      // desenha, então o teste não teria o que economizar.
      cloud.frustumCulled = false;
      cloud.renderOrder = CLOUD_RENDER_ORDER;

      occluder = new Mesh(createHullGeometry(hull), occluderMaterial);
      occluder.frustumCulled = false;
      occluder.renderOrder = OCCLUDER_RENDER_ORDER;

      spin.add(occluder, cloud);
      if (lastFrameOptions !== null) applyFrame(lastFrameOptions);
    },

    frame(options: FrameOptions): number {
      return applyFrame(options);
    },
  };
}
