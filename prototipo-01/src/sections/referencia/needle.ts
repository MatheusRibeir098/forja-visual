/**
 * F3 — mapeamento entre "quantos fatores já chegaram ao centro da tela" e a
 * posição do indicador na trilha, em 0–1.
 *
 * Módulo puro de propósito: é o pedaço da seção que o critério de aceite mede
 * (salto de 2 telas → 10% do gap em ≤ 0,35 s), e medir isso num teste exige
 * poder simular a geometria sem DOM nem WebGL.
 */

/**
 * Meio segmento de recuo. Cada fator ocupa uma fatia `1/count` da trilha e o
 * marcador dele mora no **centro** da fatia; o beat de um bloco, porém, só
 * satura quando ele chega ao centro da tela — ou seja, no fim da fatia. Sem
 * este meio passo a agulha pararia sempre meia fatia adiante do marcador que
 * está indicando.
 */
const HALF_SEGMENT = 0.5;

/** Posição do marcador do fator `index` (0-based) na trilha, em 0–1. */
export function needleAt(index: number, count: number): number {
  if (count <= 0) return 0;
  return (index + HALF_SEGMENT) / count;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Alvo da agulha a partir da soma dos beats de chegada dos blocos.
 *
 * `arrivedSum` é `Σ progress` de cada bloco medido de "entrou pelo rodapé" a
 * "centro do bloco no centro da tela". Como cada parcela é monótona no scroll,
 * a soma também é — e o alvo nunca anda para trás enquanto o usuário desce.
 */
export function computeNeedleTarget(arrivedSum: number, count: number): number {
  if (count <= 0) return 0;
  return clamp01((arrivedSum - HALF_SEGMENT) / count);
}

/**
 * Índice do fator que a agulha está indicando. É a fatia em que ela caiu, e não
 * "o beat mais próximo de 1": durante a perseguição a agulha ainda está atrás
 * do scroll, e quem manda no destaque é ela, não o alvo.
 */
export function activeIndexAt(needle: number, count: number): number {
  if (count <= 0) return 0;
  const slice = Math.floor(needle * count);
  return Math.min(count - 1, Math.max(0, slice));
}
