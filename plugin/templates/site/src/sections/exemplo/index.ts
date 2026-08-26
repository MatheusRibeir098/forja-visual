/**
 * MOLDE de seção — a porta única: `mountSection(root, engine)`.
 *
 * Copie a pasta inteira (`index.ts`, `markup.ts`, `style.css`), renomeie para o
 * nome da sua seção, troque o import de conteúdo e apague o exemplo. Ele **não**
 * está no `MOUNTS` de `src/main.ts`, então não entra no bundle e sai do projeto
 * sem quebrar nada.
 *
 * O que este molde demonstra, e vale para qualquer seção:
 *
 *  1. o texto vem de `@/content/<nome>`, nunca de literal no markup;
 *  2. o CSS da seção é importado **aqui**, e só ele (`./style.css`);
 *  3. movimento por rolagem é lido do `engine.beats` **a cada quadro**, pelo
 *     ticker único — nunca escrito dentro de um handler de `scroll`. Um quadro
 *     por evento de scroll não é movimento contínuo: o navegador agrupa os
 *     eventos e o resultado lê como engasgo;
 *  4. a seção devolve `dispose()`, porque a página de inspeção `/dev/exemplo.html`
 *     monta e desmonta seções sem recarregar.
 *
 * Uma seção que desenha WebGL acrescenta um `scene.ts` e passa a valer A REGRA
 * DO CANVAS (topo de `src/main.ts`): recorte o próprio retângulo, devolva o
 * estado do renderer como encontrou e não dê clear global. Esta aqui não
 * desenha — por isso é opaca no CSS ("quem não desenha é opaco", `styles/base.css`).
 */
import type { Engine } from '@/engine';
import { renderExemplo } from './markup';
import './style.css';

export interface SectionHandle {
  dispose(): void;
}

/** Nome da custom property que o CSS lê. Uma escrita por quadro, sem layout. */
const PROGRESS_PROPERTY = '--exemplo-progress';

export function mountSection(root: HTMLElement, engine: Engine): SectionHandle {
  const { figure } = renderExemplo(root);

  // O beat converte a posição do elemento no documento em 0–1. Nada de posição
  // cravada (`at: 0.36`): basta um parágrafo crescer acima e todo número
  // cravado passa a apontar para o lugar errado, sem erro no console.
  const beat = engine.beats.register(figure, { start: 'enter', end: 'center' });

  const unsubscribe = engine.ticker.subscribe(() => {
    figure.style.setProperty(PROGRESS_PROPERTY, beat.progress.toFixed(4));
  });

  return {
    dispose(): void {
      unsubscribe();
      beat.dispose();
    },
  };
}
