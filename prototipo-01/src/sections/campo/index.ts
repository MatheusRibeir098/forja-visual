import { Color } from 'three';
import { DEFAULT_DAMP, createDamped } from '@/engine';
import { buildMarkup } from './markup';
import { CAMERA_FOV, createCampoScene } from './scene';
import { loadHull, loadPoints } from './payload';
import type { Engine } from '@/engine';
import type { FreeRect } from './scene';
import './style.css';

/**
 * Seção "Campo" — um crânio humano como nuvem de pontos aditiva, desenhada
 * atrás de uma malha invisível de si mesmo que só escreve profundidade.
 *
 * É a técnica V.1 do catálogo em produção, e é a única seção do protótipo com
 * **geometria e câmera de verdade**: as outras oito técnicas são planos com
 * shader. O que se vê aqui não é um efeito aplicado a uma imagem, é um objeto.
 *
 * ## O que move o quê
 *
 * - **Scroll (V.2)** gira o crânio. A janela vem de um beat ancorado no DOM,
 *   não de um `at: 0.36` cravado: acrescentar um parágrafo acima desta seção
 *   não desalinha nada.
 * - **Cursor (V.4)** abre a nuvem. A repulsão é medida contra o raio do cursor
 *   em view space, então todo ponto sob ele responde, em qualquer profundidade.
 * - **Damping assimétrico (V.3)** amortece os dois. Rápido enquanto persegue,
 *   macio ao assentar.
 *
 * Não há nada além disso. Sem órbita automática, sem respiração, sem `uTime` no
 * shader: um quadro em que o usuário não fez nada é um quadro em que nada
 * mudou. É essa a razão de o ticker em `demand` (sob `prefers-reduced-motion`)
 * ser correto aqui por construção, e não por um `if` no fim.
 *
 * ## Como a seção divide o canvas com as outras
 *
 * O canvas é um só, fixo atrás do documento inteiro — mas quem desenha não
 * escreve nele direto: escreve no FBO de página (`gl.frame.target`,
 * `engine/frame.ts`), que `main.ts` compõe na tela uma vez só, no fim do
 * quadro. Esta seção desenha apenas dentro do retângulo do próprio palco, via
 * `setScissor`, e devolve o estado do renderer ao sair — o mesmo contrato que
 * as outras seções seguem. `setScissor` continua certo aqui (ao contrário do
 * hero e da F2): esta seção nunca troca de render target, então o recorte
 * solto do renderer não é pisado por ninguém — o FBO já está ligado quando
 * este `draw()` roda.
 */

const POINTS_URL = '/points/skull-points.bin';
const HULL_URL = '/points/skull-hull.bin';

/**
 * Cor de limpeza da faixa. **Tem que ser igual a `--campo-void`** em
 * `style.css`: é a mesma superfície vista por dois sistemas, e uma diferença de
 * um degrau desenha uma linha na borda do recorte.
 */
const CLEAR_COLOR_HEX = '#08080b';

const TAU = Math.PI * 2;

/**
 * Pose de repouso: três quartos, virado para a esquerda de quem olha.
 *
 * O modelo é exportado com a face em +Z, então um yaw de zero mostraria o
 * crânio de frente — a pose mais simétrica e a que menos informa sobre volume.
 * −0,62 rad (~35°) é o três quartos clássico do retrato: mostra a órbita, o
 * arco zigomático e a linha da mandíbula ao mesmo tempo, que é o conjunto pelo
 * qual o objeto é reconhecido antes de ser lido.
 */
const BASE_YAW = -0.62;

/**
 * Voltas que o scroll dá no objeto ao longo da janela presa.
 *
 * 1 volta inteira, de propósito (pedido do dono): o crânio sai do três quartos
 * de repouso, passa pelo perfil, pelas costas, pelo perfil oposto e volta a
 * encarar o visitante exatamente na pose em que começou. É a periodicidade de
 * `rotation.y` (2π ≡ 0 rad) que fecha o giro sem salto — `BASE_YAW + 1·TAU` é
 * o mesmo ângulo visual que `BASE_YAW`, então o quadro final é indistinguível
 * do primeiro sem precisar de nenhum caso especial no fecho.
 *
 * O enquadramento não muda: `scene.frame` mede pela esfera envolvente (ver
 * `scene.ts`), que por construção já era independente de pose — a volta
 * completa só visita ângulos que a conta já cobria. O prepass também não muda:
 * `measureOcclusion` em `scripts/build-points.ts` já varre os 24 passos por
 * um círculo de 2π inteiro, não pela janela de scroll, então a taxa de
 * descarte medida (53,7% média, 51,0–56,5%) já era a do percurso completo.
 */
const SCROLL_TURNS = 1;

/**
 * Damping do giro, em radianos.
 *
 * `DEFAULT_DAMP.reachDistance` vale 0,25, dimensionado para valores em torno de
 * 1; aqui o valor é ângulo, e um ajuste fino de scroll move ~0,1 rad enquanto
 * uma travessia move mais de 1. 0,4 rad (~23°) é onde a taxa rápida entra: a
 * roda do mouse continua macia, o arrasto longo da barra não fica para trás.
 */
