# Parte I — Infraestrutura

As quatro que sustentam quase todo o resto. Se a direção visual pede mais de um efeito
convivendo na mesma página, três delas (I.1, I.2, I.3) deixam de ser escolha e viram premissa.

---

## I.1 — Composite rendering (render target + quad de tela cheia)

**Problema.** Renderizar direto para a tela é um beco sem saída: não dá para transicionar entre
cenas, aplicar qualquer coisa por cima da imagem inteira sem duplicar geometria, nem sobrepor
camadas independentes com controle de profundidade. E, sem um alvo intermediário, a página é uma
colagem de caixas: cada momento 3D fica com a borda do seu próprio canvas e a imagem nunca compõe
como um quadro só.

**Mecanismo.** Dois passes.
1. A cena renderiza para um `WebGLRenderTarget` (um FBO), não para o canvas:
   `renderer.setRenderTarget(rt); renderer.render(scene, camera)`.
2. A textura resultante vira material de um **quad de tela cheia** numa segunda cena, que aí sim
   renderiza para o canvas — com um shader no meio.

Isso **desacopla o conteúdo da cena da sua apresentação**. Duas cenas em dois alvos fazem uma
transição virar `mix(texA, texB, progress)` num fragment. Um FBO de página compartilhado faz várias
seções escreverem no mesmo buffer e receberem o mesmo tratamento final — curva, bloom, vinheta,
grão, dither — num passe só.

**Consolidação é a otimização principal.** Cada passe extra é uma leitura e uma escrita da tela
inteira. Um shader composto que faz quatro coisas custa muito menos que quatro passes que fazem
uma cada. É também o que permite recusar `postprocessing`/`EffectComposer` sem perder o efeito
(ver regra 7: um composer aloca render targets **ao existir**, mesmo desligado).

**Custo.**
- GPU: um passe de tela cheia, que escala com pixels — logo é caro em desktop a dpr 2 e
  comparativamente barato num celular a dpr 1 (menos pixels), o inverso da intuição.
- Memória: um alvo do tamanho da viewport por camada viva.
- Bytes: zero. É código próprio, na casa de poucos KB.

**Quando NÃO usar.** Cena única, sem transição e sem tratamento de imagem. O passe extra não se
paga. Também não use como "camada de segurança para o caso de precisar depois": alvo alocado é
memória gasta e um `clear` a mais por quadro.

**Armadilhas.**
- **`renderer.setViewport()`/`setScissor()` são ignorados quando alguém troca de render target por
  baixo.** O three reaplica o scissor **do alvo que acabou de ser ligado** (`WebGLRenderTarget.scissor`),
  não o que ficou solto no renderer. Quem passa por um composite que alterna alvos precisa gravar em
  `target.scissor`/`target.viewport` (em px de device, não CSS); quem nunca troca de alvo depois de
  entrar em cena pode seguir com `renderer.setScissor()`.
- Um blur ou uma mistura pode **sobrescrever o canal alpha** sem querer.
- Precisão do buffer: ver o número medido abaixo antes de pedir half-float por reflexo.
- Sem `clear` global e com várias seções escrevendo no mesmo FBO, é preciso uma regra escrita de
  **quem desenha o quê no quadro** — senão o resultado é "quem desenhar por último vence", e o bug
  aparece só quando duas seções ficam visíveis ao mesmo tempo.

**Provado no protótipo 01.**
- FBO de página em **RGBA8, não RGBA16F**: 16F custava mediana de **13,72 ms** de GPU no tier alto
  (teto ~13,5); RGBA8 caiu para **9,8–12,05 ms**. O argumento que sustenta a troca é do mecanismo,
  não do orçamento: todas as técnicas da página já terminam com `linearToSrgb`, então o buffer nunca
  teve mais que 8 bits reais — **quem mata banding é o dither, não a precisão do buffer**.
- Dither por *Interleaved Gradient Noise* (aproximação de blue-noise **sem textura**) como último
  passo do passe de grade, depois do grão 1:1 — banding eliminado sem custo de memória.
- Bloom **inline** (taps largos no próprio FBO, zero `setRenderTarget` extra) em vez de mip-chain:
  a cadeia de mips tinha cauda de latência; a versão inline mantém mediana de GPU em 11,2–11,3 ms.
- `antialias: true` foi descartado com motivo mecânico: a imagem final vem de um quad, então o MSAA
  do backbuffer é descartado junto com o resto.

---

## I.2 — Sincronizar DOM <-> WebGL (1 px = 1 unidade)

**Problema.** Você quer shader sobre conteúdo que vive no HTML — imagens de uma galeria, um título,
um verbete — mantendo layout, scroll, seleção de texto e responsividade do DOM. Posicionar planos 3D
"no olho" nunca fecha, e quebra no primeiro resize.

**Mecanismo.** Faça **1 pixel valer 1 unidade de mundo**, escolhendo o FOV em função da altura do
viewport, com a câmera em `z = 100`:

```js
fov = 2 * Math.atan(height / 2 / 100) * (180 / Math.PI)
```

A altura visível passa a ser exatamente `window.innerHeight` em pixels, e um mesh de escala
`(800, 1000, 1)` mede 800x1000 px na tela. A conversão de coordenadas resolve as duas diferenças de
convenção (DOM tem origem no topo-esquerda, WebGL no centro, e o Y é invertido):

```js
x =  el.left - scroll - viewport.width  / 2 + el.width  / 2
y = -el.top            + viewport.height / 2 - el.height / 2
```

**Custo.** Uma leitura de layout por elemento por quadro (que a regra 3 obriga a coalescer) e um
draw call por plano. Bytes: zero.

