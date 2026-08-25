import { Color, GLSL3, Mesh, PlaneGeometry, RawShaderMaterial, Scene, Vector2 } from 'three';
import { computeBeatProgress, createDamped, createDomSync } from '@/engine';
import { fragment, vertex } from '@/shaders/domPlane';
import { PAPER_GRAIN_SIZE, createPaperGrain } from './grain';
import { bandToScissor, readingFocus, unionBand } from './focus';
import type { Band } from './focus';
import type { DampOptions, Damped, DomRectLike, Engine } from '@/engine';
import type { DataTexture, IUniform, PerspectiveCamera } from 'three';

/**
 * F5 — a camada WebGL do catálogo: um plano por verbete, sincronizado ao
 * retângulo do DOM em **1 px = 1 unidade** (técnica I.2, `engine/domSync`).
 *
 * O DOM continua dono de tudo que importa: layout, quebra de linha, foco,
 * seleção, leitor de tela. O shader só reage — escurece o papel sob a linha em
 * que o cursor está e sob a linha que o scroll trouxe para o centro da tela.
 *
 * Três decisões que sustentam o aceite:
 *
 * 1. **Uma leitura de layout por quadro, para as 16 fichas.** `domSync.update()`
 *    mede todas antes de escrever qualquer coisa; o progresso de scroll de cada
 *    ficha sai de `domSync.rectOf()`, isto é, do retângulo que já foi lido — e
 *    não de 16 beats com 16 `getBoundingClientRect()` a mais.
 * 2. **Scissor na faixa da seção.** Ninguém escreve direto no canvas: toda
 *    seção escreve no FBO de página (`gl.frame.target`, `engine/frame.ts`),
 *    que `main.ts` compõe na tela uma vez só, no fim do quadro. O hero e o
 *    relevo também escrevem nesse FBO. Limpar a página inteira aqui apagaria
 *    os vizinhos, então a seção só escreve na faixa que os seus próprios
 *    planos ocupam — e não desenha nada quando essa faixa está fora da tela.
 *    `renderer.setScissor()` continua certo aqui: esta seção nunca troca de
 *    render target, então o recorte solto do renderer não é pisado por
 *    ninguém — o FBO já está ligado quando este `render()` roda.
 * 3. **Teto de tinta.** O shader nunca passa de `INK_MAX`, e `INK_MAX` foi
 *    escolhido pelo contraste do pior par de cores da seção, não pelo gosto.
 */

/**
 * Teto de tinta depositada, 0–1 — o guarda do contraste (§6 exige ≥ 7:1).
 *
 * Medido sobre o par mais fraco da seção, o texto do problema (`--cat-soft`)
 * sobre o papel: claro `#3a3a38` sobre `#f6f5f3` = 10,4:1 em repouso e 9,3:1
 * com a tinta cheia; escuro `#c9c7c2` sobre `#101010` = 11,1:1 em repouso e
 * 10,5:1 com a tinta cheia. Em 0,16 (o valor do hero da variante C) o caso
 * claro cairia para 6,9:1 e reprovaria.
 */
const INK_MAX = 0.12;

/**
 * Tinta de repouso: zero, ao contrário do hero. Lá havia um bloco de texto e um
 * véu constante dava vida ao papel; aqui são 16 blocos, e 16 manchas de fundo
 * permanentes leem como 16 retângulos. Sem hover e sem scroll o plano é
 * exatamente a cor da página.
 */
const REST_INK = 0;

/** Tinta que o cursor deposita no centro do bleed, antes do teto. */
const BLEED_INK = 0.12;

/**
 * Tinta que a cabeça de leitura deposita na ficha que está no meio da tela.
 * 0.055 é ~metade do teto: perceptível como "esta é a linha que você está
 * lendo", longe de disputar atenção com o hover.
 */
const SOAK_INK = 0.055;

/**
 * Raio do bleed em função da **altura** da ficha, não da diagonal. Uma linha do
 * índice tem proporção de ~10:1; usar a diagonal (como o título do hero fazia)
 * daria um raio maior que a tela e a mancha cobriria a seção inteira. 2.2×
 * a altura faz o bleed vazar uma linha para cima e uma para baixo, que é o que
 * dá a sensação de tinta atravessando o papel entre as linhas.
 */
