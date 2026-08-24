import { site } from '@/content';

/**
 * O texto do hero, em HTML de verdade — nada de conteúdo desenhado no canvas.
 *
 * As duas faixas existem por dois motivos ao mesmo tempo, e é raro os dois
 * andarem juntos: elas prendem a chapa como as garras de uma prensa (é o
 * conceito), e são **fundo sólido**, o que fixa o contraste do texto
 * independentemente de onde a brasa esteja. Um scrim com alpha não daria essa
 * garantia — o pior pixel passaria a depender da luz.
 */

/** Id que `aria-labelledby` da seção referencia. */
const TITLE_ID = 'hero-title';

export interface HeroOverlay {
  element: HTMLElement;
  /** As duas faixas, para o enquadramento da chapa saber o que está coberto. */
  topBar: HTMLElement;
  bottomBar: HTMLElement;
}

function createParagraph(className: string, text: string): HTMLParagraphElement {
  const paragraph = document.createElement('p');
  paragraph.className = className;
  paragraph.textContent = text;
  return paragraph;
}

/**
 * @param techniqueLabel rótulo da técnica, já com o número de amostras do tier
 */
export function createOverlay(techniqueLabel: string): HeroOverlay {
  const root = document.createElement('div');
  root.className = 'hero-b';

  const top = document.createElement('header');
  top.className = 'hero-b__bar hero-b__bar--top';

  // A palavra grande é a que está cravada na chapa. Repetir "FORJA" em HTML
  // grande seria dizer duas vezes a mesma coisa, e a segunda vez sempre perde.
  const title = document.createElement('h1');
  title.id = TITLE_ID;
  title.className = 'hero-b__title';
  title.textContent = site.title;

  const technique = createParagraph('hero-b__technique', techniqueLabel);

  top.append(title, technique);

  const bottom = document.createElement('footer');
  bottom.className = 'hero-b__bar hero-b__bar--bottom';
  bottom.append(
    createParagraph('hero-b__tagline', site.tagline),
    createParagraph('hero-b__success', site.sucesso),
  );

  root.append(top, bottom);
  return { element: root, topBar: top, bottomBar: bottom };
}
