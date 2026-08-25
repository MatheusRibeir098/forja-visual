import './styles/tokens.css';
import './styles/base.css';

import { createEngine } from '@/engine';
import type { Engine } from '@/engine';

/**
 * Boot da página: um motor, um canvas, N seções na ordem do documento.
 *
 * ══ A REGRA DO CANVAS ══════════════════════════════════════════════════════
 *
 * Leia isto antes de escrever a primeira cena. Não é estilo de código: é o que
 * impede que duas seções se apaguem, e o tipo de bug que só aparece depois que
 * a terceira já foi escrita.
 *
 * O canvas é **um só**, `position: fixed`, atrás do documento inteiro, criado
 * sem alpha (`engine/gl.ts`) — mas **nenhuma seção escreve nele**. Toda seção
 * escreve num **FBO de página** (`engine.gl.frame.target`, ver
 * `engine/frame.ts`), do tamanho exato do canvas; só o **passe de grade**, no
 * fim de cada quadro, lê esse FBO e desenha no backbuffer de verdade. É a
 * diferença entre "cinco janelinhas de WebGL coladas lado a lado" e uma
 * imagem: a montagem inteira existe como um quadro só antes de qualquer
 * curva, bloom, vinheta, grão ou dither tocá-la — e esses efeitos, por sua
 * vez, veem a página inteira, nunca o retângulo de uma seção.
 *
 * As quatro regras que caem disso:
 *
 *  1. **Não existe clear global por seção.** A única exceção do projeto
 *     inteiro é `frame.beginFrame()`, chamado uma vez, aqui, **antes** de
 *     qualquer seção — ele substitui o clear implícito que o backbuffer fazia
 *     de graça a cada quadro (o FBO, ao contrário do canvas, persiste entre
 *     quadros: se ninguém o limpasse, sobraria lixo do quadro anterior nas
 *     regiões que nenhuma seção visível cobre). Fora dessa exceção, nenhuma
 *     seção limpa mais que o próprio retângulo — um clear ali dentro seria ou
 *     dois renders por quadro, ou "quem desenha por último vence".
 *
 *  2. **Toda seção que desenha recorta o próprio retângulo dentro do FBO.**
 *     Há dois jeitos, e escolher errado é silencioso:
 *
 *     - a seção **nunca troca de render target** no quadro →
 *       `renderer.setScissor()` / `setScissorTest(true)`, o de sempre;
 *     - a seção **troca de render target** no meio do quadro (é o caso de
 *       quem passa por `engine/composite.ts`, que mistura duas camadas em
 *       dois FBOs próprios) → `engine.gl.frame.setScissorCss(x, y, w, h)`.
 *
 *     ⚠️ **Armadilha medida:** `renderer.setViewport()`/`setScissor()` são
 *     **ignorados** quando se troca de alvo por baixo, porque o three
 *     reaplica o scissor do próprio `WebGLRenderTarget` a cada troca. Quem
 *     troca de target precisa gravar no `target.scissor` — que é o que
 *     `frame.setScissorCss()` faz (e em px CSS, convertendo o dpr num lugar
 *     só). O sintoma de errar aqui é a seção desenhar por cima das vizinhas
 *     sem nenhum erro no console.
 *
 *     Como as seções são blocos empilhados, os retângulos são disjuntos por
 *     construção e a ordem de montagem deixa de importar.
 *
 *  3. **Quem mexe no estado do renderer devolve como encontrou**:
 *     `clearColor`, `autoClear`, `scissorTest` e `viewport`. O estado do
 *     renderer é global; sem a devolução, a seção seguinte herda o recorte da
 *     anterior e desenha no lugar errado.
 *
 *  4. **O passe de grade é a última inscrição no ticker.** `subscribers` é um
 *     `Set` (`engine/ticker.ts`), que itera na ordem de inserção — registrar
 *     `frame.present()` depois de montar todas as seções garante que ele rode
 *     por último em todo quadro, com a página inteira já desenhada no FBO.
 *
 * O corolário de (1): **região que ninguém desenha fica preta**, porque o FBO
 * nasce limpo em `beginFrame()` e o contexto é opaco. Quem não desenha WebGL
 * nenhum precisa ser opaco no CSS e servir de fundo do próprio pedaço — ver a
 * regra "quem não desenha é opaco" em `styles/base.css`. Entre as duas
 * coisas, cada pixel da página tem exatamente um dono.
 *
 * ══ ESTADO GLOBAL DE CÂMERA ════════════════════════════════════════════════
 *
 * `pointer.ray` depende de fov e aspect, e `pointer.setCamera` é global: a
 * última seção a chamar mandaria no raio de todas. A regra que resolve é a
 * mesma do renderer — quem lê o raio chama `setCamera` **no próprio quadro**,
 * antes de ler. Quem tem câmera própria calcula o raio local e não toca no
 * global. Nos dois casos a ordem de montagem deixa de mudar o resultado.
 *
 * ══ TIER E REDUCED-MOTION ══════════════════════════════════════════════════
 *
 * Nenhum dos dois é um `if` no fim do arquivo. O tier chega às seções como
 * **números** (dpr, escala de FBO, passos de ray march, portão do bloom —
 * `engine/tier.ts`) e `prefers-reduced-motion` troca o **frameloop** para
 * `demand` dentro de `createEngine`: o quadro passa a ser pedido, não
 * contínuo. Aqui os dois só são publicados no `<html>`, para o CSS os ler —
 * nunca uma segunda detecção, que poderia divergir do que o renderer usa.
 */