const BLEED_RADIUS_RATIO = 2.2;
const BLEED_RADIUS_MIN_PX = 90;
const BLEED_RADIUS_MAX_PX = 280;

/** Deformação da borda do bleed pelo grão, como fração do raio (mesma do hero). */
const FIBER_RATIO = 0.34;

/**
 * Desalinhamento entre canais, em px — erro de registro de impressão barata.
 * Menor que o 1,6 px do hero porque o corpo de texto aqui é ~3× menor: a franja
 * precisa continuar abaixo da altura-x para não ser lida como borrão.
 */
const MISREGISTRATION_PX = 0.9;

/**
 * Amplitude do domain warp sob o cursor, em px, no tier `high`. 6 px sobre uma
 * fibra de ~2,5 px por texel desloca a textura duas células e meia: a superfície
 * escorre visivelmente sob o cursor sem que o olho consiga apontar um padrão.
 */
const WARP_PX = 6;

/** px de tela por texel do grão — mesmo limiar de percepção calibrado no hero. */
const GRAIN_TEXEL_PX = 2.5;

/**
 * Amortecimento do hover. Mais rápido que o do hero (`settle 3 / reach 9`)
 * porque aqui o cursor troca de linha a cada ~90 px: com a taxa do hero a
 * mancha ainda estaria subindo na linha anterior quando o cursor já saiu de
 * duas. `reachDistance` 0.4 mantém a chegada macia no último terço.
 */
const HOVER_DAMP: DampOptions = { settle: 6, reach: 16, reachDistance: 0.4 };

const DEG_TO_RAD = Math.PI / 180;

/**
 * Campos nomeados sobre a assinatura de índice que o `RawShaderMaterial` exige:
 * um erro de digitação em `uRadiusPx` vira erro de compilação, e não um uniform
 * silenciosamente nulo.
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
  uWarpPx: IUniform<number>;
}

interface Plane {
  el: HTMLElement;
  mesh: Mesh;
  material: RawShaderMaterial;
  uniforms: PlaneUniforms;
  /** 0–1 amortecido: quanto esta ficha está sob o cursor. */
  hover: Damped;
  untrack(): void;
}

/** Par elemento ↔ plano, exposto para a verificação de sincronia do aceite. */
export interface TrackedPlane {
  readonly el: Element;
  readonly mesh: Mesh;
}

export interface PlaneLayer {
  /** Um por quadro: mede o DOM, atualiza os uniforms e desenha a faixa. */
  update(dt: number): void;
  readonly camera: PerspectiveCamera;
  /**
   * Elementos rastreados e seus planos. É por aqui que a página de verificação
   * projeta o mesh de volta para px de tela e prova que ele não descolou do
   * texto (`projectMeshToScreen`).
   */
  tracked(): readonly TrackedPlane[];
  dispose(): void;
}