**Quando NÃO usar.** Cena 3D de verdade, que não tem contraparte no DOM — aí o DOM só atrapalha.
Também não use para "colar" um efeito num elemento que rola rápido demais para o olho conferir o
alinhamento: o custo é o mesmo e ninguém vê o ganho.

**Armadilhas.**
- **Subtrair o scroll é obrigatório**, senão os meshes ficam parados enquanto o DOM rola.
- **Aspect ratio da textura**: uma imagem 1920x1080 num mesh 800x1000 distorce. Precisa de uma
  função `coverUv()` no shader emulando `object-fit: cover`.
- **Layout thrashing**: leia todos os `getBoundingClientRect()` **uma vez, antes** de escrever
  qualquer transform. Ler-escrever-ler-escrever força reflow síncrono (regra 3).
- No resize, atualize o FOV **e** `camera.updateProjectionMatrix()` **e** o tamanho do renderer —
  esquecer um dos três dá erro de escala que só aparece em telas de proporção incomum.
- Se o módulo de sincronia também informa a câmera ao módulo de ponteiro no resize, ele vira estado
  global: qualquer seção com câmera própria passa a receber um raio calculado para outra câmera.

**Provado no protótipo 01.** Desvio máximo entre o retângulo DOM e a projeção inversa do mesh:
**2,3e-13 px** em 140 amostras ao longo de 40 quadros (e ~1e-14 px numa segunda seção). O aceite
deixou de ser "parece alinhado" e virou número porque a verificação é a **projeção inversa** do
mesh de volta para coordenadas de tela. Em produção, `domSync.update()` é a única leitura de layout
do quadro (16 rects), e as seções derivam scroll e faixa de scissor desses mesmos rects.

---

## I.3 — Um ticker só para tudo

**Problema.** Cada biblioteca com seu `requestAnimationFrame` briga por timing. O gatilho de scroll
dispara microssegundos antes do valor atualizar; o resultado é judder que ninguém consegue debugar
porque cada camada, isolada, está correta.

**Mecanismo.** **Um único `rAF` no aplicativo inteiro**, com inscrições ordenadas. Quem precisa
rodar antes do resto (abrir o FBO do quadro) se inscreve primeiro; quem fecha (apresentar o quadro)
por último. Nada mais chama `requestAnimationFrame`.

A comunicação entre camadas é por **valores de progresso normalizados (0–1) como estado
compartilhado**, não por acoplamento direto: um valor de scroll único, e cada componente deriva sua
faixa local dele. Fontes concorrentes (scroll, hover, clique mantido) alimentam **um** valor via
`Math.max()`, o que permite transitar entre estados sem caminhos de animação paralelos brigando.

**Custo.** Zero em runtime. O custo é de arquitetura: um módulo de ticker e a disciplina de nunca
abrir o segundo laço, nem "só para um fallback".

**Quando NÃO usar.** Não existe caso. O que existe é a variante: sob `prefers-reduced-motion` o
ticker deixa de ser contínuo e passa a **demand mode** — só renderiza quando alguém marca sujo.
Isso é um modo do mesmo ticker, não um segundo laço.

**Armadilhas.**
- Um fallback de `rAF` dentro de um módulo auxiliar (por exemplo, para observar layout quando não
  há `ResizeObserver`) viola a regra em silêncio e é o caso mais comum de reincidência.
- Estado lido a 60 Hz não pode passar por mecanismo de reatividade de framework: guarde em módulo e
  leia dentro do laço.

**Provado no protótipo 01.** O site inteiro roda com **1 `rAF`**, incluindo o modo demand de
reduced-motion e a ficha de medição que atualiza ~1x/s dentro do ticker existente, sem abrir quadro
extra. Uma seção inteira de 17 animações roda com **zero JS de animação** (scroll-driven animations
nativas + `@starting-style`), o que é o caso limite da mesma regra: o melhor ticker é nenhum.

---

## I.4 — Ping-pong FBO (simulação que lê o próprio quadro anterior)

**Problema.** Efeitos com **memória** — fluido, trilha, difusão, propagação — precisam ler o estado
do quadro anterior. Um shader não pode ler e escrever a mesma textura.

**Mecanismo.** Dois render targets, A e B, que trocam de papel a cada quadro:
- A guarda o estado anterior;
- o shader lê A, aplica difusão/deslocamento, escreve em B;
- troca A <-> B.

No caso de uma trilha de fluido: amostra o quadro anterior em **cinco posições** (o próprio pixel e
quatro vizinhos deslocados por ruído), com mistura no sentido do escuro para o escuro se espalhar; e
soma um pouco de branco a cada quadro com `clamp` em 1.0, o que faz o rastro **sumir sozinho** quando
o cursor para — sem timer, sem estado em JS.

**Custo.** Duas texturas em memória permanentemente e um passe por quadro. Escala com pixels, então
é o tipo de efeito que se resolve rodando em resolução reduzida: a difusão esconde a interpolação.

**Quando NÃO usar.** Efeito sem estado. Se cada quadro é função só do tempo e da posição, é uniform,
não FBO — e um `uniform` custa zero contra dois alvos permanentes. Também evite quando um gradiente
radial dá o mesmo resultado a olho nu (ver III.2).

**Não foi provado no protótipo 01.** Nenhuma simulação com memória entrou no site. Trate o custo
como estimativa e meça o tempo de GPU do passe antes de fechá-lo no orçamento — o protótipo mediu
que o tier baixo é limitado por **overhead de geometria/draw call**, não por fill, então um passe que
escala com pixels pesa lá bem menos que a intuição sugere, e pesa mais no tier alto a dpr 2.
