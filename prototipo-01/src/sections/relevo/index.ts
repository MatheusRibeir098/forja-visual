import { createDamped } from '@/engine';
import {
  MIN_SIZE_PX,
  approachEase,
  ndcInsideRect,
  rayFromNdc,
  sectionTopFromProgress,
  toGlBottom,
} from './geometry';
import { createMarkup } from './markup';
import {
  BACKGROUND_HEX,
  LIGHT_INTENSITY,
  TAN_HALF_FOV,
  createReliefPlane,
} from './reliefPlane';
import type { Rect } from './geometry';
import type { Engine, Vec2 } from '@/engine';
import './style.css';

/**
 * F4 — **Relevo**. A técnica IV.1 em tamanho de seção.
 *
 * Uma imagem 2D com depth map é reacesa por fragmento: as normais saem do campo
 * de altura (a face virada para a luz clareia, a oposta escurece) e a sombra
 * dentro dos sulcos sai de um ray march até a luz. A luz é o **raio** do cursor
 * (V.4), resolvido na profundidade de cada fragmento — por isso ela continua no
 * lugar certo enquanto o espécime viaja em z ao atravessar a tela.
 *
 * ── COMO ESTA SEÇÃO CONVIVE COM AS OUTRAS NO MESMO CANVAS ──────────────────
 * O canvas é um só, fixo atrás do documento, e cada seção desenha no **seu**
 * retângulo: `scissor` no retângulo da seção (é ele que também limita o clear) e
 * `viewport` na faixa livre entre as duas barras de texto. Como as seções são
 * blocos empilhados, os retângulos são disjuntos por construção — duas seções
 * visíveis ao mesmo tempo não se apagam. No fim do quadro o viewport volta para
 * o canvas inteiro, para não sabotar quem desenha depois sem definir o seu.
 *
 * ── POR QUE NÃO HÁ UM ÚNICO `getBoundingClientRect` AQUI ───────────────────
 * O retângulo da seção é **derivado** do progresso do beat (que o `beats.ts`
 * mede uma vez por quadro, antes de qualquer escrita) mais a altura da seção,
 * que vem de um `ResizeObserver`. Ler layout dentro do callback do ticker seria
 * reflow forçado, porque as seções que rodam antes já escreveram no DOM.
 */

/**
 * Órbita automática para quando não há cursor (touch, ou o ponteiro saiu da
 * janela). Nunca existe um quadro sem luz — chapa apagada lê como bug.
 *
 * Elipse, e não círculo, e os raios vêm da geometria da faixa, não do hero: numa
 * faixa de 1280×405 px, NDC 1 vale 0.58 unidades de campo na vertical e 1.83 na
 * horizontal. Com 0.66 × 0.38 a luz varre ±1.21 de campo em x — passa dos dois
 * cantos do espécime, que tem 1.78 de largura — e só ±0.22 em y, ou seja **rasa**
 * a palavra em vez de sobrevoá-la: é rasante que o bisel tem o que mostrar. O
 * centro sobe um pouco porque luz vinda de cima é a leitura natural.
 *
 * Período de 9 s, herdado da órbita medida na variante B: a volta ainda lê como
 * movimento e não como piscada. Medido aqui: 2,6 s de órbita mudam o byte médio
 * do lado esquerdo do espécime de 63 para 69 e o do direito de 36 para 42.
 */
const ORBIT_PERIOD_S = 9;
const ORBIT_CENTER_X = 0.08;
const ORBIT_CENTER_Y = 0.18;
const ORBIT_RADIUS_X = 0.66;
const ORBIT_RADIUS_Y = 0.38;

/**
 * Posição fixa sob `prefers-reduced-motion`, em NDC da faixa. Fora do centro:
 * luz centrada dá o mesmo ângulo às duas faces de cada letra e achata o relevo,
 * e é justamente o contraste entre elas que faz a palavra existir.
 */
const RESTING_NDC_X = 0.5;
const RESTING_NDC_Y = 0.45;

/**
 * Acendimento da brasa quando as texturas chegam. `DEFAULT_DAMP` levaria
 * ~0,25 s, que lê como a chapa aparecendo pronta; estes λ dão ~1 s de subida,
 * com o fim macio de um metal esquentando.
 */
const IGNITION_DAMP = { settle: 2.2, reach: 3.4, reachDistance: 0.6 };

const TAU = Math.PI * 2;

/** Mobília da seção. Vai para `src/content` se outra seção precisar das mesmas. */
const LIGHT_MODE_LABELS = {
  pointer: 'A luz é o raio do cursor: mova o cursor sobre a seção.',
  orbit: 'Sem cursor: a luz percorre uma órbita lenta.',
  fixed: 'Movimento reduzido: a luz fica parada, o relevo continua.',
} as const;

