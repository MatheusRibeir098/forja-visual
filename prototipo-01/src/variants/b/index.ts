import { Vector2 } from 'three';
import { createDamped } from '@/engine';
import { DEFAULT_LIGHT_INTENSITY } from '@/shaders/relight';
import { createOverlay } from './overlay';
import { CAMERA_FOV, createRelightPlane } from './relightPlane';
import type { Damped, Engine } from '@/engine';
import './style.css';

/**
 * Variante B do hero — **"Bigorna"**.
 *
 * A palavra FORJA está cravada numa chapa de metal escuro em tela cheia, e a
 * única fonte de luz é uma brasa que segue o cursor. Nada mais tem cor. O
 * relevo não é geometria: é o campo de altura do asset, relit por fragmento
 * (técnica IV.1), com a luz posicionada onde o raio do cursor cruza a chapa
 * (técnica V.4).
 *
 * O gesto de scroll é a martelada: a brasa pulsa e volta.
 */

export interface HeroHandle {
  dispose(): void;
}

/**
 * Órbita automática para quando não há cursor (touch, ou o ponteiro saiu da
 * janela). Nunca existe um quadro sem luz — a chapa apagada leria como bug.
 *
 * Elipse, e não círculo: em NDC o raio horizontal de 0.62 vale ~0.55 unidades
 * de campo numa tela 16:9 e o vertical de 0.34 vale ~0.17, então a luz **rasa a
 * palavra na horizontal**, que é a direção em que os biséis das letras têm mais
 * o que mostrar. O centro sobe um pouco: luz vinda de cima é a leitura natural.
 */
const ORBIT_PERIOD_S = 9;
const ORBIT_CENTER_X = 0.1;
const ORBIT_CENTER_Y = 0.15;
const ORBIT_RADIUS_X = 0.62;
const ORBIT_RADIUS_Y = 0.34;

/**
 * Posição fixa sob `prefers-reduced-motion`, em NDC.
 *
 * Três quartos à direita e acima: fora do centro, porque luz centrada achata o
 * relevo (as duas faces de cada letra recebem o mesmo ângulo) e é justamente o
 * contraste entre elas que faz a palavra existir.
 */
const RESTING_NDC_X = 0.5;
const RESTING_NDC_Y = 0.45;

/**
 * Martelada. O gesto de scroll injeta energia 1 e ela decai
 * exponencialmente: λ 5.2 leva a ~6% em 0.55 s, então o pulso acaba antes de o
 * usuário terminar o gesto — é uma batida, não um efeito ligado.
 */
const STRIKE_DECAY = 5.2;
/** Pico de +45% na intensidade. Acima disso a chapa estoura e vira flash. */
const STRIKE_GAIN = 0.45;
/** Um martelo não bate 60 vezes por segundo. 260 ms é o teto de recarga. */
const STRIKE_MIN_INTERVAL_MS = 260;

/**
 * Acendimento da brasa quando as texturas chegam.
 *
 * `DEFAULT_DAMP` levaria ~0.25 s, que lê como a chapa aparecendo pronta. Estes
 * λ dão ~1 s de subida com o fim macio de um metal esquentando.
 */
const IGNITION_DAMP = { settle: 2.2, reach: 3.4, reachDistance: 0.6 };

const TAU = Math.PI * 2;
const HALF_FOV_RADIANS = (CAMERA_FOV * Math.PI) / 360;

/**
 * NDC → raio do cursor. É a mesma conta de `createPointer`, e ela precisa
 * existir aqui porque a órbita automática e a posição de repouso não passam por
 * evento de ponteiro nenhum — `pointer.ray` só se move quando há cursor.
 */
function writeRayFromNdc(ndcX: number, ndcY: number, aspect: number, out: Vector2): void {
  out.set(Math.tan(HALF_FOV_RADIANS) * aspect * ndcX, Math.tan(HALF_FOV_RADIANS) * ndcY);
}

function describeTechnique(samples: number): string {
  const march = samples > 0 ? `${samples} amostras` : 'só normais';
  return `IV.1 · relighting por depth map · ${march}`;
}

