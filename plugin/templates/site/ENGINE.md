# A interface `Engine`

Tudo que uma cena precisa do motor chega por um objeto só, criado uma vez no boot:

```ts
import { createEngine } from '@/engine';
import type { Engine } from '@/engine';

const engine = createEngine(canvas); // Engine | null — `null` = sem WebGL2
```

Toda seção e toda variante de hero recebem esse objeto pronto:

```ts
export function mountHero(root: HTMLElement, engine: Engine): void {
  /* ... */
}
```

**Você não cria nada do que está aqui.** Um segundo `requestAnimationFrame`, um segundo
`WebGLRenderer` ou um segundo listener de `pointermove` não são "mais um detalhe": são a
ordem entre sistemas virando acidente, e o bug que aparece só na terceira seção.

```ts
interface Engine {
  gl: GL; // renderer, canvas, tamanho, tier, FBO de página
  ticker: Ticker; // o único rAF do projeto
  beats: Beats; // progresso de scroll ancorado no DOM
  pointer: Pointer; // cursor como raio, global
  composite: Composite; // transição por máscara entre duas cenas
  reducedMotion: boolean; // sempre `false` hoje — ver §6
  dispose(): void;
}
```

---

## 1. Quadro — `engine.ticker`

```ts
const stop = engine.ticker.subscribe((dt, elapsed) => {
  // dt: segundos desde o quadro anterior, já com teto de 1/15 s
  // elapsed: segundos acumulados desde o boot
});
stop(); // cancela a inscrição
```

- **`dt` é em segundos e tem teto.** Aba em segundo plano ou GC longo produziriam um `dt` de
  vários segundos e tudo que integra o tempo teleportaria; o teto de 1/15 s troca teleporte
  por câmera lenta, que é o que o usuário perdoa.
- **Integre com `dt`, nunca com um fator fixo por quadro.** `x += 0.1` anda o dobro num
  monitor de 120 Hz. Use `damp()` (abaixo) ou multiplique por `dt`.
- **A ordem das inscrições é a ordem de inserção** (`subscribers` é um `Set`). Quem monta
  primeiro roda primeiro. É por isso que `frame.beginFrame()` é a primeira inscrição do boot
  e `frame.present()` é a última.
- `engine.ticker.fps` é a mediana móvel dos últimos 60 quadros — útil para um HUD de debug,
  nunca para decidir caminho de código.
- `setMode('demand')` desliga o loop contínuo: nada roda até alguém chamar `invalidate()`.
- **A cadeia de rAF se rearma sozinha.** Um loop de rAF é uma corrente — cada quadro agenda o
  próximo — e ela pode ser cortada de fora: um inscrito que lança, a aba indo para segundo
  plano, ou o `requestAnimationFrame` trocado por um stub que devolve 0 (é o que o medidor de
  contraste do plugin faz para fotografar a página). Quando isso acontecia, **nada** voltava, e
  a página ficava parada no último quadro desenhado — que podia ser o de outra seção, com fundo
  de luminância oposta, derrubando o contraste do texto por cima. O ticker agora reagenda num
  `finally` (o erro do inscrito continua subindo para o console) e tenta de novo a cada 250 ms
  enquanto o rAF não agendar nada; `invalidate()` é o gatilho imediato, e todo scroll o dispara.
  Coberto por `ticker.test.ts` — **não** contorne isso com um rAF próprio na sua seção.

**Suavização:** para perseguir um alvo (cursor, scroll, foco) use `damp`, não um lerp fixo:

```ts
import { createDamped, damp, DEFAULT_DAMP } from '@/engine';

const rotation = createDamped(0);
rotation.target = pointer.ndc.x * 0.4;
engine.ticker.subscribe((dt) => {
  mesh.rotation.y = rotation.update(dt);
});
```

`damp` é assimétrico de propósito: rápido enquanto o alvo está longe, macio ao assentar. É
independente de fps e nunca ultrapassa o alvo.

---

## 2. Renderer, canvas e tamanho — `engine.gl`

```ts
const { renderer, canvas, size, tier, settings, reducedMotion, frame } = engine.gl;

size.w; // largura em px CSS
size.h; // altura em px CSS
size.dpr; // devicePixelRatio efetivo, já limitado pelo tier
```

- **`size` é um objeto estável, mutado no lugar.** Guarde a referência, nunca uma cópia dos
  números — a cópia congela no primeiro resize.
- Para reagir a resize:

  ```ts
  const stopResize = engine.gl.onResize((s) => camera.updateProjectionMatrix());
  ```

  O motor já cuida de `setSize`/`setPixelRatio` do renderer; o que sobra para a cena é a
  **projeção** e o tamanho dos render targets próprios.