type LightMode = keyof typeof LIGHT_MODE_LABELS;

function describeTechnique(samples: number): string {
  const march =
    samples > 0 ? `sombra por ray march, ${samples} amostras` : 'sem sombra projetada';
  return `Normais derivadas do depth · ${march}`;
}

export function mountSection(root: HTMLElement, engine: Engine): void {
  const { gl, ticker, beats, pointer, reducedMotion } = engine;
  const { renderer } = gl;

  // O markup nasce antes do plano: `onTextureReady` chama `measure()`, que lê as
  // duas faixas. Uma textura vinda do cache do three chega num `setTimeout(0)`,
  // e não durante a construção — mas depender dessa ordem seria um bug esperando
  // a próxima versão da biblioteca.
  const markup = createMarkup(describeTechnique(gl.settings.rayMarchSamples));
  root.classList.add('relevo-host');
  // Fonte única do carvão: as faixas de HTML e o clear do WebGL têm que ser o
  // mesmo hex, senão a junta entre os dois vira um degrau visível.
  root.style.setProperty('--relevo-plate', BACKGROUND_HEX);
  root.replaceChildren(markup.element);

  const plane = createReliefPlane({
    // Cru do tier: 8/4/0. Limitar de novo aqui faria a decisão existir em dois
    // lugares — foi o que aconteceu na variante B e o que `tier.ts` resolveu.
    samples: gl.settings.rayMarchSamples,
    onTextureReady: () => {
      // O tamanho real do depth só é conhecido depois do load, e em
      // `prefers-reduced-motion` o ticker está em `demand`: sem o invalidate
      // ninguém desenharia o primeiro quadro da chapa.
      measure();
      ticker.invalidate();
    },
  });

  const beat = beats.register(root, { start: 'enter', end: 'exit' });

  const initialMode: LightMode = reducedMotion ? 'fixed' : 'orbit';

  /** Retângulo da seção e da faixa livre, mutados no lugar (zero alocação/quadro). */
  const sectionRect: Rect = { x: 0, y: 0, width: 0, height: 0 };
  const bandRect: Rect = { x: 0, y: 0, width: 0, height: 0 };
  /** Aspecto da faixa: é ele que converte o NDC do cursor em raio (V.4). */
  let bandAspect = 1;
  /** Altura da barra de cima: distância entre o topo da seção e o da faixa. */
  let bandOffsetY = 0;

  function measure(): void {
    // Três leituras de layout por resize — nunca por quadro. As faixas têm
    // altura `auto` e mudam com fonte, idioma e quebra de linha, então
    // enquadrar com números fixos daria certo só nesta viewport.
    // `getBoundingClientRect` e não `offsetHeight` na seção: o beat mede com o
    // primeiro, e arredondar diferente aqui deslocaria o recorte em até 1 px.
    const topHeight = markup.topBar.offsetHeight;
    const bottomHeight = markup.bottomBar.offsetHeight;
    sectionRect.height = root.getBoundingClientRect().height;
    sectionRect.width = gl.size.w;

    // A faixa livre é o que sobra entre as duas barras: é ali que o espécime é
    // montado, e é por isso que ele nunca fica por baixo do texto.
    bandOffsetY = topHeight;
    bandRect.width = gl.size.w;
    bandRect.height = Math.max(sectionRect.height - topHeight - bottomHeight, MIN_SIZE_PX);
    bandAspect = plane.setBand(bandRect.width, bandRect.height);
  }

  measure();

  const observer = new ResizeObserver(() => {
    measure();
    ticker.invalidate();
  });
  observer.observe(root);
  // dpr e tamanho do canvas mudam sem que a seção mude de altura (zoom do
  // navegador, janela arrastada para outro monitor).
  gl.onResize(() => {
    measure();
    ticker.invalidate();
  });

  // O alvo é o raio, e não o NDC, porque é ele que o shader consome. Com
  // `DEFAULT_DAMP.reachDistance` em 0.25 e a meia-largura do raio numa faixa
  // 16:9 valendo ~0.83, a taxa rápida entra a partir de ~30% de meia-faixa:
  // ajuste fino continua fino, travessia continua rápida.
  const rayX = createDamped(0);
  const rayY = createDamped(0);
  const ignition = createDamped(0, IGNITION_DAMP);
  const targetRay: Vec2 = { x: 0, y: 0 };
  const bandNdc: Vec2 = { x: 0, y: 0 };
  // Começa no modo sem cursor: é o estado real até o primeiro `pointermove`, e
  // deixa o rótulo correto no HTML antes mesmo de a seção chegar à tela.
  let lightMode: LightMode = initialMode;
  markup.setLightMode(LIGHT_MODE_LABELS[initialMode]);

  function setLightMode(mode: LightMode): void {
    if (mode === lightMode) return;
    lightMode = mode;
    // Escrita rara (só na troca de modo), nunca por quadro.
    markup.setLightMode(LIGHT_MODE_LABELS[mode]);
  }

  function readTargetRay(elapsed: number): void {
    if (reducedMotion) {
      setLightMode('fixed');
      rayFromNdc(RESTING_NDC_X, RESTING_NDC_Y, bandAspect, TAN_HALF_FOV, targetRay);
      return;
    }
    if (pointer.active) {
      setLightMode('pointer');
      // O NDC global do cursor vira NDC **da faixa**: `pointer.setCamera` é
      // estado compartilhado do motor e ajustá-lo aqui faria esta seção brigar
      // com o hero pelo mesmo raio.
      ndcInsideRect(pointer.ndc, gl.size.w, gl.size.h, bandRect, bandNdc);
      rayFromNdc(bandNdc.x, bandNdc.y, bandAspect, TAN_HALF_FOV, targetRay);
      return;
    }
    setLightMode('orbit');
    const angle = (elapsed / ORBIT_PERIOD_S) * TAU;
    rayFromNdc(
      ORBIT_CENTER_X + Math.cos(angle) * ORBIT_RADIUS_X,
      ORBIT_CENTER_Y + Math.sin(angle) * ORBIT_RADIUS_Y,
      bandAspect,
      TAN_HALF_FOV,
      targetRay,
    );
  }

  function updateLight(dt: number, elapsed: number): void {
    readTargetRay(elapsed);
    rayX.target = targetRay.x;
    rayY.target = targetRay.y;
    ignition.target = plane.ready ? 1 : 0;

    if (reducedMotion) {
      // Em `demand` o dt é o intervalo entre gestos, não entre quadros:
      // integrar aqui produziria um arrastão a cada scroll. A luz simplesmente
      // já está onde tem que estar.
      rayX.value = rayX.target;
      rayY.value = rayY.target;
      ignition.value = ignition.target;
    } else {
      rayX.update(dt);
      rayY.update(dt);
      ignition.update(dt);
    }

    plane.uniforms.uPointerRay.value.set(rayX.value, rayY.value);
    plane.uniforms.uLightIntensity.value = LIGHT_INTENSITY * ignition.value;
  }

  function draw(): void {
    const canvasHeight = gl.size.h;
    renderer.setScissorTest(true);
    renderer.setScissor(
      sectionRect.x,
      toGlBottom(sectionRect.y, sectionRect.height, canvasHeight),
      sectionRect.width,
      sectionRect.height,
    );
    renderer.setViewport(
      bandRect.x,
      toGlBottom(bandRect.y, bandRect.height, canvasHeight),
      bandRect.width,
      bandRect.height,
    );
    // Cena única, sem transição: o composite (dois render targets + quad) seria
    // custo puro aqui. É o "quando não usar" da própria técnica I.1.
    renderer.render(plane.scene, plane.camera);
    renderer.setScissorTest(false);
    // Devolve o canvas inteiro a quem desenhar depois sem definir viewport.
    renderer.setViewport(0, 0, gl.size.w, canvasHeight);
  }

  ticker.subscribe((dt, elapsed) => {
    const { progress } = beat;
    // Fora da janela do beat a seção não tem um pixel na tela: não há o que
    // desenhar, e a luz continua exatamente onde parou.
    if (progress <= 0 || progress >= 1) return;

    // Usar a altura do canvas (e não `innerHeight`) mantém o quadro livre de
    // leitura de layout; o canvas é `position: fixed; inset: 0`, então os dois
    // só divergem pela barra de rolagem horizontal, que esta página não tem.
    sectionRect.y = sectionTopFromProgress(progress, sectionRect.height, gl.size.h);
    bandRect.y = sectionRect.y + bandOffsetY;

    plane.setApproach(approachEase(progress));
    updateLight(dt, elapsed);
    draw();
  });

  // Sem `dispose` no contrato: a seção vive enquanto a página vive, e o
  // `engine.dispose()` derruba renderer e ticker de uma vez. Um `pagehide` para
  // liberar GL cedo seria pior — ele também dispara ao entrar no bfcache, e a
  // seção voltaria morta na restauração.
}
