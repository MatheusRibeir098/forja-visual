import { renderPrincipios } from './markup';
import type { Engine } from '@/engine';
import './style.css';

/**
 * F6 — **Princípios & roadmap**, a prova do P5 ("nativo primeiro").
 *
 * Esta é a única seção do site sem um único byte de JavaScript de animação e
 * sem WebGL. Tudo que se move aqui é **CSS scroll-driven animation**
 * (`animation-timeline: view()`) e `@starting-style`. O argumento da seção é o
 * próprio arquivo: se a seção que fala em "nativo primeiro" precisasse de
 * GSAP — ou do nosso ticker — o princípio seria retórica.
 *
 * Consequências práticas, e são de propósito:
 *
 * - o motor **não é usado**. O parâmetro existe só para a assinatura bater com
 *   a das outras seções, e é por isso que ele é opcional;
 * - o markup sai de `markup.ts` como string, para poder ser inlinado no
 *   `index.html` no build. Com JavaScript desabilitado, o CSS continua fazendo
 *   tudo o que faz aqui — falta só quem escreve o markup na página.
 *
 * `@supports` cuida do navegador sem scroll-driven: o estado final é o padrão e
 * a animação só é ligada onde existe, então o conteúdo nunca some.
 */
export function mountSection(root: HTMLElement, _engine?: Engine): void {
  // `innerHTML` numa string montada por nós, com todo texto escapado em
  // `markup.ts`: não há entrada de usuário em lugar nenhum deste caminho.
  root.innerHTML = renderPrincipios(root.id);
}
