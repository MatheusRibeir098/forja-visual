import './styles/tokens.css';
import './styles/base.css';
import './styles/typography.css';
// F6 não é montada por JavaScript: o markup dela é inlinado no `index.html`
// pelo plugin `forja-inline-principios` (ver `vite.config.ts`), e o que se move
// lá é CSS scroll-driven. Só o estilo precisa entrar no bundle — é a prova do
// P5 ("nativo primeiro"), e ela não valeria nada com um `mountSection` aqui.
import '@/sections/principios/style.css';

import { createEngine } from '@/engine';
import { site } from '@/content/site';
import { mountSection as mountHero } from '@/sections/hero';
import { mountSection as mountTese } from '@/sections/tese';
import { mountSection as mountReferencia } from '@/sections/referencia';
import { mountSection as mountCampo } from '@/sections/campo';
import { mountSection as mountRelevo } from '@/sections/relevo';
import { mountSection as mountCatalogo } from '@/sections/catalogo';
import { mountSection as mountMedicao } from '@/sections/medicao';
import type { Engine } from '@/engine';

/**
 * Boot da página: um motor, um canvas, oito seções na ordem do documento.
 *
 * ══ A REGRA DO CANVAS ══════════════════════════════════════════════════════
 *
 * O canvas é **um só**, `position: fixed`, atrás do documento inteiro, criado
 * sem alpha (`engine/gl.ts`) — mas nenhuma seção escreve nele diretamente.
 * Toda seção escreve num **FBO de página** (`engine.gl.frame.target`,
 * `engine/frame.ts`), do tamanho exato do canvas; só o **passe de grade**, no
 * fim de cada quadro, lê esse FBO e desenha no backbuffer de verdade. É a
 * diferença entre "cinco janelinhas de WebGL coladas lado a lado" e uma
 * imagem: a montagem inteira passa a existir como um quadro só antes de
 * qualquer curva, bloom, vinheta, grão ou dither tocá-la — e esses cinco
 * efeitos, por sua vez, veem a página inteira, nunca o retângulo de uma
 * seção.
 *
 * Isso muda **quem chama o quê**, não o resto do contrato por retângulo, que
 * segue valendo dentro do FBO:
 *
 *  1. **Não existe clear global por seção.** A única exceção do projeto inteiro
 *     é `frame.beginFrame()`, chamado uma vez, aqui, **antes** de qualquer
 *     seção — ele substitui o clear implícito que o backbuffer fazia de graça
 *     a cada quadro (o FBO, ao contrário do canvas, persiste entre quadros: se
 *     ninguém o limpasse, sobraria lixo do quadro anterior nas regiões que
 *     nenhuma seção visível cobre). Fora dessa exceção, nenhuma seção limpa
 *     mais que o próprio retângulo — um clear ali dentro seria ou dois renders
 *     por quadro, ou "quem desenha por último vence".
 *
 *  2. **Toda seção que desenha recorta o próprio retângulo dentro do FBO.**
 *     `campo`, `relevo` e `catalogo/planes` continuam usando
 *     `renderer.setScissor()` — nunca trocam de render target sozinhas, então
 *     o recorte solto do renderer não é pisado por ninguém. `hero` e a F2 (que
 *     passam por `composite.ts`, e portanto trocam de render target por baixo
 *     dos panos) usam `gl.frame.setScissorCss()`, que grava o recorte no
 *     próprio `WebGLRenderTarget` — o único jeito de um scissor sobreviver a
 *     uma troca de alvo no meio do quadro. Como as seções são blocos
 *     empilhados, os retângulos são disjuntos por construção e a ordem de
 *     montagem deixa de importar.
 *
 *  3. **Quem mexe no estado do renderer devolve como encontrou**:
 *     `clearColor`, `autoClear`, `scissorTest` e `viewport`. O estado do
 *     renderer é global; sem a devolução, a seção seguinte herda o recorte da
 *     anterior e desenha no lugar errado.
 *
 *  4. **O passe de grade é a última inscrição no ticker.** `subscribers` é um
 *     `Set` (`engine/ticker.ts`), que itera na ordem de inserção — registrar
 *     `frame.present()` depois de montar as sete seções garante que ele rode
 *     por último em todo quadro, com a página inteira já desenhada no FBO.
 *
 * O corolário de (1): **região que ninguém desenha fica preta**, porque o FBO
 * nasce limpo em `beginFrame()` e o contexto é opaco. Quem não desenha WebGL
 * nenhum (referência, princípios, medição) é opaco no CSS e serve de fundo do
 * próprio pedaço — ver a regra "quem não desenha é opaco" em `styles/base.css`.
 * Entre as duas coisas, cada pixel da página tem exatamente um dono.
 *
 * ══ ESTADO GLOBAL DE CÂMERA ════════════════════════════════════════════════
 *
 * `pointer.ray` depende de fov e aspect, e `pointer.setCamera` é global: a
 * última seção a chamar mandava no raio de todas. A regra que resolve é a mesma
 * do renderer — quem lê o raio chama `setCamera` **no próprio quadro**, antes
 * de ler (hero, tese, campo). Quem tem câmera própria calcula o raio local e
 * não toca no global (relevo, catálogo). Nos dois casos a ordem de montagem
 * deixa de mudar o resultado.
 *
 * ══ TIER E REDUCED-MOTION ══════════════════════════════════════════════════
 *
 * Nenhum dos dois é um `if` no fim do arquivo. O tier chega às seções como
 * **números** (dpr, escala de FBO, passos do ray march, níveis de bloom do
 * passe de grade — `engine/tier.ts`) e `prefers-reduced-motion` troca o
 * **frameloop** para `demand` dentro de `createEngine`: o quadro passa a ser
 * pedido, não contínuo. O grão do passe de grade lê o mesmo booleano para
 * decidir se anima (`frame.present`, abaixo) — é a mesma regra de qualquer
 * outra animação automática do projeto, só que aplicada ao pós-processamento
 * em vez de a uma cena. Aqui os dois só são publicados no `<html>`, para o CSS
 * e para a seção de medição os lerem.
 */

