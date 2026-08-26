/// <reference lib="dom" />
// Estas funções são serializadas para dentro da página (page.evaluate), então precisam da
// lib DOM em cima do tsconfig de Node — declarada aqui em vez de alargar o projeto inteiro.

/**
 * Congelar e descongelar a página — o estado em que dois medidores fotografam.
 *
 * Mora aqui, e não dentro de um medidor, porque `measure-contrast` e `measure-variant`
 * precisam **do mesmo** estado congelado: se cada um tivesse a sua versão, dois números que
 * o orquestrador compara teriam sido tirados de páginas em condições diferentes — que é
 * exatamente o defeito que a fase de divergência existe para impedir.
 *
 * As duas são escritas como arrow de topo de módulo, sem função nomeada dentro: o tsx
 * compila com `keepNames` do esbuild, e uma função interna nomeada arrastaria um helper
 * `__name(...)` para o código enviado à página, onde ele não existe.
 */

/** Faixa de identificadores devolvida pelo `requestAnimationFrame` de mentira. */
const FROZEN_HANDLE_BASE = 1_000_000_000;

interface FrozenScope {
  __forgeRaf?: typeof requestAnimationFrame;
  __forgePaused?: Animation[];
  /** Quadros que o site pediu enquanto a página estava parada, na ordem em que pediu. */
  __forgeRafQueue?: FrameRequestCallback[];
}

/**
 * Pausa o que a Web Animations API conhece (CSS, ViewTimeline) e desliga o
 * `requestAnimationFrame` do site, para o canvas parar no último quadro desenhado. Sem isso,
 * duas fotos idênticas em enquadramento nunca são idênticas em pixel, e nada que dependa de
 * diferença entre fotos (tinta, fundo) pode ser isolado sobre WebGL.
 *
 * O `requestAnimationFrame` de mentira **guarda** o que o site pediu em vez de jogar fora.
 * Um laço de quadro comum se rearma de dentro do próprio callback (`draw` pede o próximo
 * `draw`): descartar o pedido mata a cadeia para sempre, e a página volta do descongelamento
 * exibindo o último quadro desenhado — parada, mas parecendo viva. Foi assim que uma seção
 * ficou mostrando o quadro de outra (§5.1 da spec) e é assim que um medidor que congela mais
 * de uma vez fotografaria a mesma pose achando que está percorrendo a animação.
 */
export const freezePage = (): void => {
  const scope = window as unknown as FrozenScope;
  if (scope.__forgeRaf === undefined) {
    scope.__forgeRaf = window.requestAnimationFrame.bind(window);
    scope.__forgeRafQueue = [];
    window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
      const queue = scope.__forgeRafQueue ?? [];
      queue.push(callback);
      scope.__forgeRafQueue = queue;
      // Fora da faixa que o navegador emite, para um `cancelAnimationFrame` do site não
      // acertar por acaso o identificador de um quadro real.
      return FROZEN_HANDLE_BASE + queue.length;
    };
  }
  const paused: Animation[] = [];
  for (const animation of document.getAnimations()) {
    if (animation.playState !== 'running') continue;
    animation.pause();
    paused.push(animation);
  }
  scope.__forgePaused = paused;
};

/** Devolve a página ao movimento — o inverso exato de `freezePage`, cadeia de quadro inclusa. */
export const unfreezePage = (): void => {
  const scope = window as unknown as FrozenScope;
  if (scope.__forgeRaf !== undefined) {
    const real = scope.__forgeRaf;
    window.requestAnimationFrame = real;
    scope.__forgeRaf = undefined;
    const queued = scope.__forgeRafQueue ?? [];
    scope.__forgeRafQueue = [];
    // Rearma a cadeia: sem isto o site fica sem nenhum quadro pedido e nunca mais desenha.
    for (const callback of queued) real(callback);
  }
  for (const animation of scope.__forgePaused ?? []) animation.play();
  scope.__forgePaused = [];
};