const YAW_DAMP = { settle: 3.4, reach: 10, reachDistance: 0.4 };

/**
 * Entrada da nuvem quando o binário chega.
 *
 * `DEFAULT_DAMP` levaria ~0,25 s, que lê como o objeto aparecendo pronto — o
 * "fade-up genérico" que a spec §6 reprova. Estes λ dão ~1 s de subida, com o
 * fim macio de algo que assenta em vez de aterrissar.
 */
const FADE_DAMP = { settle: 2.2, reach: 3.4, reachDistance: 0.6 };

/**
 * Entrada e saída da influência do cursor. Assimétrica de propósito: entra em
 * ~0,2 s (o gesto tem que responder) e sai devagar, para a nuvem se fechar
 * sozinha em vez de estalar de volta quando o ponteiro deixa a janela.
 */
const POINTER_DAMP = { settle: 2.6, reach: 12, reachDistance: 0.3 };

/**
 * Quanto da faixa precisa sobrar ao lado da coluna para valer a pena empurrar o
 * objeto para o lado. Abaixo de 45% da largura, as duas metades ficam apertadas
 * e o enquadramento volta a ser centrado — que é o caso empilhado, em celular.
 */
const SIDE_BY_SIDE_MIN_FRACTION = 0.45;

/** Menor lado aceito nas contas de layout — evita divisão por zero no boot. */
const MIN_SIZE_PX = 1;

/**
 * Margem do observador que dispara o download. Meia tela de antecedência: os
 * dois binários somam ~196 KB e chegam antes de a seção aparecer, sem sair do
 * caminho lazy nem entrar no orçamento do primeiro paint.
 */
const LOAD_ROOT_MARGIN = '50% 0px';

/**
 * Y de um retângulo CSS (origem em cima) no sistema do WebGL (origem embaixo),
 * que é o que `setViewport`/`setScissor` esperam.
 */
