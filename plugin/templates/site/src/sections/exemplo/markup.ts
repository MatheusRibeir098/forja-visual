/**
 * MOLDE — o markup da seção, montado **a partir do conteúdo**.
 *
 * Repare que não há uma frase escrita aqui: tudo que aparece na tela vem de
 * `@/content/exemplo`. É essa separação que o portão `check-structure.ts`
 * verifica, e ela é o que permite revisar o texto sem abrir código.
 *
 * `createElement` + `textContent` em vez de `innerHTML`: o texto entra como
 * texto (nada de `<` do conteúdo virando tag) e o TypeScript devolve os nós que
 * o `index.ts` vai animar, sem um `querySelector` no meio.
 */
import { exemplo } from '@/content/exemplo';

export interface ExemploNodes {
  /** O elemento cuja altura vira progresso de rolagem — a âncora do beat. */
  readonly figure: HTMLElement;
}

export function renderExemplo(root: HTMLElement): ExemploNodes {
  const heading = root.querySelector('h1, h2, h3');

  const eyebrow = document.createElement('p');
  eyebrow.className = 'exemplo__eyebrow';
  eyebrow.textContent = exemplo.eyebrow;

  // O título já existe no index.html (o esqueleto legível sem JavaScript); a
  // seção o preenche em vez de criar um segundo. Se ele não existir, o markup
  // segue sem título em vez de duplicar hierarquia.
  if (heading !== null) heading.textContent = exemplo.title;

  const body = document.createElement('div');
  body.className = 'exemplo__body';
  for (const paragraph of exemplo.paragraphs) {
    const p = document.createElement('p');
    p.textContent = paragraph;
    body.append(p);
  }

  const figure = document.createElement('div');
  figure.className = 'exemplo__bar';
  figure.setAttribute('role', 'img');
  figure.setAttribute('aria-label', exemplo.figureLabel);

  root.prepend(eyebrow);
  root.append(body, figure);

  return { figure };
}
