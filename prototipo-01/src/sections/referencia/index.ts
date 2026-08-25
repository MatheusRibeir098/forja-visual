import { DEFAULT_DAMP, createDamped } from '@/engine';
import { buildReferenceDom } from './dom';
import { activeIndexAt, computeNeedleTarget } from './needle';
import type { Engine } from '@/engine';
import './style.css';

/**
 * F3 — **A referência**: os cinco fatores que tiraram o `portfolio-3d` da média.
 *
 * Duas técnicas, e só elas:
 *
 * - **V.2, beats ancorados no DOM** — cada bloco registra um beat sobre o
 *   *próprio elemento*. Nenhuma posição de scroll é cravada, então inserir
 *   qualquer coisa acima da seção não desalinha nada: o beat mede o elemento,
 *   não a página.
 * - **V.3, damping assimétrico** — o alvo da agulha é o progresso somado dos
 *   cinco beats; a agulha o persegue com `damp()`, rápida enquanto está longe e
 *   macia ao assentar, sem jamais ultrapassar.
 *
 * Sem WebGL: o indicador é DOM, o motor entra só pelo ticker e pelos beats.
 * A agulha e o alvo saem para o CSS em `--rf-needle` e `--rf-target`; o fantasma
 * do alvo é desenhado de propósito, porque a distância entre os dois **é** a
 * técnica — sem ele o damping seria invisível.
 *
 * Medido no Chrome 151 (Intel RPL-U, 2026-08-24), salto instantâneo de 2 telas:
 * gap inicial de 0,577 da trilha, 10% do gap fechados em **234–248 ms** em
 * 1280×720 e 240–248 ms em 375×667 (três execuções), com zero trocas de sinal
 * do gap em nenhuma delas — nada de overshoot. Teto do critério: 350 ms. Inserir um bloco de 800 px acima da seção não moveu
 * o alvo (0,5859 antes e depois) — os beats seguem os elementos, não a página.
 */

/**
 * Janela do beat de cada bloco: de "topo do bloco entrando pelo rodapé" a
 * "centro do bloco no centro da tela". A ponta em `center` é o que faz a agulha
 * cravar no marcador exatamente quando o fator está sendo lido, e não meia
 * fatia depois.
 */
const BLOCK_BEAT = { start: 'enter', end: 'center' } as const;

/**
 * Passo de quantização do progresso de bloco. 1/500 num fio de ~640 px é 1,3 px
 * de crescimento por degrau — abaixo do que o olho separa em movimento — e corta
 * as escritas de custom property nos quadros em que o scroll mal andou.
 */
const BLOCK_STEP = 1 / 500;

/**
 * Passo da agulha. Bem mais fino que o do fio (1e-4 da trilha ≈ 0,06 px numa
 * trilha de 560 px) porque o critério de aceite lê estes dois valores por quadro
 * para calcular o gap: arredondar grosso inventaria trocas de sinal que o
 * `damp()` não faz. Como o valor amortecido é monótono, arredondar a 4 casas
 * mantém `target - needle >= 0` em todo quadro.
 */
const NEEDLE_STEP = 1e-4;

/** Casas decimais escritas no CSS: 4 é exatamente o `NEEDLE_STEP`. */
const PROPERTY_DIGITS = 4;

function quantize(value: number, step: number): number {
  return Math.round(value / step) * step;
}

export function mountSection(root: HTMLElement, engine: Engine): void {
  const { beats, ticker, reducedMotion } = engine;
  const { blocks, rail } = buildReferenceDom(root);
  const registered = blocks.map((block) => ({
    block,
    beat: beats.register(block.el, BLOCK_BEAT),
  }));

  const needle = createDamped(0, DEFAULT_DAMP);
  let lastNeedle = -1;
  let lastTarget = -1;
  let lastActive = -1;

  /** Só o bloco sob a agulha fica destacado; muda no máximo uma vez por fatia. */
  function applyActive(index: number): void {
    if (index === lastActive) return;
    for (let position = 0; position < blocks.length; position += 1) {
      const block = blocks[position];
      if (block === undefined) continue;
      block.el.dataset['active'] = String(position === index);
    }
    lastActive = index;
  }

  /** Escreve `--rf-*` na trilha só quando o degrau mudou. */
  function writeRail(name: string, value: number, last: number): number {
    const quantized = quantize(value, NEEDLE_STEP);
    if (quantized === last) return last;
    rail.style.setProperty(name, quantized.toFixed(PROPERTY_DIGITS));
    return quantized;
  }

  function applyBlockProgress(): number {
    let arrived = 0;
    for (const { block, beat } of registered) {
      const progress = beat.progress;
      arrived += progress;
      const quantized = quantize(progress, BLOCK_STEP);
      if (quantized === block.applied) continue;
      block.applied = quantized;
      block.el.style.setProperty('--rf-p', quantized.toFixed(PROPERTY_DIGITS));
    }
    return arrived;
  }

  // A seção existe enquanto a página existir: não há caminho de desmontagem, e
  // guardar o cancelamento do ticker só para nunca chamá-lo seria código morto.
  ticker.subscribe((dt) => {
    const target = computeNeedleTarget(applyBlockProgress(), registered.length);
    needle.target = target;
    // Com movimento reduzido a agulha não persegue: ela já está onde o scroll
    // pediu. O damping é movimento que o usuário não comandou.
    if (reducedMotion) needle.value = target;
    const value = reducedMotion ? target : needle.update(dt);

    lastNeedle = writeRail('--rf-needle', value, lastNeedle);
    lastTarget = writeRail('--rf-target', target, lastTarget);

    applyActive(activeIndexAt(value, registered.length));
  });
}