function toGlBottom(topPx: number, heightPx: number, canvasHeightPx: number): number {
  return canvasHeightPx - (topPx + heightPx);
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function mountSection(root: HTMLElement, engine: Engine): void {
  const { gl, ticker, beats, pointer, reducedMotion } = engine;
  const { renderer } = gl;

  const { stage, copy } = buildMarkup(root);
  const scene = createCampoScene(gl.tier);

  const clearColor = new Color(CLEAR_COLOR_HEX);
  const previousClearColor = new Color();

  /**
   * Aspecto do palco (não o da janela), calculado no enquadramento e reafirmado
   * na câmera do ponteiro a cada quadro — ver `updatePointer`.
   */
  let cameraAspect = 1;

  /** Altura da seção inteira e do palco, em px. Medidas por resize, não por quadro. */
  let sectionHeight = 1;
  let stageHeight = 1;

  /**
   * A faixa livre: o pedaço do palco que a coluna de texto não cobre. É onde o
   * crânio é enquadrado — e é medido, e não cravado, porque a largura da coluna
   * muda com a viewport, com a fonte e com o comprimento do texto.
   */
  function readFreeRect(stageWidth: number): FreeRect {
    const copyWidth = copy.getBoundingClientRect().width;
    const beside = stageWidth - copyWidth;
    if (beside < stageWidth * SIDE_BY_SIDE_MIN_FRACTION) {
      return { x: 0, y: 0, width: stageWidth, height: stageHeight };
    }
    return { x: copyWidth, y: 0, width: beside, height: stageHeight };
  }

  function applyViewport(): void {
    // Uma leitura de layout por resize, nunca por quadro: as alturas dependem
    // de fonte, quebra de linha e da barra dinâmica do celular, então cravá-las
    // daria certo só nesta viewport.
    sectionHeight = Math.max(root.getBoundingClientRect().height, MIN_SIZE_PX);
    const stageRect = stage.getBoundingClientRect();
    stageHeight = Math.max(stageRect.height, MIN_SIZE_PX);
    const stageWidth = Math.max(stageRect.width, MIN_SIZE_PX);

    scene.uniforms.uPixelRatio.value = gl.size.dpr;
    cameraAspect = scene.frame({
      widthPx: stageWidth,
      heightPx: stageHeight,
      free: readFreeRect(stageWidth),
    });
  }

  applyViewport();
  gl.onResize(() => {
    applyViewport();
    ticker.invalidate();
  });
  // A coluna encolhe quando a Instrument Serif substitui a fonte de fallback;
  // sem remedir, o enquadramento fica preso à métrica errada.
  void document.fonts.ready.then(() => {
    applyViewport();
    ticker.invalidate();
  });

  const beat = beats.register(root, { start: 'enter', end: 'exit' });

  const yaw = createDamped(BASE_YAW, YAW_DAMP);
  const rayX = createDamped(0, DEFAULT_DAMP);
  const rayY = createDamped(0, DEFAULT_DAMP);
  const fade = createDamped(0, FADE_DAMP);
  const strength = createDamped(0, POINTER_DAMP);

  scene.spin.rotation.y = BASE_YAW;

  let loadStarted = false;
  function startLoad(): void {
    if (loadStarted) return;
    loadStarted = true;
    void Promise.all([loadPoints(POINTS_URL), loadHull(HULL_URL)])
      .then(([points, hull]) => {
        scene.attach(points, hull);
        applyViewport();
        // Em `demand` ninguém agendaria o quadro em que a nuvem apareceria.
        ticker.invalidate();
      })
      .catch((error: unknown) => {
        // A seção continua legível sem o objeto: o texto é DOM e a faixa é uma
        // chapa de carvão. Falhar em silêncio é que não serve.
        console.error('forja/campo: não foi possível carregar a nuvem de pontos', error);
      });
  }

  // Lazy de verdade: os binários só são pedidos quando a seção está a meia tela
  // de distância. Nada disso entra no caminho crítico.
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        startLoad();
        observer.disconnect();
      }
    },
    { rootMargin: LOAD_ROOT_MARGIN },
  );
  observer.observe(root);

  function draw(stageTop: number): void {
    const canvasHeight = gl.size.h;
    const bottom = toGlBottom(stageTop, stageHeight, canvasHeight);
    renderer.getClearColor(previousClearColor);
    const previousClearAlpha = renderer.getClearAlpha();

    renderer.setScissorTest(true);
    renderer.setScissor(0, bottom, gl.size.w, stageHeight);
    renderer.setViewport(0, bottom, gl.size.w, stageHeight);
    renderer.setClearColor(clearColor, 1);
    // Cena única, sem transição: o composite (dois render targets + um quad)
    // seria custo puro aqui — é o "quando não usar" da própria técnica I.1.
    renderer.render(scene.scene, scene.camera);

    renderer.setClearColor(previousClearColor, previousClearAlpha);
    renderer.setScissorTest(false);
    // Devolve o canvas inteiro a quem desenhar depois sem definir viewport.
    renderer.setViewport(0, 0, gl.size.w, canvasHeight);
  }

  function updatePointer(dt: number): void {
    // Sob movimento reduzido o ticker está em `demand` e só acorda com scroll:
    // um alvo de cursor aqui ficaria preso no valor do último gesto de rolagem.
    // A nuvem simplesmente não responde ao ponteiro, e continua respondendo ao
    // scroll, que é o movimento que o usuário comanda diretamente.
    // `pointer.setCamera` é estado global do motor: o raio depende do fov e do
    // aspecto da câmera de quem o lê, e outra seção pode tê-lo mudado no último
    // resize. Reafirmar aqui, no quadro em que o raio é lido, faz a ordem de
    // montagem parar de importar — custa um `tan`.
    pointer.setCamera(CAMERA_FOV, cameraAspect);

    const active = pointer.active && !reducedMotion;
    strength.target = active ? 1 : 0;
    if (active) {
      rayX.target = pointer.ray.x;
      rayY.target = pointer.ray.y;
    }
    if (reducedMotion) {
      strength.value = strength.target;
    } else {
      strength.update(dt);
      rayX.update(dt);
      rayY.update(dt);
    }
    scene.uniforms.uPointerRay.value.set(rayX.value, rayY.value);
    scene.uniforms.uPointerStrength.value = strength.value;
  }

  ticker.subscribe((dt) => {
    const { progress } = beat;
    // Fora da janela do beat a seção não tem um pixel na tela.
    if (progress <= 0 || progress >= 1) return;

    // Usar a altura do canvas (e não `innerHeight`) mantém o quadro livre de
    // leitura de layout; o canvas é `position: fixed; inset: 0`, então os dois
    // só divergem pela barra de rolagem horizontal, que esta página não tem.
    const canvasHeight = gl.size.h;

    // Posição da seção reconstruída a partir do progresso: em `enter`→`exit`,
    // o topo vai de +altura da viewport até −altura da seção, linearmente.
    const flowTop = canvasHeight - progress * (canvasHeight + sectionHeight);
    // `position: sticky; top: 0` em forma fechada: preso em 0 enquanto couber,
    // empurrado pelo fundo do bloco quando não couber mais. Reconstruir isto é
    // o que evita um `getBoundingClientRect` por quadro.
    const stageTop = Math.min(Math.max(0, flowTop), flowTop + sectionHeight - stageHeight);
    if (stageTop + stageHeight <= 0 || stageTop >= canvasHeight) return;

    // Fração do tempo em que o palco fica preso — é ela, e não o progresso da
    // seção inteira, que corresponde ao gesto de "girar o objeto parado".
    const pinned = clamp01(-flowTop / Math.max(sectionHeight - stageHeight, MIN_SIZE_PX));
    yaw.target = BASE_YAW + pinned * SCROLL_TURNS * TAU;
    fade.target = scene.ready ? 1 : 0;

    if (reducedMotion) {
      // Em `demand` o dt é o intervalo entre gestos, não entre quadros:
      // integrar aqui produziria um arrastão a cada scroll.
      yaw.value = yaw.target;
      fade.value = fade.target;
    } else {
      yaw.update(dt);
      fade.update(dt);
    }
    updatePointer(dt);

    scene.spin.rotation.y = yaw.value;
    scene.uniforms.uFade.value = fade.value;

    draw(stageTop);
  });
}