- `renderer` é um `WebGLRenderer` do three, com `outputColorSpace = SRGB` e **sem tone
  mapping**. Materiais `RawShaderMaterial` não recebem os chunks do three: termine o seu
  fragment em `linearToSrgb()` (`@/shaders/glsl`).
- `createEngine` devolve **`null`** quando não há WebGL2. Trate isso no boot; a página tem que
  continuar legível sem uma linha de WebGL.
- **Convenção do canvas: `id="gl"`.** `index.html` já traz `<canvas id="gl">` — é esse mesmo
  elemento que `engine.gl.canvas` referencia, único no site. Não é só estilo: os medidores do
  plugin (`measure-fps.ts`, `measure-variant.ts`) procuram o canvas WebGL por
  `#gl,[data-forge-gl]`, a convenção primeiro. Um `#gl` é medido sem argumento nenhum; renomear
  ou criar um segundo canvas obriga `--canvas` em toda chamada e arrisca a medição não achar
  nada.

---

## 3. Progresso de scroll — `engine.beats`

Um "beat" é um elemento do DOM convertido em progresso `0–1`. **Nada de posições cravadas**
(`at: 0.36`): basta um parágrafo crescer acima e todos os números abaixo apontam para o lugar
errado, em silêncio.

```ts
const beat = engine.beats.register(root, { start: 'enter', end: 'exit', margin: 0 });

engine.ticker.subscribe(() => {
  const p = beat.progress; // 0–1 com clamp; é um campo, leia direto a 60 fps
  material.uniforms.uReveal.value = p;
});

beat.subscribe((p) => {
  /* só quando muda — bom para classe CSS, ruim para uniform */
});
beat.dispose();
```

Âncoras:

| `start`    | quando o progresso vale 0                          |
| ---------- | -------------------------------------------------- |
| `'enter'`  | topo do elemento no **fundo** do viewport (padrão) |
| `'top'`    | topo do elemento no **topo** do viewport           |
| `'center'` | centro do elemento no centro do viewport           |

| `end`      | quando o progresso vale 1                          |
| ---------- | -------------------------------------------------- |
| `'exit'`   | fundo do elemento no **topo** do viewport (padrão) |
| `'bottom'` | fundo do elemento no fundo do viewport             |
| `'center'` | centro do elemento no centro do viewport           |

`margin` (px) alarga as duas pontas da janela.

Os `beats` já estão inscritos no ticker e medem **todos** os retângulos de uma vez, antes de
qualquer escrita — um layout por quadro em vez de um por elemento. Não chame
`getBoundingClientRect()` dentro do seu tick: use `beat.progress` ou, se estiver rastreando
planos, `domSync.rectOf(el)`.

---

## 4. Cursor — `engine.pointer`

```ts
pointer.ndc; // { x, y } em −1..1, y para cima
pointer.ray; // direção em view space já dividida por z
pointer.active; // false em touch, ou quando o cursor saiu
pointer.velocity; // NDC por segundo, com decaimento
```

O `ray` existe porque medir distância 3D até um ponto do cursor só afeta a fatia de geometria
que está perto daquele plano de profundidade. Com o raio, o `z` se cancela:

```glsl
vec2 pointerOffset(vec3 mv, vec2 ray) { return mv.xy + ray * mv.z; }
```

(Importe o snippet de `POINTER_RAY_GLSL` em vez de redigitar — a versão em JS,
`pointerOffset()`, é a mesma conta, para testes.)

⚠️ **`pointer.setCamera(fovDeg, aspect)` é global.** O raio depende de fov e aspect, então a
última cena a chamar mandaria em todas. Regra: **quem lê o raio chama `setCamera` no próprio
quadro, antes de ler**; quem tem câmera própria calcula o raio local e não toca no global.

Em `pointerType === 'touch'`, `active` fica `false` — a cena precisa de um plano B (órbita
automática, progresso de scroll) em vez de esperar um cursor que não existe.

---

## 5. Tier — números, nunca caminho de código

```ts
const { tier, settings } = engine.gl; // 'low' | 'mid' | 'high'
settings.dpr; // teto do devicePixelRatio
settings.fboScale; // escala dos render targets, 0.5–1
settings.rayMarchSamples; // passos de um ray march
settings.bloomLevels; // portão do bloom no passe de grade
```

**Regra dura: tier só muda números.** Se `low` desligasse um efeito, existiriam dois sites
para depurar e o que ninguém testa quebraria em silêncio. Todo tier roda o mesmo shader e o
mesmo grafo — com resolução, dpr e contagem de amostras menores. Na prática:

