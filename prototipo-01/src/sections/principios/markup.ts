// Caminho relativo, e não o alias `@/`: este módulo também é importado por
// `vite.config.ts` (plugin `forja-inline-principios`), e o config do Vite é
// empacotado antes de qualquer alias existir. É o preço de a mesma função
// gerar o markup do build e o do runtime — e é preferível a ter duas.
import { formatSectionMark, principios, roadmap, site } from '../../content';
import type { Principle, RoadmapItem, RoadmapPhase } from '../../content';

/**
 * O HTML de F6 como **string**, e não como `createElement`.
 *
 * Motivo: esta seção não pode depender de JavaScript. Nada aqui se move por
 * script, e o mesmo texto que o `mountSection` injeta pode ser colado direto no
 * `index.html` no build — é a mesma função que produz os dois. Se F6 fosse
 * montada nó a nó, o markup viveria dentro de um `for` e essa porta se fecharia.
 */

/** Seção que este markup preenche. `index.html` já reserva o `<section>`. */
const SECTION_ID = 'principios';

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

/**
 * O texto vem de `content/*.ts` (nosso, tipado, sem entrada de usuário), mas
 * escapar é barato e evita que um `&` ou um `<` num texto futuro vire markup
 * silenciosamente.
 */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (char) => HTML_ESCAPES[char] ?? char);
}

function renderPrinciple(principle: Principle): string {
  return `<li class="pr-item">
        <p class="pr-id t-mono">${escapeHtml(principle.id)}</p>
        <div class="pr-slot">
          <h3 class="pr-item-title t-subheading">${escapeHtml(principle.title)}</h3>
          <p class="pr-text t-body">${escapeHtml(principle.body)}</p>
        </div>
      </li>`;
}

/**
 * Estado do item como `<input type="checkbox" disabled>`: é a única forma de
 * dizer "feito / não feito" que o leitor de tela anuncia **sem inventar texto**
 * fora de `content/`. `data-doing` marca o item começado, que o CSS desenha meio
 * preenchido.
 */
function renderTask(item: RoadmapItem): string {
  const checked = item.done ? ' checked' : '';
  const doing = item.inProgress === true ? ' data-doing="true"' : '';
  return `<li class="pr-task"${doing}>
            <input class="pr-check" type="checkbox" disabled${checked} />
            <span class="pr-task-text">${escapeHtml(item.text)}</span>
          </li>`;
}

function renderPhase(phase: RoadmapPhase): string {
  const tasks = phase.items.map(renderTask).join('\n');
  return `<li class="pr-phase">
        <h3 class="pr-phase-title t-label">${escapeHtml(phase.title)}</h3>
        <ul class="pr-tasks" role="list">
${tasks}
        </ul>
      </li>`;
}

/**
 * Markup completo de F6.
 *
 * @param sectionId id do `<section>` que vai receber o markup — usado para
 * manter o `aria-labelledby` do `index.html` apontando para um título que existe.
 */
export function renderPrincipios(sectionId: string = SECTION_ID): string {
  const index = site.sections.findIndex((section) => section.id === sectionId);
  if (index < 0) {
    throw new Error(`sections/principios: id "${sectionId}" não existe em content/site.ts`);
  }
  const label = escapeHtml(site.sections[index]?.label ?? '');
  const titleId = escapeHtml(`${sectionId}-title`);

  return `<div class="pr-root">
    <header class="pr-head">
      <p class="pr-kicker t-mono">
        <span class="pr-kicker-n">${escapeHtml(formatSectionMark(index))}</span>
        <span class="pr-kicker-label">${label}</span>
      </p>
      <h2 id="${titleId}" class="pr-title t-title">${label}</h2>
      <div class="pr-draw" aria-hidden="true"></div>
    </header>
    <ol class="pr-list" role="list">
${principios.map(renderPrinciple).join('\n')}
    </ol>
    <ol class="pr-phases" role="list">
${roadmap.map(renderPhase).join('\n')}
    </ol>
  </div>`;
}