/** Assinatura única de seção. O retorno (handle ou `void`) não interessa ao boot. */
type MountFn = (root: HTMLElement, engine: Engine) => unknown;

/**
 * A ordem daqui é a ordem do documento, e ela **é o argumento do site** — não
 * um detalhe de layout. Cada par liga o `id` de uma `<section>` do
 * `index.html` à função que a monta.
 *
 * Acrescente as suas seções aqui:
 *
 *   import { mountSection as mountHero } from '@/sections/hero';
 *   const MOUNTS = [['hero', mountHero]] as const;
 *
 * Seção sem JavaScript nenhum (CSS scroll-driven, markup estático) não entra
 * nesta lista — e é a melhor seção que existe quando ela dá conta.
 */
const MOUNTS: ReadonlyArray<readonly [id: string, mount: MountFn]> = [];

function findCanvas(): HTMLCanvasElement {
  const canvas = document.getElementById('gl');
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('boot: <canvas id="gl"> não encontrado em index.html');
  }
  return canvas;
}

function findSection(id: string): HTMLElement {
  const root = document.getElementById(id);
  if (root === null) {
    throw new Error(`boot: <section id="${id}"> não existe em index.html`);
  }
  return root;
}

function boot(): void {
  const engine = createEngine(findCanvas());
  if (engine === null) {
    // Sem WebGL2 não há degradação possível para as seções de cena; o
    // documento segue legível, com o markup e os títulos que já estão no HTML.
    document.documentElement.dataset['gl'] = 'off';
    console.warn('boot: sem WebGL2 — seções de cena não serão montadas');
    return;
  }

  const { tier, reducedMotion, frame } = engine.gl;
  // Publicados no `<html>` para o CSS ler o mesmo valor que o renderer está
  // usando — nunca uma segunda detecção.
  document.documentElement.dataset['tier'] = tier;
  document.documentElement.dataset['motion'] = reducedMotion ? 'reduced' : 'full';

  // Primeira inscrição do quadro: liga o FBO de página e o limpa, antes que
  // qualquer seção tenha a chance de desenhar (regra 1 da REGRA DO CANVAS).
  engine.ticker.subscribe(() => frame.beginFrame());

  for (const [id, mount] of MOUNTS) mount(findSection(id), engine);

  // Última inscrição: `ticker.subscribers` é um `Set`, iterado na ordem de
  // inserção, então isto só roda depois que a última seção montada já se
  // inscreveu (regra 4). É aqui, e só aqui, que o backbuffer é escrito.
  engine.ticker.subscribe((_dt, elapsed) => frame.present(elapsed, !reducedMotion));
}

boot();