```ts
// certo: o número entra como uniform, o shader sai do laço sozinho
uniforms.uSamples.value = settings.rayMarchSamples;

// errado: dois caminhos de código
if (tier === 'low') {
  /* outro material */
}
```

Dimensione os seus render targets por `size.w * size.dpr * settings.fboScale`.

O tier é detectado uma vez (GPU por software → `low`; ponteiro grosso ou tela pequena e densa
→ `mid`; senão `high`) e publicado em `<html data-tier>` para o CSS ler. Não detecte de novo.

---

## 6. Movimento reduzido — **ignorado, de propósito**

**Este motor não respeita `prefers-reduced-motion: reduce`. O site anima em qualquer
máquina.** Não é um `TODO`: é decisão de produto do dono, de 26/08/2026, registrada na §5.1 da
spec do plugin.

Na prática, num sistema com movimento reduzido ligado:

- `engine.reducedMotion` vale **`false`** — a mídia nem é consultada (`engine/tier.ts`);
- o ticker fica em **`always`**, com loop contínuo;
- o grão do passe de grade **continua animando**;
- o `scroll-behavior: smooth` do `base.css` vale para todo mundo;
- `<html data-motion>` sai como `"full"` — ele descreve o que o motor está fazendo, não o que
  o sistema pediu.

⚠️ **O custo, escrito porque é real:** quem desliga animações por distúrbio vestibular — enjoo,
vertigem, enxaqueca com movimento na tela — vê tudo se mexendo, e não tem como pedir que pare.
Consequência direta: **o site não pode ser anunciado como "WCAG 2.2 AA" sem ressalva** — o
critério 2.3.3 (Animação a partir de interações) não é atendido. O que se entrega de
acessibilidade é contraste ≥ 7:1 por pixel, foco visível, alvos de toque e semântica.

**Para reverter**, três pontos, todos comentados no código:

1. `src/engine/tier.ts` — troque `const reducedMotion = false` de volta por
   `window.matchMedia('(prefers-reduced-motion: reduce)').matches`;
2. `src/styles/base.css` — reponha o `@media (prefers-reduced-motion: no-preference)` em volta
   do `scroll-behavior: smooth`;
3. o CSS das suas seções — animação declarativa volta a nascer dentro de um
   `@media (prefers-reduced-motion: no-preference)`.

Feito isso, o resto do motor obedece sozinho: `engine/index.ts` volta o ticker para `demand` e
`main.ts` congela a semente do grão. Não há um quarto ponto escondido.

### O que continua valendo para a sua cena

`engine.reducedMotion` continua sendo o lugar certo para uma **animação própria** perguntar se
deve parar — órbita automática, ruído no tempo, pulsação. Hoje a resposta é sempre "pode
rodar"; escrever a pergunta mesmo assim custa uma linha e é o que faz a reversão acima ser de
fato de três linhas.

```ts
engine.ticker.subscribe((dt) => {
  if (!engine.reducedMotion) mesh.rotation.y += dt * 0.2; // animação própria
  material.uniforms.uReveal.value = beat.progress; // dirigida por scroll: sempre
});
```

E, independentemente da política: **movimento dirigido por scroll precisa ser fluido.** Um
quadro por evento de scroll não é movimento contínuo — o navegador agrupa os eventos e o
resultado lê como engasgo. É por isso que o ticker fica em `always` e a cena lê
`beat.progress` a cada quadro, em vez de desenhar dentro de um `beat.subscribe()`.

---

## 7. Desenhar sem apagar as seções vizinhas

Esta é a regra que mais custa caro se for descoberta tarde. A versão longa está no comentário
de topo de `src/main.ts`; a versão curta é:

1. **Você não desenha no canvas.** Desenha no FBO de página, `engine.gl.frame.target`, que
   `frame.beginFrame()` já deixou ligado antes de qualquer seção rodar. Só o passe de grade,
   no fim do quadro, escreve no backbuffer.
2. **Nenhum clear.** `renderer.clear()` numa seção apaga a página inteira. A única exceção do
   projeto é o `beginFrame()` do boot.
