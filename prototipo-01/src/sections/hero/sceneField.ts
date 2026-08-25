import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  GLSL3,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PerspectiveCamera,
  RawShaderMaterial,
  Scene,
  Vector2,
} from 'three';
import { createDamped } from '@/engine';
import {
  backdropFragment,
  backdropVertex,
  fieldFragment,
  fieldVertex,
} from '@/shaders/variantAField';
import type { Damped, Layer, Pointer, Tier } from '@/engine';

/**
 * O campo de limalha de ferro sobre chapa quase preta — "o específico".
 *
 * É a camada B do hero (o que sobra depois da máscara comer a média) e a
 * camada A da F2 (o estado de onde o scroll parte). A F2 monta a sua própria
 * instância: as duas seções precisam de estados independentes de
 * `setDirectToScreen` no mesmo quadro da troca.
 *
 * As limalhas são instâncias de um quad; o vertex shader as gira segundo o
 * campo magnético (ver `@/shaders/variantAField`). Aqui em cima ficam só as
 * decisões que dependem da tela: quantas limalhas cabem, onde elas ficam, e
 * qual retângulo do texto HTML precisa ser preservado.
 */

// ---------------------------------------------------------------------------
// Câmera
// ---------------------------------------------------------------------------

/** Exportado porque o `pointer` precisa do mesmo fov para calcular o raio. */
export const FIELD_FOV = 50;
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 100;
/** Mesma distância do resto do protótipo: 1 unidade de mundo ≈ 1/3 da tela. */
const CAMERA_Z = 3.2;

/**
 * Espalhamento em profundidade, em unidades de mundo. ±0.45 sobre 3.2 de
 * distância dá ~15% de variação de escala aparente: paralaxe suficiente para
 * o campo ter espessura — e é justamente essa variação que exige tratar o
 * cursor como raio, e não como ponto.
 */
const DEPTH_JITTER = 0.45;

/** Folga da grade além da borda visível, para o plano mais fundo também cobrir. */
const EXTENT_MARGIN = 1.04;

// ---------------------------------------------------------------------------
// Densidade
// ---------------------------------------------------------------------------

/**
 * Espaçamento da grade em px CSS, por tier. Tier só muda número: os três rodam
 * o mesmo shader, com mais ou menos peças. 9 px em `high` dá limalha densa o
 * bastante para as linhas de campo se formarem; 16 px em `low` mantém a mesma
 * leitura com ~3x menos instâncias.
 */
const SPACING_PX: Record<Tier, number> = { low: 16, mid: 12, high: 9 };

/**
 * Teto de instâncias. 26 000 peças × 4 vértices = 104 k vértices, que cabem
 * folgadamente num iGPU; acima disso o custo de vertex começa a aparecer em
 * telas grandes. Quando a viewport pediria mais, o espaçamento cresce em vez
 * de a contagem estourar — de novo, número, não caminho de código.
 */
const MAX_FILINGS = 26_000;

/** Comprimento e espessura da limalha, como múltiplos do espaçamento. */
const LENGTH_RATIO = 1.55;
const THICKNESS_RATIO = 0.26;

/** Jitter de posição, em fração do espaçamento. 0.35 dissolve a grade sem abrir buracos. */
const POSITION_JITTER = 0.35;

// ---------------------------------------------------------------------------
// Área segura do texto
// ---------------------------------------------------------------------------

/**
 * Margem em NDC somada ao retângulo medido do texto, para cobrir o overshoot
 * dos glifos. Exportada: a cena A (`sceneAverage`) protege o mesmo retângulo
 * pelo mesmo motivo (ver `applySafeArea` em `hero/index.ts`), e as duas
 * precisam concordar em pixel — margens diferentes abririam uma fresta clara
 * entre as duas proteções durante a mistura do threshold.
 */
export const SAFE_MARGIN_NDC = 0.06;
/** Largura da queda suave em volta da área segura. 0.35 NDC lê como luz, não como recorte. */
export const SAFE_FEATHER_NDC = 0.35;
/** Centro usado quando não há texto medido: fora da tela, atenuação nenhuma. */
const SAFE_CENTER_OFFSCREEN = new Vector2(0, -10);