/** Assinatura única de seção. O retorno (handle ou `void`) não interessa ao boot. */
type MountFn = (root: HTMLElement, engine: Engine) => unknown;

/**
 * A ordem é o argumento, não o layout: a média (hero) → por que ela acontece
 * (tese) → um caso que escapou dela (referência) → a técnica-assinatura desse
 * caso funcionando (campo) → o material (relevo) → o catálogo inteiro → os
 * princípios → os números medidos. Campo vem colado na referência de propósito:
 * o argumento e a prova não devem ficar a duas seções um do outro.
 *
 * `principios` não aparece: é a única seção sem JavaScript.
 */
const MOUNTS: ReadonlyArray<readonly [id: string, mount: MountFn]> = [
  ['hero', mountHero],
  ['tese', mountTese],
  ['referencia', mountReferencia],
  ['campo', mountCampo],
  ['relevo', mountRelevo],
  ['catalogo', mountCatalogo],
  ['medicao', mountMedicao],
];

function findCanvas(): HTMLCanvasElement {
  const canvas = document.getElementById('gl');
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('forja: <canvas id="gl"> não encontrado em index.html');
  }
  return canvas;
}

function findSection(id: string): HTMLElement {
  const root = document.getElementById(id);
  if (root === null) {
    throw new Error(`forja: <section id="${id}"> não existe em index.html`);
  }
  return root;
}

/**
 * Confere que o documento traz as mesmas seções que `content/site.ts` declara,
 * e na mesma ordem. É essa lista que numera os capítulos (`§ 04`) e nomeia as
 * seções na medição: se ela discordar do HTML, o site passa a mentir a
 * numeração — em silêncio, que é o pior jeito de errar.
 */
function assertDocumentOrder(): void {
  const declared = site.sections.map((section) => section.id).join(',');
  const inDocument = Array.from(document.querySelectorAll('main > section'))
    .map((section) => section.id)
    .join(',');
  if (declared !== inDocument) {
    throw new Error(`forja: ordem das seções diverge — site.ts [${declared}] × DOM [${inDocument}]`);
  }
}

function boot(): void {
  assertDocumentOrder();

  const engine = createEngine(findCanvas());
  if (engine === null) {
    // Sem WebGL2 não há degradação possível para as seções de cena; o documento
    // segue legível, com F6 inteira (ela nunca precisou de JS) e os títulos.
    document.documentElement.dataset['gl'] = 'off';
    console.warn('forja: sem WebGL2 — seções de cena não serão montadas');
    return;
  }

  const { tier, reducedMotion, frame } = engine.gl;
  // Publicados no `<html>` para o CSS e para F7 lerem o mesmo valor que o
  // renderer está usando — nunca uma segunda detecção, que poderia divergir.
  document.documentElement.dataset['tier'] = tier;
  document.documentElement.dataset['motion'] = reducedMotion ? 'reduced' : 'full';

  // Primeira inscrição do quadro: liga o FBO de página e o limpa, antes que
  // qualquer seção tenha a chance de desenhar (regra 1 da "REGRA DO CANVAS").
  engine.ticker.subscribe(() => frame.beginFrame());

  for (const [id, mount] of MOUNTS) mount(findSection(id), engine);

  // Última inscrição: `ticker.subscribers` é um `Set`, iterado na ordem de
  // inserção, então isto só pode rodar depois que a última seção montada já
  // se inscreveu (regra 4). É aqui, e só aqui, que o backbuffer de verdade é
  // escrito.
  engine.ticker.subscribe((_dt, elapsed) => frame.present(elapsed, !reducedMotion));
}

boot();
