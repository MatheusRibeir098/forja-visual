import {
  BufferAttribute,
  BufferGeometry,
  GLSL3,
  LinearFilter,
  Mesh,
  NoColorSpace,
  OrthographicCamera,
  RGBAFormat,
  RawShaderMaterial,
  Scene,
  UnsignedByteType,
  Vector2,
  WebGLRenderTarget,
} from 'three';
import type { IUniform, Texture, TextureDataType, WebGLRenderer } from 'three';
import { gradeFragment, vertex } from '@/shaders/grade';
import type { GLSize, ResizeListener } from './gl';
import type { TierSettings } from './tier';

/**
 * Só o que `createFrame` precisa do motor — não `GL` inteiro. `GL.frame` vai
 * ser este próprio módulo (ver `gl.ts`), e depender do tipo `GL` aqui criaria
 * um ciclo de tipos entre os dois arquivos.
 */
export interface FrameHost {
  renderer: WebGLRenderer;
  size: GLSize;
  onResize(fn: ResizeListener): () => void;
  settings: TierSettings;
}

/**
 * O quadro da página inteira, num FBO só (catálogo I.1 + o passe de grade em
 * produção).
 *
 * Hoje cada seção desenha direto na tela, recortada pelo próprio `scissor`
 * (regra do canvas, `main.ts`). Isso continua — a posse por retângulo não
 * muda. O que muda é o **alvo**: em vez do backbuffer, toda seção escreve
 * neste FBO (`target`), e só o passe de grade, no fim do quadro, é que
 * escreve no backbuffer de verdade. Uma imagem, um dono de cada pixel, um
 * único ponto de saída — é o que fecha a emenda entre seções em vez de
 * inventar uma correção por seção.
 *
 * ── DUAS FASES POR QUADRO ────────────────────────────────────────────────
 * `beginFrame()` roda **antes** de qualquer seção (main.ts a inscreve
 * primeiro no ticker): liga o FBO e limpa a página inteira. É a única
 * exceção à regra "nenhum clear global" do canvas — porque agora ela é
 * exatamente a mesma promessa que o browser cumpria de graça na tela
 * (`alpha:false` mais o clear implícito do backbuffer): "região que ninguém
 * desenha fica preta". Como o FBO não tem esse clear implícito (ele
 * persiste entre quadros, ao contrário do backbuffer), alguém precisa
 * cumprir a promessa à mão, uma vez, no início — nunca por seção.
 *
 * `present()` roda **depois** de todas (última inscrição, em `main.ts`):
 * gera o bloom a partir do FBO e desenha o quad de grade no backbuffer.
 * Entre as duas fases, cada seção lê o FBO como "a tela" — `composite.ts`
 * troca `renderer.setRenderTarget(null)` por `frame.target` e mais nada
 * muda; `campo`, `relevo` e `catalogo/planes` nunca chamavam
 * `setRenderTarget` (confiavam no que o composite deixava ligado) e
 * continuam sem chamar — o FBO já está ligado por `beginFrame()`.
 */

const MIN_TARGET_PX = 1;

/**
 * Brilho mínimo (canal máximo, em espaço de exibição) que entra no bloom.
 * Abaixo disso a cena já é fundo escuro — a maioria das oito seções — e
 * "florescer" ali seria só clarear as chapas que o dither existe para manter
 * limpas.
 */
const BLOOM_THRESHOLD = 0.72;

/** Largura do joelho suave em torno do threshold — evita um recorte duro no brilho. */
const BLOOM_KNEE = 0.25;

/** Ganho do brilho somado de volta na imagem. Medido para não ofuscar texto branco. */
const BLOOM_INTENSITY = 0.32;

/** Mistura entre identidade e a curva em S — ver `grade.ts`. */
const FILMIC_STRENGTH = 0.35;

/** Força do escurecimento de borda. */
const VIGNETTE_STRENGTH = 0.22;

/** Amplitude do grão, em fração de canal. ~1.5% é visível sem virar ruído de vídeo velho. */
const GRAIN_AMOUNT = 0.015;

/**
 * Campos nomeados sobre a assinatura de índice que `RawShaderMaterial` exige
 * (mesmo padrão de `catalogo/planes.ts`): um erro de digitação num nome de
 * uniform vira erro de compilação, não um uniform silenciosamente nulo.
 */