export function mountHero(root: HTMLElement, engine: Engine): HeroHandle {
  const { gl, ticker, pointer, reducedMotion } = engine;
  const { renderer } = gl;

  const plane = createRelightPlane({
    tierSamples: gl.settings.rayMarchSamples,
    onTextureReady: () => {
      // O tamanho real do depth só é conhecido depois do load, e em
      // `prefers-reduced-motion` o ticker está em `demand`: sem o invalidate
      // ninguém desenharia o primeiro quadro da chapa.
      applyViewport();
      ticker.invalidate();
    },
  });

  const overlay = createOverlay(describeTechnique(plane.samples));
  root.classList.add('hero-b-host');
  root.replaceChildren(overlay.element);

  /** Aspecto corrente da viewport — o raio do cursor depende dele. */
  let aspect = 1;

  function applyViewport(): void {
    // Uma leitura de layout por resize (não por quadro): as faixas têm altura
    // `auto` e mudam com fonte, idioma e quebra de linha, então enquadrar a
    // palavra com números fixos daria certo só nesta viewport.
    aspect = plane.resize(
      gl.size.w,
      gl.size.h,
      overlay.topBar.offsetHeight,
      overlay.bottomBar.offsetHeight,
    );
    // Sem isto o raio do cursor sai esticado em X assim que a janela deixa de
    // ser quadrada.
    pointer.setCamera(CAMERA_FOV, aspect);
  }

  applyViewport();
  const stopResize = gl.onResize(() => {
    applyViewport();
    ticker.invalidate();
  });

  // As faixas encolhem quando a Instrument Serif substitui a fonte de fallback;
  // sem remedir, o enquadramento fica preso à métrica errada.
  void document.fonts.ready.then(() => {
    applyViewport();
    ticker.invalidate();
  });

  // O alvo é o raio (e não o NDC) porque é ele que o shader consome e é ele que
  // `pointer` já entrega pronto. `DEFAULT_DAMP.reachDistance` vale 0.25 e a
  // meia-largura do raio numa tela 16:9 é ~0.83: a taxa rápida entra a partir
  // de ~30% de meia-tela, que é onde um movimento deixa de ser ajuste fino e
  // vira travessia.
  const rayX: Damped = createDamped(0);
  const rayY: Damped = createDamped(0);
  const ignition: Damped = createDamped(0, IGNITION_DAMP);
  const targetRay = new Vector2(0, 0);

  let strikeEnergy = 0;
  let lastStrikeAt = 0;

  function strike(): void {
    if (reducedMotion) return;
    const now = performance.now();
    if (now - lastStrikeAt < STRIKE_MIN_INTERVAL_MS) return;
    lastStrikeAt = now;
    strikeEnergy = 1;
  }

  window.addEventListener('wheel', strike, { passive: true });
  window.addEventListener('scroll', strike, { passive: true });

  function readTargetRay(elapsed: number): void {
    if (reducedMotion) {
      writeRayFromNdc(RESTING_NDC_X, RESTING_NDC_Y, aspect, targetRay);
      return;
    }
    if (pointer.active) {
      targetRay.set(pointer.ray.x, pointer.ray.y);
      return;
    }
    const angle = (elapsed / ORBIT_PERIOD_S) * TAU;
    writeRayFromNdc(
      ORBIT_CENTER_X + Math.cos(angle) * ORBIT_RADIUS_X,
      ORBIT_CENTER_Y + Math.sin(angle) * ORBIT_RADIUS_Y,
      aspect,
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
      strikeEnergy *= Math.exp(-STRIKE_DECAY * dt);
    }

    plane.uniforms.uPointerRay.value.set(rayX.value, rayY.value);
    plane.uniforms.uLightIntensity.value =
      DEFAULT_LIGHT_INTENSITY * ignition.value * (1 + strikeEnergy * STRIKE_GAIN);
  }

  const stopTicker = ticker.subscribe((dt, elapsed) => {
    updateLight(dt, elapsed);
    // Cena única, sem transição: o composite (dois render targets + quad) seria
    // custo puro aqui. É o "quando não usar" do I.1.
    renderer.render(plane.scene, plane.camera);
  });

  return {
    dispose(): void {
      stopTicker();
      stopResize();
      window.removeEventListener('wheel', strike);
      window.removeEventListener('scroll', strike);
      overlay.element.remove();
      root.classList.remove('hero-b-host');
      plane.dispose();
    },
  };
}