3. **Recorte o seu retângulo**, sempre, com um dos dois:

   ```ts
   // A) a sua cena NUNCA chama setRenderTarget:
   const rect = root.getBoundingClientRect();
   renderer.setScissorTest(true);
   renderer.setScissor(rect.left, gl.size.h - rect.bottom, rect.width, rect.height);
   renderer.setViewport(rect.left, gl.size.h - rect.bottom, rect.width, rect.height);
   renderer.render(scene, camera);
   renderer.setScissorTest(false); // devolva o estado

   // B) a sua cena TROCA de render target no quadro (ex.: passa por `composite`):
   gl.frame.setScissorCss(rect.left, gl.size.h - rect.bottom, rect.width, rect.height);
   ```

   ⚠️ **Armadilha medida, e silenciosa:** `renderer.setViewport()`/`setScissor()` são
   **ignorados** por quem troca de render target por baixo — a cada `setRenderTarget()` o
   three reaplica o scissor **do próprio `WebGLRenderTarget`**, não o que ficou solto no
   renderer. O recorte some sem erro nenhum e a seção passa a pintar sobre as vizinhas. Quem
   troca de target grava no `target.scissor`, e é isso que `frame.setScissorCss()` faz (em px
   CSS, convertendo o dpr num lugar só).

4. **Devolva o estado do renderer** como encontrou: `clearColor`, `autoClear`, `scissorTest`,
   `viewport`. Ele é global; sem a devolução, a próxima seção herda o seu recorte.
5. **Se a sua seção não desenha WebGL, ela é opaca no CSS.** Fora do recorte de quem desenhou
   o FBO está preto (contexto sem alpha, sem clear global): a seção sem WebGL é o fundo do
   próprio pedaço — `background: var(--bg)`.

O eixo Y inverte: `getBoundingClientRect()` conta de cima para baixo, o GL conta de baixo para
cima. Daí o `gl.size.h - rect.bottom`.

---

## 8. Transição entre duas cenas — `engine.composite`

```ts
engine.composite.setLayers({ scene: sceneA, camera: camA }, { scene: sceneB, camera: camB });
engine.composite.progress = beat.progress; // 0 = só A, 1 = só B
engine.composite.render(); // chame no seu tick, uma vez por quadro
```

Não é crossfade: em qualquer progresso intermediário a maioria dos pixels é 100% A ou 100% B,
e só uma borda estreita mistura — a diferença entre "a imagem some" e "a imagem é comida por
um padrão". A máscara padrão é gerada uma vez na CPU; `setMask(texture)` troca por outra.

Em `progress` 0 ou 1 ele desvia para um passe único: sem transição em curso, o segundo render
target e o quad final seriam custo puro.

Quem usa o composite **troca de render target no meio do quadro** → recorte pelo caminho (B)
da seção 7.

---

## 9. Planos colados no DOM — `createDomSync`

Para um mesh que precisa ficar exatamente sobre um elemento (imagem, ficha, bloco de texto):

```ts
import { createDomSync } from '@/engine';

const domSync = createDomSync(engine); // `Engine` satisfaz o host
domSync.track(el, mesh); // mesh com PlaneGeometry(1, 1) centrada
engine.ticker.subscribe(() => {
  domSync.update(); // mede tudo, depois posiciona tudo
  renderer.render(scene, domSync.camera);
});
```

A câmera é montada para que **1 px = 1 unidade** na profundidade dos planos: o mesh recebe
`scale = (w, h, 1)` em px e a posição sai direto do `getBoundingClientRect()`. Isso remove o
`scale: 2.4, y: -0.7` "no olho" que desalinha no primeiro resize.

`domSync.rectOf(el)` devolve o retângulo já lido **neste quadro** — use-o em vez de um segundo
`getBoundingClientRect()`. `projectMeshToScreen()` faz o caminho inverso e existe para o teste
provar que plano e texto não descolam, em px.

---

## 10. Encerrar

`engine.dispose()` desmonta tudo na ordem inversa da criação. Uma seção que cria recursos
próprios (geometria, material, render target, listener) devolve a própria função de limpeza —
`subscribe()`, `onResize()`, `track()` e `beats.register()` todos retornam o cancelamento.

---

## Erros que este motor existe para tornar impossíveis

| Sintoma                                           | Causa                                                  | Onde está a regra |
| ------------------------------------------------- | ------------------------------------------------------ | ----------------- |
| Uma seção apaga as outras                         | `renderer.clear()` fora do `beginFrame`                | §7.2              |
| Seção desenha sobre a vizinha, sem erro           | trocou de render target e usou `renderer.setScissor()` | §7.3              |
| Animação corre mais rápido em monitor de 120 Hz   | integrou sem `dt`                                      | §1                |
| Coreografia desalinha quando um texto cresce      | posição de scroll cravada                              | §3                |
| Cursor só afeta parte da cena                     | distância 3D até um ponto, em vez do raio              | §4                |
| Raio do cursor errado numa seção                  | outra cena chamou `setCamera` depois                   | §4                |
| `low` quebra e ninguém percebe                    | tier virou `if`, não número                            | §5                |
| A página inteira congela no quadro de outra seção | cadeia de rAF cortada; o rearme mora no `ticker`       | §1                |
