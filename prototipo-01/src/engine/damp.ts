/**
 * V.3 — Damping assimétrico.
 *
 * Uma taxa única de suavização não consegue ser as duas coisas que a interface
 * precisa: rápida enquanto persegue um alvo distante e macia ao assentar. A
 * solução é fazer a taxa depender da *distância até o alvo* — longe usa `reach`,
 * perto usa `settle`, com transição suave (smoothstep) entre as duas.
 *
 * Módulo puro: sem DOM, sem WebGL, sem three.
 */

export interface DampOptions {
  /** λ baixo, usado quando o alvo já está perto — dá o assentamento macio. */
  settle: number;
  /** λ alto, usado quando o alvo está longe — dá a perseguição rápida. */
  reach: number;
  /** Gap (em unidades do valor) a partir do qual a taxa já é `reach` cheio. */
  reachDistance: number;
}

export interface Damped {
  /** Valor atual. Mutável de propósito: é lido a 60 fps sem alocar. */
  value: number;
  /** Alvo perseguido. Escreva aqui; `update` faz o resto. */
  target: number;
  /** Avança `value` em `dt` segundos e devolve o novo valor. */
  update(dt: number): number;
}

/**
 * Defaults medidos no portfólio 3D que originou a técnica: com λ único de 4 uma
 * troca de lado (gap ≈ 2 × reachDistance) levava 0,90 s até parecer parada; com
 * este par assimétrico o mesmo movimento caiu para 0,27 s, sem overshoot.
 */
export const DEFAULT_DAMP: DampOptions = {
  settle: 4,
  reach: 14,
  reachDistance: 0.25,
};

/** Interpolação linear simples. */
function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Smoothstep de Hermite (3t² − 2t³) com clamp nas bordas. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const span = edge1 - edge0;
  if (span === 0) return x < edge0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - edge0) / span));
  return t * t * (3 - 2 * t);
}

/**
 * Taxa de suavização para um gap. Exportada porque os testes e o painel de
 * debug precisam inspecionar a assimetria sem simular o passo inteiro.
 */
export function dampingRate(gap: number, options: DampOptions): number {
  const normalizedGap = options.reachDistance > 0 ? Math.abs(gap) / options.reachDistance : 1;
  return lerp(options.settle, options.reach, smoothstep(0, 1, normalizedGap));
}

/**
 * Um passo de damping exponencial.
 *
 * O fator é `1 - exp(-λ·dt)`, e não um `lerp(current, target, 0.1)` por frame:
 * esta é a forma fechada da EDO `dx/dt = λ·(target - x)` (o mesmo cálculo de
 * `MathUtils.damp` do three). Por ser função de `dt` em segundos, o resultado é
 * idêntico a 30, 60 ou 144 fps — um lerp de fator fixo, não: ele anda mais
 * rápido em telas mais rápidas.
 *
 * O fator nunca passa de 1, então o valor jamais ultrapassa o alvo (sem
 * overshoot) para qualquer `dt` positivo.
 */
export function damp(current: number, target: number, dt: number, options: DampOptions): number {
  if (dt <= 0) return current;
  const gap = target - current;
  if (gap === 0) return target;
  const lambda = dampingRate(gap, options);
  return current + gap * (1 - Math.exp(-lambda * dt));
}

/** Cria um valor amortecido com estado próprio. */
export function createDamped(initial: number, options: DampOptions = DEFAULT_DAMP): Damped {
  const damped: Damped = {
    value: initial,
    target: initial,
    update(dt: number): number {
      damped.value = damp(damped.value, damped.target, dt, options);
      return damped.value;
    },
  };
  return damped;
}