/**
 * Converte um retângulo em px CSS para centro/meia-extensão em NDC. Repetida
 * pelas duas cenas (`sceneField`/`sceneAverage`) e pelas duas regiões de cada
 * uma — exportada para as quatro chamadas usarem exatamente a mesma conta, o
 * que é o que garante que a mistura do threshold nunca mostra uma borda
 * desalinhada entre a proteção da média e a do campo.
 */
export function rectToSafeUniforms(
  rect: SafeAreaRect,
  widthPx: number,
  heightPx: number,
): { center: Vector2; half: Vector2 } {
  const centerX = ((rect.left + rect.width / 2) / widthPx) * 2 - 1;
  const centerY = 1 - ((rect.top + rect.height / 2) / heightPx) * 2;
  return {
    center: new Vector2(centerX, centerY),
    half: new Vector2(
      rect.width / widthPx + SAFE_MARGIN_NDC,
      rect.height / heightPx + SAFE_MARGIN_NDC,
    ),
  };
}

// ---------------------------------------------------------------------------

const QUAD_POSITIONS = new Float32Array([
  -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
]);
const QUAD_INDICES = [0, 1, 2, 0, 2, 3];
const POSITION_COMPONENTS = 3;
const OFFSET_COMPONENTS = 3;
const PARAM_COMPONENTS = 2;

const FULLSCREEN_TRIANGLE = new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]);

/** Zera a transição de um valor amortecido: ele passa a valer o alvo agora. */
function snap(damped: Damped, value: number): number {
  damped.value = value;
  damped.target = value;
  return value;
}

/** Hash determinístico em [0,1): o campo precisa ser o mesmo em toda recarga. */
function hash(index: number, salt: number): number {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453123;
  return value - Math.floor(value);
}

export interface SafeAreaRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FieldScene extends Layer {
  /** Reconstrói a grade para a nova viewport (px CSS) e reajusta a câmera. */
  resize(widthPx: number, heightPx: number): void;
  /** Um passo de animação: segue o cursor com amortecimento e avança o tempo. */
  update(dt: number, elapsed: number, pointer: Pointer): void;
  /**
   * Cola o cursor amortecido no valor atual, sem transição. Serve para a cena
   * que **assume a tela no meio do caminho** (a F2 herda o campo do hero): sem
   * isto o ímã sairia do centro e correria até o cursor na primeira fração de
   * segundo, denunciando que a cena acabou de nascer.
   */
  snapToPointer(pointer: Pointer): void;
  /**
   * Retângulo(s) do texto HTML, em px CSS relativos à viewport. `null` desliga a
   * reserva correspondente. `rect2` é a segunda região protegida — hoje, a
   * mensagem de revelação do hero, que em telas largas sai do bloco e vira o
   * seu próprio retângulo (ver `applySafeArea` em `hero/index.ts`). Opcional e
   * `null` por padrão: quem chama sem ela continua protegendo só uma região,
   * exatamente como antes desta segunda área existir.
   */
  setSafeArea(
    rect: SafeAreaRect | null,
    widthPx: number,
    heightPx: number,
    rect2?: SafeAreaRect | null,
  ): void;
  setDirectToScreen(direct: boolean): void;
  dispose(): void;
}

