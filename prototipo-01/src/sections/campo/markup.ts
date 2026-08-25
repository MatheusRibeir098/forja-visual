import { campo } from '@/content/campo';

/**
 * O HTML da seção. Duas peças e nada mais:
 *
 * - **`stage`** — 100dvh, `position: sticky`, transparente. Ele não desenha
 *   nada: é o retângulo que diz ao WebGL onde recortar. Fica preso no topo
 *   enquanto a seção rola, e é esse tempo preso que vira a rotação do crânio.
 * - **`copy`** — a coluna de texto, em chapa **sólida**. Sólida e não véu com
 *   alpha porque o contraste do texto não pode depender de onde os pontos
 *   estão: com alpha, o pior pixel muda a cada quadro e a medição de 7:1 deixa
 *   de significar alguma coisa.
 *
 * Todo texto é DOM de verdade, nunca `<canvas>` — inclusive o crédito do
 * modelo, que é obrigação de licença e não pode viver num pixel.
 */

const TITLE_ID = 'campo-title';

export interface CampoMarkup {
  stage: HTMLElement;
  copy: HTMLElement;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function externalLink(href: string, text: string): HTMLAnchorElement {
  const anchor = element('a', 'campo__link', text);
  anchor.href = href;
  anchor.rel = 'noopener noreferrer';
  anchor.target = '_blank';
  return anchor;
}

function buildFigures(): HTMLElement {
  const list = element('dl', 'campo__figures');
  for (const figure of campo.figures) {
    const item = element('div', 'campo__figure');
    item.append(
      element('dt', 'campo__figure-value', figure.value),
      element('dd', 'campo__figure-label', figure.label),
    );
    list.append(item);
  }
  return list;
}

/**
 * Colofão de atribuição. Montado por nós de texto e âncoras, e não por
 * `innerHTML`: o crédito vem de dados, e dados nunca viram markup executável.
 */
function buildColophon(): HTMLElement {
  const { credit } = campo;
  const paragraph = element('p', 'campo__colophon');
  paragraph.append(
    `${campo.colophon} `,
    externalLink(credit.sourceUrl, credit.title),
    ` — ${credit.author}, `,
    externalLink(credit.licenseUrl, credit.license),
    '.',
  );
  return paragraph;
}

export function buildMarkup(root: HTMLElement): CampoMarkup {
  const stage = element('div', 'campo__stage');
  stage.setAttribute('aria-hidden', 'true');

  /**
   * Espaçador vazio entre o palco e a coluna. **Só existe no layout empilhado.**
   *
   * Empilhado, a coluna sobe por cima do palco preso e cobre o crânio antes de
   * ele girar um quarto de volta — o objeto fica visível só no começo da janela.
   * O espaçador dá ao giro uma tela inteira de scroll antes de o texto chegar.
   * Lado a lado (>= 900px) ele tem altura zero: ali a coluna ocupa 46% da
   * largura e nunca esteve na frente de nada.
   */
  const spacer = element('div', 'campo__spacer');
  spacer.setAttribute('aria-hidden', 'true');

  const copy = element('div', 'campo__copy');
  const title = element('h2', 'campo__title', campo.title);
  title.id = TITLE_ID;

  // O objeto vive no canvas, que é decoração para quem lê por áudio. A
  // descrição existe para que a seção não seja "um título e quatro parágrafos
  // sobre uma coisa que você não pode ver".
  const description = element('p', 'campo__sr-only', campo.canvasAlt);

  copy.append(
    element('p', 'campo__eyebrow', campo.eyebrow),
    title,
    description,
    element('p', 'campo__lead', campo.lead),
  );
  for (const paragraph of campo.body) {
    copy.append(element('p', 'campo__body', paragraph));
  }
  copy.append(buildFigures(), element('p', 'campo__hint', campo.hint), buildColophon());

  root.classList.add('campo');
  // A seção é anunciada pelo próprio título; o `stage` é decoração e já está
  // marcado como oculto para leitores de tela.
  root.setAttribute('aria-labelledby', TITLE_ID);
  root.replaceChildren(stage, spacer, copy);

  return { stage, copy };
}
