/**
 * V.4 — Cursor como raio, não como ponto.
 *
 * Medir repulsão pela distância 3D até um ponto do cursor só afeta a fatia de
 * geometria que está perto daquele plano de profundidade — o resto da cena
 * ignora o mouse. A correção é guardar a *direção* do cursor em view space já
 * dividida pela profundidade: multiplicada pelo `z` de um ponto, ela diz por
 * onde o raio passa naquela profundidade, e o `z` se cancela.
 *
 *   pointerOffset = mvPosition.xy + uPointerRay * mvPosition.z
 *
 * Atenção ao sinal: em view space do three a câmera olha para −z, então um
 * ponto sobre o raio na profundidade `d` tem `mv.xy = ray * d` e `mv.z = −d`.
 * O que cancela a profundidade é a **soma** (`ray*d + ray*(−d) = 0`); com
 * subtração o termo dobra em vez de sumir. A anotação original da técnica traz
 * `−` porque assume `ray` já negado no uniform — aqui `ray` é a direção crua,
 * igual à sua documentação, e o sinal fica no shader.
 *
 * Módulo puro: sem WebGL, sem three. Só escuta eventos de ponteiro.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 extends Vec2 {
  z: number;
}

export interface Pointer {
  /** Coordenadas normalizadas do dispositivo, −1..1 (y para cima). */
  readonly ndc: Readonly<Vec2>;
  /** Direção do cursor em view space já dividida por z. */
  readonly ray: Readonly<Vec2>;
  /** `false` quando não há cursor (touch) ou ele saiu do alvo. */
  readonly active: boolean;
  /** Velocidade do cursor em unidades NDC por segundo, com decaimento. */
  readonly velocity: Readonly<Vec2>;
  /** Informa a câmera atual — o raio depende de fov e aspect. */
  setCamera(fovDeg: number, aspect: number): void;
  dispose(): void;
}

/**
 * Espelho em JS do snippet GLSL, para testes e cálculos em CPU. Devolve o vetor
 * do raio do cursor até o ponto, na própria profundidade do ponto — mesmo valor
 * em z = −1 e em z = −10.
 */
export function pointerOffset(mv: Vec3, ray: Vec2): Vec2 {
  return { x: mv.x + ray.x * mv.z, y: mv.y + ray.y * mv.z };
}

/** Fonte única do cálculo: o shader e `pointerOffset` usam exatamente esta conta. */
export const POINTER_RAY_GLSL =
  'vec2 pointerOffset(vec3 mv, vec2 ray) { return mv.xy + ray * mv.z; }';

/** Fov de partida, só para o raio existir antes da primeira cena; `setCamera` sobrescreve. */
const DEFAULT_FOV_DEG = 50;

/**
 * Menor Δt aceito no cálculo de velocidade. 1/240 s cobre mouses de 240 Hz;
 * abaixo disso a divisão vira ruído amplificado.
 */
const MIN_VELOCITY_DT = 1 / 240;

/**
 * Acima de 100 ms sem evento o gesto acabou — o próximo `pointermove` é um
 * salto, não movimento contínuo, e não deve virar velocidade gigante.
 */
const MAX_VELOCITY_DT = 0.1;

/**
 * Peso da amostra nova na velocidade. 0,35 foi o ponto em que o vetor parou de
 * tremer entre frames sem atrasar visivelmente a resposta ao gesto.
 */
const VELOCITY_SMOOTHING = 0.35;

/**
 * λ de decaimento da velocidade em repouso: em 1 s cai a ~0,2 % do pico, o que
 * apaga o rastro antes do próximo gesto sem cortá-lo bruscamente.
 */
const VELOCITY_DECAY = 6;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function getTargetRect(target: EventTarget): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  if (target instanceof Element) {
    const rect = target.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }
  return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
}

export function createPointer(target: EventTarget = window): Pointer {
  const ndc: Vec2 = { x: 0, y: 0 };
  const ray: Vec2 = { x: 0, y: 0 };
  const rawVelocity: Vec2 = { x: 0, y: 0 };
  /** Reusado a cada leitura: evita alocar um objeto por frame. */
  const decayedVelocity: Vec2 = { x: 0, y: 0 };

  let active = false;
  let tanHalfFov = Math.tan(toRadians(DEFAULT_FOV_DEG) / 2);
  let aspectRatio = 1;
  let lastMoveTime = 0;
  let hasPreviousSample = false;
  let disposed = false;

  function updateRay(): void {
    ray.x = tanHalfFov * aspectRatio * ndc.x;
    ray.y = tanHalfFov * ndc.y;
  }

  function resetVelocity(): void {
    rawVelocity.x = 0;
    rawVelocity.y = 0;
    hasPreviousSample = false;
  }

  /** Chame antes de escrever o novo NDC — usa o valor anterior como origem. */
  function updateVelocity(nextX: number, nextY: number, now: number): void {
    const elapsed = (now - lastMoveTime) / 1000;
    const isNewGesture = !hasPreviousSample || elapsed > MAX_VELOCITY_DT;
    lastMoveTime = now;
    hasPreviousSample = true;
    if (isNewGesture) {
      rawVelocity.x = 0;
      rawVelocity.y = 0;
      return;
    }
    const dt = Math.max(elapsed, MIN_VELOCITY_DT);
    const sampleX = (nextX - ndc.x) / dt;
    const sampleY = (nextY - ndc.y) / dt;
    rawVelocity.x += (sampleX - rawVelocity.x) * VELOCITY_SMOOTHING;
    rawVelocity.y += (sampleY - rawVelocity.y) * VELOCITY_SMOOTHING;
  }

  function handleMove(event: Event): void {
    if (!(event instanceof PointerEvent)) return;
    if (event.pointerType === 'touch') {
      // Touch não tem hover: a cena usa órbita automática em vez do raio.
      active = false;
      resetVelocity();
      return;
    }
    const rect = getTargetRect(target);
    if (rect.width === 0 || rect.height === 0) return;
    const nextX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const nextY = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    updateVelocity(nextX, nextY, performance.now());
    ndc.x = nextX;
    ndc.y = nextY;
    active = true;
    updateRay();
  }

  function handleLeave(): void {
    active = false;
    resetVelocity();
  }

  updateRay();
  target.addEventListener('pointermove', handleMove, { passive: true });
  target.addEventListener('pointerleave', handleLeave);
  target.addEventListener('pointercancel', handleLeave);

  return {
    ndc,
    ray,
    get active(): boolean {
      return active;
    },
    get velocity(): Readonly<Vec2> {
      const idle = (performance.now() - lastMoveTime) / 1000;
      const factor = idle > 0 ? Math.exp(-VELOCITY_DECAY * idle) : 1;
      decayedVelocity.x = rawVelocity.x * factor;
      decayedVelocity.y = rawVelocity.y * factor;
      return decayedVelocity;
    },
    setCamera(fovDeg: number, aspect: number): void {
      if (!Number.isFinite(fovDeg) || fovDeg <= 0 || fovDeg >= 180) {
        throw new RangeError(`createPointer.setCamera: fov inválido (${fovDeg})`);
      }
      if (!Number.isFinite(aspect) || aspect <= 0) {
        throw new RangeError(`createPointer.setCamera: aspect inválido (${aspect})`);
      }
      tanHalfFov = Math.tan(toRadians(fovDeg) / 2);
      aspectRatio = aspect;
      updateRay();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      target.removeEventListener('pointermove', handleMove);
      target.removeEventListener('pointerleave', handleLeave);
      target.removeEventListener('pointercancel', handleLeave);
      active = false;
    },
  };
}