interface GradeUniforms extends Record<string, IUniform> {
  uScene: { value: Texture | null };
  uTexelSize: { value: Vector2 };
  uBloomEnabled: { value: number };
  uBloomIntensity: { value: number };
  uBloomThreshold: { value: number };
  uBloomKnee: { value: number };
  uFilmicStrength: { value: number };
  uVignetteStrength: { value: number };
  uGrainAmount: { value: number };
  uGrainSeed: { value: number };
}

export interface Frame {
  /** FBO de página. Toda seção que desenha usa isto no lugar do backbuffer. */
  readonly target: WebGLRenderTarget;
  /** Liga o FBO e limpa a página inteira. Chamar uma vez, antes de qualquer seção. */
  beginFrame(): void;
  /**
   * Recorta o que **o composite** escreve no FBO, em px CSS.
   *
   * Só para quem passa por `composite.ts` (hero, F2): `composite.render()`
   * troca de render target por baixo dos panos (a mistura de duas camadas usa
   * dois FBOs próprios antes do quad final), e a cada troca o three reaplica
   * o scissor **do alvo que acabou de ser ligado**, não o que
   * `renderer.setScissor()` tinha deixado. `WebGLRenderTarget.scissor` é o
   * mecanismo do próprio three para isto — sobrevive a qualquer troca de alvo
   * intermediária porque mora no objeto do alvo, não em estado solto do
   * renderer. Quem **não** passa por composite (`campo`, `relevo`,
   * `catalogo/planes`) nunca chama `setRenderTarget` a mais depois de entrar
   * em cena, então `renderer.setScissor()` — o de sempre — continua certo.
   */
  setScissorCss(xCss: number, yCss: number, widthCss: number, heightCss: number): void;
  /** Gera o bloom e desenha o passe de grade no backbuffer. Chamar por último. */
  present(elapsed: number, animateGrain: boolean): void;
  dispose(): void;
}

function createFullscreenMesh(material: RawShaderMaterial): Mesh {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    // Mesmo triângulo de tela cheia do composite e das cenas do hero — três
    // componentes: o three tira a bounding sphere de `position`, e um
    // atributo sem Z dá raio NaN.
    new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
  );
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}

