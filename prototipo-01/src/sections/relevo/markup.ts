import { layerLabels, tecnicas } from '@/content';
import type { Technique } from '@/content';

/**
 * O texto da seção F4, em HTML de verdade — nada de conteúdo dentro do canvas.
 *
 * Duas faixas de carvão sólido, uma em cima e outra embaixo, e entre elas a
 * faixa livre onde o espécime é desenhado. O fundo é **sólido**, não scrim com
 * alpha: com alpha, o pior pixel de contraste passaria a depender de onde a
 * brasa está naquele quadro, e o contraste do texto viraria loteria de cursor.
 *
 * As faixas são também a régua do enquadramento: `index.ts` lê a altura das
 * duas uma vez por resize e o espécime é montado no que sobra.
 */

/** Id que o `aria-labelledby` da `<section id="relevo">` referencia. */
const TITLE_ID = 'relevo-title';

/** A técnica é a própria protagonista da seção: F4 existe para demonstrá-la. */
const TECHNIQUE_ID = 'IV.1';

export interface ReliefMarkup {
  element: HTMLElement;
  /** Faixas medidas para o enquadramento saber o que está coberto. */
  topBar: HTMLElement;
  bottomBar: HTMLElement;
  /** Rótulo do estado da luz — trocado quando a órbita assume o lugar do cursor. */
  setLightMode(text: string): void;
}

function findTechnique(id: string): Technique {
  const technique = tecnicas.find((item) => item.id === id);
  if (technique === undefined) {
    throw new Error(`forja/relevo: técnica ${id} ausente em src/content/tecnicas.ts`);
  }
  return technique;
}

function createElement(tag: string, className: string, text: string): HTMLElement {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

export function createMarkup(techniqueLabel: string): ReliefMarkup {
  const technique = findTechnique(TECHNIQUE_ID);

  const root = document.createElement('div');
  root.className = 'relevo';

  const top = document.createElement('header');
  top.className = 'relevo__bar relevo__bar--top';

  const mark = createElement(
    'p',
    'relevo__mark',
    `${technique.id} · ${layerLabels[technique.layer]}`,
  );

  const title = createElement('h2', 'relevo__title', technique.title);
  title.id = TITLE_ID;

  // A palavra grande já está cravada na chapa. Repetir "FORJA" em HTML seria
  // dizer duas vezes a mesma coisa, e a segunda vez sempre perde.
  top.append(mark, title);

  const bottom = document.createElement('footer');
  bottom.className = 'relevo__bar relevo__bar--bottom';

  const problem = createElement('p', 'relevo__problem', technique.problem);

  // O "quando NÃO usar" do catálogo entra inteiro: é o que separa uma técnica
  // documentada de um efeito vendido, e é o fator ⑤ da referência (registro de
  // rejeição) aplicado à própria página.
  const limit = document.createElement('p');
  limit.className = 'relevo__limit';
  limit.append(
    createElement('span', 'relevo__limit-label', 'Quando não usar'),
    technique.whenNot,
  );

  const readout = createElement('p', 'relevo__readout', techniqueLabel);
  const lightMode = createElement('span', 'relevo__light-mode', '');

  bottom.append(problem, limit, readout, lightMode);
  root.append(top, bottom);

  return {
    element: root,
    topBar: top,
    bottomBar: bottom,
    setLightMode(text: string): void {
      if (lightMode.textContent === text) return;
      lightMode.textContent = text;
    },
  };
}
