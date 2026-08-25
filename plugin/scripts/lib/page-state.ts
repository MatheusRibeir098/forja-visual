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

/**
 * Pausa o que a Web Animations API conhece (CSS, ViewTimeline) e desliga o
 * `requestAnimationFrame` do site, para o canvas parar no último quadro desenhado. Sem isso,
 * duas fotos idênticas em enquadramento nunca são idênticas em pixel, e nada que dependa de
 * diferença entre fotos (tinta, fundo) pode ser isolado sobre WebGL.
 */
export const freezePage = (): void => {
  const scope = window as unknown as {
    __forgeRaf?: typeof requestAnimationFrame;
    __forgePaused?: Animation[];
  };
  if (scope.__forgeRaf === undefined) {
    scope.__forgeRaf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = () => 0;
  }
  const paused: Animation[] = [];
  for (const animation of document.getAnimations()) {
    if (animation.playState !== 'running') continue;
    animation.pause();
    paused.push(animation);
  }
  scope.__forgePaused = paused;
};

/** Devolve a página ao movimento — o inverso exato de `freezePage`. */
export const unfreezePage = (): void => {
  const scope = window as unknown as {
    __forgeRaf?: typeof requestAnimationFrame;
    __forgePaused?: Animation[];
  };
  if (scope.__forgeRaf !== undefined) {
    window.requestAnimationFrame = scope.__forgeRaf;
    scope.__forgeRaf = undefined;
  }
  for (const animation of scope.__forgePaused ?? []) animation.play();
  scope.__forgePaused = [];
};