export function createFieldScene(tier: Tier, animated: boolean): FieldScene {
  const camera = new PerspectiveCamera(FIELD_FOV, 1, CAMERA_NEAR, CAMERA_FAR);
  camera.position.z = CAMERA_Z;

  const offsets = new Float32Array(MAX_FILINGS * OFFSET_COMPONENTS);
  const params = new Float32Array(MAX_FILINGS * PARAM_COMPONENTS);

  const offsetAttribute = new InstancedBufferAttribute(offsets, OFFSET_COMPONENTS);
  offsetAttribute.setUsage(DynamicDrawUsage);
  const paramAttribute = new InstancedBufferAttribute(params, PARAM_COMPONENTS);

  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(QUAD_POSITIONS, POSITION_COMPONENTS));
  geometry.setIndex(QUAD_INDICES);
  geometry.setAttribute('aOffset', offsetAttribute);
  geometry.setAttribute('aParams', paramAttribute);
  geometry.instanceCount = 0;

  const fieldUniforms = {
    uPointerRay: { value: new Vector2() },
    uPointerActive: { value: 0 },
    uTime: { value: 0 },
    uExtent: { value: new Vector2(1, 1) },
    uFilingSize: { value: new Vector2(0.02, 0.004) },
    uSafeCenter: { value: SAFE_CENTER_OFFSCREEN.clone() },
    uSafeHalf: { value: new Vector2(0, 0) },
    uSafeCenter2: { value: SAFE_CENTER_OFFSCREEN.clone() },
    uSafeHalf2: { value: new Vector2(0, 0) },
    uSafeFeather: { value: SAFE_FEATHER_NDC },
    uDirectToScreen: { value: 1 },
  };

  const fieldMaterial = new RawShaderMaterial({
    vertexShader: fieldVertex,
    fragmentShader: fieldFragment,
    glslVersion: GLSL3,
    transparent: true,
    // As limalhas são finas e todas de brilho parecido: ordená-las por
    // profundidade custaria mais do que a troca de ordem valeria.
    depthTest: false,
    depthWrite: false,
    uniforms: fieldUniforms,
  });

  const filings = new Mesh(geometry, fieldMaterial);
  // A bounding sphere sai do quad unitário na origem e não descreve as instâncias.
  filings.frustumCulled = false;

  const backdropGeometry = new BufferGeometry();
  backdropGeometry.setAttribute(
    'position',
    new BufferAttribute(FULLSCREEN_TRIANGLE, POSITION_COMPONENTS),
  );

  const backdropUniforms = {
    uAspect: { value: 1 },
    uPointerNdc: { value: new Vector2() },
    uPointerActive: { value: 0 },
    uDirectToScreen: { value: 1 },
  };

  const backdropMaterial = new RawShaderMaterial({
    vertexShader: backdropVertex,
    fragmentShader: backdropFragment,
    glslVersion: GLSL3,
    depthTest: false,
    depthWrite: false,
    uniforms: backdropUniforms,
  });

  const backdrop = new Mesh(backdropGeometry, backdropMaterial);
  backdrop.frustumCulled = false;
  // Opaco e antes de tudo: as limalhas são transparentes e vêm no passe seguinte.
  backdrop.renderOrder = -1;

  const scene = new Scene();
  scene.add(backdrop);
  scene.add(filings);

  // O cursor é perseguido com amortecimento: um ímã que salta de pixel em pixel
  // denuncia que a reação é do mouse, não do campo.
  const rayX = createDamped(0);
  const rayY = createDamped(0);
  const presence = createDamped(0);
  const pointerNdcX = createDamped(0);
  const pointerNdcY = createDamped(0);

  function buildGrid(widthPx: number, heightPx: number): void {
    const halfHeight = Math.tan((FIELD_FOV * Math.PI) / 360) * (CAMERA_Z + DEPTH_JITTER);
    const extentY = halfHeight * EXTENT_MARGIN;
    const aspect = heightPx > 0 ? widthPx / heightPx : 1;
    const extentX = extentY * aspect;

    let spacingPx = SPACING_PX[tier];
    const wanted = (widthPx / spacingPx) * (heightPx / spacingPx);
    // Viewport grande demais para o teto: aumenta o passo em vez de estourar o buffer.
    if (wanted > MAX_FILINGS) spacingPx = Math.sqrt((widthPx * heightPx) / MAX_FILINGS);

    const worldPerPx = heightPx > 0 ? (extentY * 2) / heightPx : 0;
    const spacing = spacingPx * worldPerPx;
    if (spacing <= 0) return;

    const columns = Math.max(1, Math.ceil((extentX * 2) / spacing));
    const rows = Math.max(1, Math.ceil((extentY * 2) / spacing));
    const count = Math.min(MAX_FILINGS, columns * rows);

    for (let index = 0; index < count; index += 1) {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const jitterX = (hash(index, 1) - 0.5) * 2 * POSITION_JITTER * spacing;
      const jitterY = (hash(index, 2) - 0.5) * 2 * POSITION_JITTER * spacing;

      const base = index * OFFSET_COMPONENTS;
      offsets[base] = -extentX + (column + 0.5) * spacing + jitterX;
      offsets[base + 1] = -extentY + (row + 0.5) * spacing + jitterY;
      offsets[base + 2] = (hash(index, 3) - 0.5) * 2 * DEPTH_JITTER;

      const paramBase = index * PARAM_COMPONENTS;
      params[paramBase] = hash(index, 4);
      // Comprimento entre 70% e 130% do nominal: peças idênticas viram textura.
      params[paramBase + 1] = 0.7 + hash(index, 5) * 0.6;
    }

    offsetAttribute.needsUpdate = true;
    paramAttribute.needsUpdate = true;
    geometry.instanceCount = count;

    fieldUniforms.uExtent.value.set(extentX, extentY);
    fieldUniforms.uFilingSize.value.set(spacing * LENGTH_RATIO, spacing * THICKNESS_RATIO);
  }

  return {
    scene,
    camera,

    resize(widthPx: number, heightPx: number): void {
      const aspect = heightPx > 0 ? widthPx / heightPx : 1;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      backdropUniforms.uAspect.value = aspect;
      buildGrid(widthPx, heightPx);
    },

    update(dt: number, elapsed: number, pointer: Pointer): void {
      const active = pointer.active ? 1 : 0;
      rayX.target = pointer.ray.x;
      rayY.target = pointer.ray.y;
      presence.target = active;
      pointerNdcX.target = pointer.ndc.x;
      pointerNdcY.target = pointer.ndc.y;

      fieldUniforms.uPointerRay.value.set(rayX.update(dt), rayY.update(dt));
      const smoothedPresence = presence.update(dt);
      fieldUniforms.uPointerActive.value = smoothedPresence;
      backdropUniforms.uPointerActive.value = smoothedPresence;
      backdropUniforms.uPointerNdc.value.set(pointerNdcX.update(dt), pointerNdcY.update(dt));

      // Sob movimento reduzido o campo é uma fotografia: os polos não derivam.
      fieldUniforms.uTime.value = animated ? elapsed : 0;
    },

    snapToPointer(pointer: Pointer): void {
      const active = pointer.active ? 1 : 0;
      fieldUniforms.uPointerRay.value.set(snap(rayX, pointer.ray.x), snap(rayY, pointer.ray.y));
      fieldUniforms.uPointerActive.value = snap(presence, active);
      backdropUniforms.uPointerActive.value = active;
      backdropUniforms.uPointerNdc.value.set(
        snap(pointerNdcX, pointer.ndc.x),
        snap(pointerNdcY, pointer.ndc.y),
      );
    },

    setSafeArea(
      rect: SafeAreaRect | null,
      widthPx: number,
      heightPx: number,
      rect2: SafeAreaRect | null = null,
    ): void {
      const validSize = widthPx > 0 && heightPx > 0;
      if (rect === null || !validSize) {
        fieldUniforms.uSafeCenter.value.copy(SAFE_CENTER_OFFSCREEN);
        fieldUniforms.uSafeHalf.value.set(0, 0);
      } else {
        const { center, half } = rectToSafeUniforms(rect, widthPx, heightPx);
        fieldUniforms.uSafeCenter.value.copy(center);
        fieldUniforms.uSafeHalf.value.copy(half);
      }

      if (rect2 === null || rect2 === undefined || !validSize) {
        fieldUniforms.uSafeCenter2.value.copy(SAFE_CENTER_OFFSCREEN);
        fieldUniforms.uSafeHalf2.value.set(0, 0);
      } else {
        const { center, half } = rectToSafeUniforms(rect2, widthPx, heightPx);
        fieldUniforms.uSafeCenter2.value.copy(center);
        fieldUniforms.uSafeHalf2.value.copy(half);
      }
    },

    setDirectToScreen(direct: boolean): void {
      const value = direct ? 1 : 0;
      fieldUniforms.uDirectToScreen.value = value;
      backdropUniforms.uDirectToScreen.value = value;
    },

    dispose(): void {
      geometry.dispose();
      fieldMaterial.dispose();
      backdropGeometry.dispose();
      backdropMaterial.dispose();
    },
  };
}