export interface PlaneLayerOptions {
  /** Elemento que recebe a delegação de hover — o container do índice. */
  hoverRoot: HTMLElement;
  /** Os verbetes, na ordem do documento. */
  entries: readonly HTMLElement[];
  /** De onde saem `--cat-paper` e `--cat-ink`; normalmente o root da seção. */
  colorSource: HTMLElement;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Uma cor CSS já resolvida. Custom property que ainda contém `var(...)` não
 * serve: `Color.setStyle` reclamaria no console e devolveria preto, e preto no
 * lugar do papel é a seção inteira apagada.
 */
const RESOLVED_COLOR = /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|color\()/i;

/**
 * Lê a primeira das propriedades que resolva numa cor.
 *
 * As cores da seção vivem no stylesheet, com as duas variantes de
 * `prefers-color-scheme`, porque quem decide cor é o design — duplicar os
 * hexadecimais em JS garantiria que um dos dois lados ficasse para trás. A
 * lista existe para o caso de `--cat-paper` chegar como token não substituído:
 * o fallback é o próprio token global de fundo.
 */
function readCssColor(source: HTMLElement, properties: readonly string[]): Color | null {
  const style = getComputedStyle(source);
  for (const property of properties) {
    const raw = style.getPropertyValue(property).trim();
    if (RESOLVED_COLOR.test(raw)) return new Color(raw);
  }
  return null;
}

function createUniforms(grain: DataTexture, warpPx: number): PlaneUniforms {
  return {
    uGrain: { value: grain },
    uGrainScale: { value: 1 },
    uPaper: { value: new Color(0xffffff) },
    uInk: { value: new Color(0x000000) },
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
    uWarpPx: { value: warpPx },
  };
}

export function createPlaneLayer(engine: Engine, options: PlaneLayerOptions): PlaneLayer {
  const { gl, pointer, reducedMotion } = engine;
  const { renderer } = gl;
  const scene = new Scene();
  const domSync = createDomSync(engine);
  const grain = createPaperGrain();
  // Uma geometria para os 16 planos: a escala em px vem do mesh, então o
  // quadrado unitário serve para qualquer ficha.
  const geometry = new PlaneGeometry(1, 1);

  /**
   * Tier por número, nunca por caminho de código (regra VI.6): `fboScale` já é
   * a medida de "quanto pixel esta máquina aguarda" (1 / 0,75 / 0,5), e o warp
   * é justamente o custo por pixel desta seção — uma amostra de textura a mais.
   * Sob movimento reduzido a superfície não escorre: 0.
   */
  const warpPx = reducedMotion ? 0 : WARP_PX * gl.settings.fboScale;

  const planes: Plane[] = options.entries.map((el) => {
    const uniforms = createUniforms(grain, warpPx);
    const material = new RawShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      glslVersion: GLSL3,
      uniforms,
      // Plano opaco: ele mistura papel→tinta no shader e a faixa foi limpa com
      // o mesmo papel. Sem blend, sem ordem de desenho para acertar.
      transparent: false,
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new Mesh(geometry, material);
    scene.add(mesh);
    return {
      el,
      mesh,
      material,
      uniforms,
      hover: createDamped(0, HOVER_DAMP),
      untrack: domSync.track(el, mesh),
    };
  });

  const planeByElement = new Map<HTMLElement, Plane>(planes.map((plane) => [plane.el, plane]));

  // ---- cores -------------------------------------------------------------
  const paper = new Color(0xffffff);
  const ink = new Color(0x000000);
  const previousClear = new Color();

  function syncColors(): void {
    const nextPaper = readCssColor(options.colorSource, ['--cat-paper', '--bg']);
    const nextInk = readCssColor(options.colorSource, ['--cat-ink']);
    if (nextPaper !== null) paper.copy(nextPaper);
    if (nextInk !== null) ink.copy(nextInk);
    for (const plane of planes) {
      plane.uniforms.uPaper.value.copy(paper);
      plane.uniforms.uInk.value.copy(ink);
    }
  }

  // `prefers-color-scheme` troca `--cat-paper`/`--cat-ink` no CSS; sem reler,
  // a faixa limpa continuaria com o papel do outro tema e apareceria um
  // retângulo de outra cor atrás do índice.
  const schemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const handleSchemeChange = (): void => {
    syncColors();
    engine.ticker.invalidate();
  };
  schemeQuery.addEventListener('change', handleSchemeChange);
  syncColors();

  // ---- hover -------------------------------------------------------------
  let hovered: Plane | null = null;

  function findPlane(target: EventTarget | null): Plane | null {
    if (!(target instanceof Element)) return null;
    const entry = target.closest('.cat__entry');
    if (!(entry instanceof HTMLElement)) return null;
    return planeByElement.get(entry) ?? null;
  }

  const handlePointerOver = (event: PointerEvent): void => {
    // Touch não tem hover: um toque acenderia a linha e a deixaria acesa até o
    // próximo toque, que é pior do que não acender.
    if (event.pointerType === 'touch') return;
    hovered = findPlane(event.target);
  };
  const handlePointerLeave = (): void => {
    hovered = null;
  };

  if (!reducedMotion) {
    options.hoverRoot.addEventListener('pointerover', handlePointerOver, { passive: true });
    options.hoverRoot.addEventListener('pointerleave', handlePointerLeave, { passive: true });
  }

  // ---- por quadro --------------------------------------------------------
  const rayX = createDamped(0, HOVER_DAMP);
  const rayY = createDamped(0, HOVER_DAMP);
  /** Reusado por quadro: o laço de `update` não pode alocar. */
  const visibleRects: Array<Readonly<DomRectLike>> = [];

  /**
   * Raio do cursor calculado com a **nossa** câmera, e não lido de
   * `pointer.ray`. Outra seção com câmera própria chama `pointer.setCamera` e
   * passa a mandar no raio global; aqui a conta é local e o bleed nunca sai do
   * lugar por causa de um vizinho.
   */
  function updatePointer(dt: number): void {
    if (reducedMotion) return;
    const camera = domSync.camera;
    const tanHalfFov = Math.tan((camera.fov * DEG_TO_RAD) / 2);
    rayX.target = tanHalfFov * camera.aspect * pointer.ndc.x;
    rayY.target = tanHalfFov * pointer.ndc.y;
    rayX.update(dt);
    rayY.update(dt);
  }

  function updatePlane(plane: Plane, dt: number): void {
    const { uniforms, mesh } = plane;
    const widthPx = mesh.scale.x;
    const heightPx = mesh.scale.y;
    uniforms.uPlanePx.value.set(widthPx, heightPx);

    // O grão acompanha o tamanho da ficha para a fibra ter sempre o mesmo
    // tamanho em px — senão ela cresceria junto com a linha no resize.
    const longSidePx = Math.max(widthPx, heightPx);
    uniforms.uGrainScale.value = Math.max(1, longSidePx / (GRAIN_TEXEL_PX * PAPER_GRAIN_SIZE));

    const radius = clamp(
      heightPx * BLEED_RADIUS_RATIO,
      BLEED_RADIUS_MIN_PX,
      BLEED_RADIUS_MAX_PX,
    );
    uniforms.uRadiusPx.value = radius;
    uniforms.uFiberPx.value = radius * FIBER_RATIO;

    plane.hover.target = plane === hovered && pointer.active ? 1 : 0;
    plane.hover.update(dt);
    uniforms.uPointer.value = plane.hover.value;
    uniforms.uPointerRay.value.set(rayX.value, rayY.value);

    // Progresso de scroll a partir do retângulo **já medido** neste quadro:
    // mesma conta dos beats (`enter` → `exit`), zero leituras de layout a mais.
    const rect = domSync.rectOf(plane.el);
    const progress =
      rect === null
        ? 0
        : computeBeatProgress(rect, domSync.viewport.height, {
            start: 'enter',
            end: 'exit',
            margin: 0,
          });
    uniforms.uSoak.value = readingFocus(progress) * SOAK_INK;
  }

  /** Faixa que os planos visíveis ocupam — a única região do canvas que é nossa. */
  function currentBand(): Band | null {
    visibleRects.length = 0;
    for (const plane of planes) {
      if (!plane.mesh.visible) continue;
      const rect = domSync.rectOf(plane.el);
      if (rect !== null) visibleRects.push(rect);
    }
    return unionBand(visibleRects);
  }

  function render(): void {
    const band = currentBand();
    if (band === null) return;
    const scissor = bandToScissor(band, domSync.viewport);
    if (scissor === null) return;

    const previousAutoClear = renderer.autoClear;
    const previousScissorTest = renderer.getScissorTest();
    renderer.getClearColor(previousClear);
    const previousClearAlpha = renderer.getClearAlpha();

    renderer.autoClear = true;
    renderer.setScissorTest(true);
    renderer.setScissor(scissor.x, scissor.y, scissor.width, scissor.height);
    renderer.setClearColor(paper, 1);
    renderer.render(scene, domSync.camera);

    renderer.setClearColor(previousClear, previousClearAlpha);
    renderer.setScissorTest(previousScissorTest);
    renderer.autoClear = previousAutoClear;
  }

  return {
    camera: domSync.camera,

    tracked(): readonly TrackedPlane[] {
      return planes.map(({ el, mesh }) => ({ el, mesh }));
    },

    update(dt: number): void {
      updatePointer(dt);
      // Ordem obrigatória: medir todo o DOM primeiro, só então ler `mesh.scale`
      // e `rectOf` para os uniforms, e só então desenhar.
      domSync.update();
      for (const plane of planes) updatePlane(plane, dt);
      render();
    },

    dispose(): void {
      schemeQuery.removeEventListener('change', handleSchemeChange);
      options.hoverRoot.removeEventListener('pointerover', handlePointerOver);
      options.hoverRoot.removeEventListener('pointerleave', handlePointerLeave);
      for (const plane of planes) {
        plane.untrack();
        scene.remove(plane.mesh);
        plane.material.dispose();
      }
      planeByElement.clear();
      domSync.dispose();
      geometry.dispose();
      grain.dispose();
    },
  };
}