export function createFrame(host: FrameHost): Frame {
  const { renderer, settings } = host;

  // RGBA8, não RGBA16F — decisão medida, não a original. Medido em
  // `measure-fps.ts` no tier `high`: um FBO de página RGBA16F custava 13,72 ms
  // de mediana de GPU (o teto do aceite é ~13,5 ms); trocando para RGBA8 a
  // mediana caiu para 9,8–11,5 ms nas três repetições seguintes — a diferença
  // é banda passante de escrita de cor nas 11 técnicas que escrevem aqui todo
  // quadro (RGBA16F dobra os bytes por pixel de cada uma delas), não o passe
  // de grade em si. Isso não reabre o banding que o dither existe para matar:
  // toda seção que escreve aqui já termina o próprio shader com
  // `linearToSrgb` (o mesmo que escrevia direto no backbuffer de 8 bits antes
  // desta tarefa existir) — o FBO de página nunca teve precisão além de 8 bits
  // de verdade, só guardaria o mesmo valor quantizado num tipo maior. O
  // bloom inline (`grade.ts`) lê este mesmo FBO direto — não há estágio
  // próprio para repetir a decisão.
  const targetType: TextureDataType = UnsignedByteType;

  const target = new WebGLRenderTarget(MIN_TARGET_PX, MIN_TARGET_PX, {
    type: targetType,
    format: RGBAFormat,
    // Nem `LinearSRGBColorSpace` nem `SRGBColorSpace`: nada aqui é
    // convertido automaticamente (todo material que escreve neste FBO é
    // `RawShaderMaterial`, cru por definição), e marcar um dos dois
    // enganaria quem ler o código achando que há conversão automática em
    // algum lugar. Ver a nota de espaço de cor no topo de `grade.ts`.
    colorSpace: NoColorSpace,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    generateMipmaps: false,
    // Compartilhado entre todas as seções: `campo` e `catalogo` usam
    // profundidade para ocluir a própria geometria, e cada `render()`
    // scissored já limpa a fatia de depth que usa (regra do `autoClear`).
    depthBuffer: true,
    stencilBuffer: false,
    samples: 0,
  });

  const gradeUniforms: GradeUniforms = {
    uScene: { value: target.texture },
    uTexelSize: { value: new Vector2(1, 1) },
    // `settings.bloomLevels` continua o número que o tier decide (regra dura
    // do tier: só números mudam, nunca caminho de código) — aqui vira só um
    // portão liga/desliga porque o bloom inline é um único passe, não uma
    // cadeia de níveis.
    uBloomEnabled: { value: settings.bloomLevels > 0 ? 1 : 0 },
    uBloomIntensity: { value: BLOOM_INTENSITY },
    uBloomThreshold: { value: BLOOM_THRESHOLD },
    uBloomKnee: { value: BLOOM_KNEE },
    uFilmicStrength: { value: FILMIC_STRENGTH },
    uVignetteStrength: { value: VIGNETTE_STRENGTH },
    uGrainAmount: { value: GRAIN_AMOUNT },
    uGrainSeed: { value: 0 },
  };
  const gradeMaterial = new RawShaderMaterial({
    vertexShader: vertex,
    fragmentShader: gradeFragment,
    glslVersion: GLSL3,
    depthTest: false,
    depthWrite: false,
    uniforms: gradeUniforms,
  });
  const gradeScene = new Scene();
  gradeScene.add(createFullscreenMesh(gradeMaterial));
  const gradeCamera = new OrthographicCamera();

  function resize(size: GLSize): void {
    const width = Math.max(MIN_TARGET_PX, Math.round(size.w * size.dpr));
    const height = Math.max(MIN_TARGET_PX, Math.round(size.h * size.dpr));
    target.setSize(width, height);
    // Base dos taps do bloom inline (`grade.ts`): raios em fração de tela,
    // multiplicados por este texel dentro do shader.
    gradeUniforms.uTexelSize.value.set(1 / width, 1 / height);
  }

  const stopResize = host.onResize(resize);
  resize(host.size);

  function drawScreen(): void {
    const { w, h } = host.size;
    renderer.setRenderTarget(null);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
    renderer.render(gradeScene, gradeCamera);
  }

  return {
    target,

    beginFrame(): void {
      renderer.setRenderTarget(target);
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, host.size.w, host.size.h);
      // Única exceção à regra "nenhum clear global" (ver o comentário do
      // módulo): substitui o clear implícito que o backbuffer fazia de
      // graça, e só pode existir uma vez, aqui, antes de qualquer seção.
      renderer.clear(true, true, false);
    },

    setScissorCss(xCss: number, yCss: number, widthCss: number, heightCss: number): void {
      // `target.scissor`/`.viewport` vivem em px do FBO (device px), nunca em
      // px CSS — ao contrário de `renderer.setScissor()`, que multiplica por
      // conta própria. É o próprio `WebGLRenderTarget` quem lê isto, então a
      // conversão mora aqui, uma vez, e não em cada seção que chama isto.
      const dpr = host.size.dpr;
      target.scissorTest = true;
      target.scissor.set(
        Math.round(xCss * dpr),
        Math.round(yCss * dpr),
        Math.round(widthCss * dpr),
        Math.round(heightCss * dpr),
      );
    },

    present(elapsed: number, animateGrain: boolean): void {
      // Bloom inline: nenhuma cadeia para gerar antes do quad final — ver a
      // nota do módulo em `grade.ts`. `uBloomEnabled` já foi gravado na
      // criação a partir de `settings.bloomLevels` (regra do tier: só o
      // número muda, não o caminho de código).
      // Sob `prefers-reduced-motion` a semente fica cravada: grão animado é
      // exatamente o movimento que a preferência pede para não existir. A
      // imagem parada continua correta — só deixa de mudar quadro a quadro.
      gradeUniforms.uGrainSeed.value = animateGrain ? elapsed : 0;
      drawScreen();
    },

    dispose(): void {
      stopResize();
      target.dispose();
      gradeMaterial.dispose();
      gradeScene.clear();
      renderer.setRenderTarget(null);
    },
  };
}
