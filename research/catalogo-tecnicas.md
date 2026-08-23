# 📐 Catálogo de Técnicas — efeitos web que valem conhecer

Companheiro de [`arsenal-visual.md`](./arsenal-visual.md). Lá estão as **ferramentas**; aqui estão
as **técnicas** — que é o que de fato transfere entre projetos.

Fonte principal: varredura do [Codrops](https://tympanus.net/codrops/) em agosto/2026 (tags
`webgl`, `three-js`, `gsap`), com leitura dos artigos de mecanismo. Cada entrada segue o mesmo
formato porque é isso que torna o catálogo consultável por um agente:

> **Problema** → **Mecanismo** → **Custo** → **Quando NÃO usar**

⚠️ **Um componente não é uma técnica.** "Card com gradiente" não entra aqui. "Depth prepass para
dar volume a nuvem de pontos aditiva" entra, porque explica *por que* funciona e se aplica a
problemas que ainda não apareceram.

---

# PARTE I — Infraestrutura
*As quatro que sustentam quase todo o resto. Aprender estas primeiro.*

## I.1 — Composite Rendering (render target + quad de tela cheia) ⭐⭐⭐

**Problema.** Renderizar direto para a tela é um beco sem saída: não dá para transicionar entre
cenas, aplicar post-processing sem duplicar geometria, nem sobrepor camadas independentes com
controle de profundidade.

**Mecanismo.** Dois passes.
1. A cena renderiza para um `WebGLRenderTarget` (um FBO), não para o canvas:
   `renderer.setRenderTarget(rt); renderer.render(scene, camera)`
2. A textura resultante vira material de um **quad de tela cheia** numa segunda cena, que aí sim
   renderiza para o canvas — com um shader no meio.

Isso **desacopla o conteúdo da cena da sua apresentação**. Com duas cenas em dois render targets,
uma transição vira simplesmente `mix(texA, texB, progress)` num shader.

**Custo.** Um pass extra + memória de textura. Armadilha citada: um blur pode **sobrescrever o
canal alpha** sem querer.

**Otimização.** Consolidar vários passes de post num único shader composto — menos passes, mais
performance.

**Quando NÃO usar.** Cena única sem transição nem post. O pass extra não se paga.

> 🔗 Base de: transições entre cenas, x-ray reveal, máscaras, qualquer post-processing sério.
> É pré-requisito de metade deste catálogo.
> [Artigo](https://tympanus.net/codrops/2026/02/23/composite-rendering-the-brilliance-behind-inspiring-webgl-transitions/)

---

## I.2 — Sincronizar DOM ↔ WebGL (1px = 1 unidade) ⭐⭐⭐

**Problema.** Você quer shader sobre conteúdo que vive no HTML — imagens de uma galeria, um título
— mantendo layout, scroll e responsividade do DOM. Reposicionar planos 3D "no olho" nunca fecha.

**Mecanismo.** Faça **1 pixel valer 1 unidade de mundo** escolhendo o FOV em função da altura:

```js
fov = 2 * Math.atan(height / 2 / 100) * (180 / Math.PI)   // câmera em z = 100
```

Com a câmera em `z = 100`, a altura visível é exatamente `window.innerHeight` **em pixels**. Aí um
mesh com escala `(800, 1000, 1)` mede 800×1000 pixels na tela.

Conversão de coordenadas (DOM tem origem no topo-esquerda, WebGL no centro, e o Y é invertido):

```js
x =  el.left - scroll - viewport.width  / 2 + el.width  / 2
y = -el.top            + viewport.height / 2 - el.height / 2
```

**Armadilhas.**
- **Subtrair o scroll é obrigatório.** Sem isso os meshes ficam parados enquanto o DOM rola.
- **Aspect ratio da textura**: imagem 1920×1080 num mesh 800×1000 distorce. Precisa de uma função
  `coverUv()` no shader para emular `object-fit: cover`.
- **Layout thrashing**: chame `getBoundingClientRect()` de todos os elementos **uma vez por frame,
  antes** de aplicar transforms. Ler-escrever-ler-escrever força reflow síncrono.
- No resize, atualize FOV **e** `camera.updateProjectionMatrix()` **e** o tamanho do renderer.

**Alternativa pronta.** [curtains.js](https://www.curtainsjs.com/) faz exatamente isso como
biblioteca. Vale usar se o projeto for só isso.

**Quando NÃO usar.** Cena 3D de verdade, que não tem contraparte no DOM.

> 🔗 [Artigo](https://tympanus.net/codrops/2026/02/19/creating-a-smooth-horizontal-parallax-gallery-from-dom-to-webgl/)

---

## I.3 — Um ticker só para tudo ⭐⭐⭐

**Problema.** GSAP, Lenis, Three.js e Web Audio cada um com seu `requestAnimationFrame` brigam por
timing. O ScrollTrigger dispara microssegundos antes do tween atualizar; o resultado é judder que
ninguém consegue debugar porque cada camada, isolada, está correta.

**Mecanismo.** **O ticker do GSAP dirige tudo.** O Lenis é acionado a partir de `gsap.ticker`, e o
render do three é disparado por updates do ScrollTrigger — não por um loop contínuo.

E o padrão de comunicação entre camadas: **valores de progresso normalizados (0–1) como estado
compartilhado**, não acoplamento direto. Um `scrollProgressRef` único coordena scrub de sequência
de imagens, explosão de partículas do título, reveal de cards e transição de cor — cada componente
deriva sua faixa local daquele valor.

Detalhe elegante do mesmo projeto: várias interações (scroll, hover, segurar o clique) alimentam um
**único** `explodeAmt` via `Math.max()`, o que permite transitar entre estados sem caminhos de
animação concorrentes.

**Falhas do jeito ingênuo.** Dessincronia assíncrona · duplo render · estados conflitantes (hover
brigando com scroll sem vencedor definido) · lag de áudio.

**Nota.** Esse projeto **não usou React Three Fiber** — de propósito, para ter controle direto do
loop compartilhado. É um trade-off real: o R3F te dá ergonomia e cobra o loop.

> 🔗 [Artigo](https://tympanus.net/codrops/2026/07/15/the-architecture-behind-trionn-coordinating-gsap-three-js-lenis-and-web-audio/)
>
> 💡 Isso valida por tabela a decisão do portfólio de ler o scroll de `window.scrollY` em vez do
> Lenis, e de manter tudo em refs lidos dentro do `useFrame` — mesma ideia, um estado só.

---

## I.4 — Ping-pong FBO (simulação que lê o próprio frame anterior) ⭐⭐

**Problema.** Efeitos com **memória** — fluido, trilha, difusão, propagação de calor — precisam ler
o estado do frame anterior. Um shader não pode ler e escrever a mesma textura.

**Mecanismo.** Dois render targets, A e B, que trocam de papel a cada frame:
- A guarda o estado anterior
- O shader lê A, aplica difusão/deslocamento, escreve em B
- Troca A ↔ B

No caso do fluido: amostra o frame anterior em **cinco posições** (o próprio pixel + quatro
vizinhos deslocados por ruído), com blending "darken" para o escuro se espalhar; soma um pouco de
branco a cada frame com `clamp` em 1.0, o que faz o rastro sumir sozinho quando o cursor para.

**Custo.** Duas texturas em memória permanentemente + um pass por frame.

**Quando NÃO usar.** Efeito sem estado. Se cada frame é função só do tempo, é uniform, não FBO.

---

# PARTE II — Mundos e cenas

## II.1 — Chunking: infinito com três segmentos ⭐⭐

**Problema.** Um corredor/mundo "infinito" não cabe na memória, e modelar quilômetros no Blender
não é viável.

**Mecanismo.** Só **três segmentos** ficam montados: aquele em que a câmera está, um à frente e um
atrás. Um manager cria e destrói conforme a câmera avança no eixo Z.

Segunda camada de corte, mais fina: cada segmento tem um wrapper de visibilidade que checa frame a
frame — passou 5 unidades de um segmento, ele some por inteiro, **zero draw calls** para geometria
que a câmera nem olha.

**Variante — grade 3×3.** Para um mundo navegável em duas dimensões (uma cidade), um único chunk
repetido numa grade 3×3 centrada na câmera. Ao cruzar a fronteira de um tile, os chunks
reposicionam. **Nove chunks em memória, independente do tamanho do mundo.**

**Armadilhas.** Costuras entre chunks têm de fechar perfeitamente — qualquer desalinhamento de UV
ou geometria salta aos olhos. O wrap de posição precisa bater exatamente com o tamanho do chunk.
No caso do corredor, entrada em ângulo causou vazamento e exigiu **curvar a fronteira de clipping**.

**A sacada maior.** O corredor inteiro é feito de **planos chatos com textura desenhada à mão** —
nenhum modelo 3D. O autor: *"eu não sabia esculpir um mundo no Blender, então desenhei um em
retângulos chatos"*. Troca realismo geométrico por performance e controle artístico.

> 🔗 [Corredor infinito](https://tympanus.net/codrops/2026/06/11/sketching-the-impossible-a-3d-portfolio-built-without-a-single-3d-model/) ·
> [Cidade em grade 3×3](https://tympanus.net/codrops/2026/07/10/the-sleepers-creating-an-atmospheric-webgl-experience-with-lightweight-techniques/)

---

## II.2 — Fog animado por injeção de shader ⭐⭐

**Problema.** Fog nativo do three é linear e morto. Atmosfera de verdade se move.

**Mecanismo.** Dois passos, via `onBeforeCompile()` no material existente:
1. **Fog por posição de mundo**: acima de certo Y a cor fica intacta, abaixo vira a cor do fog, com
   `smoothstep()` na transição.
2. **Animar com textura de ruído seamless** deslocada no tempo, com *domain warping* distorcendo a
   superfície do fog. A distância até a câmera controla a profundidade.

**Por que é barato.** Reaproveita uma **textura** de ruído seamless em vez de calcular Perlin/Simplex
por fragment. Uma amostra por material.

**Armadilhas.** É injetado em **todo** material — cuidado em cena com muitos polígonos. Frequência e
velocidade precisam de equilíbrio ou a repetição fica óbvia.

---

## II.3 — Contorno por inverted hull (backface) ⭐

**Problema.** Contorno de malha estilo cel-shading/desenho, sem pass de post-processing.

**Mecanismo.** Duplica a geometria com **normais invertidas** e deslocada para fora, material preto.
Feito no **Blender**, não em runtime: modificador Solidify com espessura negativa, normais
invertidas e offset de material apontando para o slot do contorno. Exporta com "apply modifiers", e
no JS reatribui para `MeshBasicMaterial`.

**Por que é barato.** É pré-processamento. Nada por frame — só geometria a mais renderizada uma vez.

**Armadilhas.** O número do slot varia por mesh (use um número alto e o Blender cai no último). O
three não converte Principled BSDF para `MeshBasicMaterial` sozinho.

**Quando NÃO usar.** Muitos objetos — dobra a contagem de triângulos. Aí vale um pass de post
baseado em normal+depth.

---

# PARTE III — Revelações e transições

## III.1 — Máscara de threshold (transição em redemoinho) ⭐⭐

**Problema.** Transição de tela cheia que não seja um crossfade genérico.

**Mecanismo.** Uma textura preto-e-branco funciona como **threshold por pixel**. Um uniform
`uProgress` anima de 0 a 1; cada fragment vira quando o progresso ultrapassa o valor daquele pixel
na textura. Basicamente um `step()` por fragment.

Trocar a textura troca a transição inteira — espiral, ondas, dissolução, listras — **sem tocar no
shader**. É o padrão mais barato de personalizar que existe.

**Por que é barato.** Uma amostra de textura + aritmética simples por fragment. Pass único.

**Armadilhas.** Máscara de baixa resolução gera banding visível. A curva (`pow(uProgress, 5.)`)
precisa de ajuste para parecer natural.

---

## III.2 — X-ray reveal com fluido ⭐⭐

**Problema.** Revelar uma segunda camada (esqueleto, wireframe, "por dentro") seguindo o cursor, de
forma orgânica em vez de um círculo duro.

**Mecanismo.** Combina I.1 e I.4:
1. **Duas cenas** compartilhando câmera e luz — corpo sólido e esqueleto — cada uma no seu render target.
2. A **máscara** nasce do cursor: um canvas desenha um rastro circular preto sobre branco.
3. Esse rastro alimenta uma **simulação de fluido ping-pong** — difundido para fora, modulado com
   ruído FBM, desbotando para branco.
4. No post, a máscara é invertida e usada como fator de `mix` entre as duas cenas.

**Quando NÃO usar.** Se um gradiente radial resolve. A sim de fluido custa dois FBOs por frame.

> 🔗 [Artigo](https://tympanus.net/codrops/2026/03/23/building-a-dual-scene-fluid-x-ray-reveal-effect-in-three-js/)

---

## III.3 — Cena WebGL persistente entre páginas ⭐⭐⭐

**Problema.** Navegar entre páginas destrói o contexto WebGL: recarrega modelo, recompila shader,
pisca. Mata a sensação de "aplicativo" que sites premiados têm.

**Mecanismo.** O **canvas fica fora do container que o roteador troca**:

```html
<body data-barba="wrapper">
  <canvas class="webgl"></canvas>   <!-- persiste -->
  <div data-barba="container">      <!-- só isto é trocado -->
```

| Persiste | É reconstruído |
|---|---|
| Canvas, `Experience` singleton | HTML dentro do container |
| Modelos GLB carregados (`Resources`) | Timelines GSAP da página |
| Scene, camera, renderer, luzes | O `data-barba-namespace` |
| Estado de interação do mouse | |

**Detalhes que decidem.**
- O `Experience` tem que ser **singleton**, criado no hook `once`, reusado depois.
- Modelos são **clonados**, nunca recarregados (`GLTFLoader` + DRACO uma vez só).
- A câmera anima **em paralelo** com a transição de conteúdo — é isso que dá coesão. Um mapa
  `namespace → posição da câmera` dirige o movimento.
- Use **`ResizeObserver` no canvas**, não `window.resize`.
- `gsap.matchMedia()` para respeitar `prefers-reduced-motion`.

**Por que funciona.** O contexto de GPU nunca é destruído.

> 🔗 [Artigo](https://tympanus.net/codrops/2026/03/18/building-seamless-3d-transitions-with-webflow-gsap-and-three-js/)

---

# PARTE IV — Imagem e superfície

## IV.1 — Reacender foto 2D com depth map ⭐⭐⭐

**Problema.** Fazer uma foto comum reagir à luz e ao cursor como se tivesse relevo — sem modelar
nada em 3D.

**Mecanismo.** Três peças sobre um plano chato:
1. **Depth map** gerado por modelo de estimativa de profundidade (ex.: Depth Anything 3). Branco =
   perto, preto = longe.
2. **Normais calculadas a partir do depth**, não de geometria: amostra a textura de profundidade e
   calcula a inclinação da superfície. *Essa única manipulação já faz um plano chato responder à luz
   como se tivesse volume.*
3. **Sombras por ray march**: cada pixel traça uma linha até a luz atravessando o depth map; achou
   uma elevação no caminho, está na sombra. Amostrar vários pontos acumula oclusão e dá sombra suave.

**Refinamento que faz a diferença.** Depth map de 8 bits tem só 256 valores — vira ruído granulado
quando a luz lê a inclinação. Converta para float, **borre para matar a quantização**, guarde como
half-float.

**Truque extra.** Extrair um segundo gradiente do **brilho da própria imagem** e fundir com o
gradiente da profundidade — adiciona detalhes pintados que leem como sulcos sob luz em movimento.

**Limites.** Só auto-oclusão (um elemento não projeta sombra em outro em profundidade diferente) ·
o realismo depende da qualidade da estimativa · o ray march de sombra custa GPU.

**Stack.** TSL + WebGPU + `MeshPhongNodeMaterial`.

> 🔗 [Artigo](https://tympanus.net/codrops/2026/08/19/relighting-images-with-depth-maps-and-three-js/)
>
> 💡 **Alto potencial para a ferramenta.** Transforma qualquer imagem do cliente em superfície
> interativa. Custo de autoria ~zero (o depth map é gerado por modelo), e o resultado não parece
> template nenhum.

---

# PARTE V — Do próprio portfólio
*Técnicas que já provamos em produção. Entram no catálogo por serem transferíveis.*

## V.1 — Depth prepass para nuvem de pontos aditiva ⭐⭐⭐

**Problema.** Sprites aditivos com `depthWrite: false` não se ocluem. Numa nuvem densa, o lado de
trás soma através do da frente e o **meio da silhueta vira a região mais clara e menos estruturada**
do quadro. Atenuar o fundo por orientação só escurece — todos os pontos continuam sendo desenhados.

**Mecanismo.** Uma malha decimada e **invisível** do mesmo objeto, desenhada antes:

```jsx
<meshBasicMaterial colorWrite={false} depthWrite depthTest side={DoubleSide} />
```

`colorWrite: false` → nenhum pixel muda de cor. `depthWrite: true` → a superfície próxima entra no
depth buffer. O `depthTest` normal da nuvem **descarta ~70% dos pontos**. Um draw call, zero fill.

**Detalhes.** `DoubleSide` porque o winding da decimação é consistente mas de direção desconhecida —
com culling, um modelo invertido ocluiria nada. E o hull precisa ser **encolhido** ~4% do raio pelas
próprias normais, senão engole as reentrâncias que deveria revelar.

**Ganho colateral.** A luz que os pontos ocultos gastavam volta ao orçamento — deu para **dobrar a
contagem de pontos** mantendo o mesmo total de luz somada.

> 📁 `portfolio-3d/src/three/BrainCloud.tsx` (`OccluderMesh`)

## V.2 — Beats ancorados no DOM ⭐⭐⭐

**Problema.** Coreografia ligada ao scroll com posições cravadas (`at: 0.36`) quebra em silêncio: os
números foram lidos numa versão do conteúdo, num viewport. Um card a mais em qualquer lugar acima
desalinha tudo.

**Mecanismo.** Inverte quem sabe. A seção **entrega um elemento DOM** ao registro; um
`ResizeObserver` — que observa também o `documentElement`, porque algo crescendo *acima* move o beat
sem redimensioná-lo — converte em progresso 0–1. Medições coalescidas num `rAF`.

**Detalhe React.** Store de **módulo**, não context: o consumidor está dentro do `<Canvas>`, que tem
reconciliador próprio, e o valor é lido 60×/s dentro do `useFrame`.

> 📁 `portfolio-3d/src/three/beats.ts`

## V.3 — Damping assimétrico ⭐⭐

**Problema.** Uma taxa de damping só não consegue ser rápida na perseguição e macia no assentamento.
Baixa demais, "demora uma eternidade"; alta demais, estala a cada ajuste de scroll.

**Mecanismo.** A taxa é função da **distância até o alvo**, não do tempo de frame:
`lerp(settle, reach, smoothstep(gap / REACH_DISTANCE))`. Cortou uma troca de lado de 0,90 s para
0,27 s sem perder a maciez. Como continua sendo `MathUtils.damp`, segue independente de frame rate.

> 📁 `portfolio-3d/src/three/ScrollStage.tsx`

## V.4 — Cursor como raio, não como ponto ⭐⭐

**Problema.** Repulsão de cursor medida como distância 3D até um ponto (o cursor projetado num
plano) só afeta a fatia do objeto perto daquele plano. Sintoma: *"só funciona em algumas partes"*.

**Mecanismo.** Guarde a direção do cursor em view space **dividida pela própria profundidade**.
Multiplicada pelo `z` do ponto, dá onde o raio passa **naquela profundidade** — a profundidade se
cancela:

```glsl
vec2 pointerOffset = mvPosition.xy - uPointerRay * mvPosition.z;
```

A influência vira um **cilindro em torno do raio** em vez de esfera em torno de um ponto dele. Bônus:
como está em view space, é imune a qualquer transform aplicado ao grupo.

> 📁 `portfolio-3d/src/three/shaders/brainCloud.ts`

## V.5 — Quantização Int16 normalizada (payload sem decode) ⭐⭐

**Problema.** Buffers de geometria em `Float32` são o download da página.

**Mecanismo.** Grave `Int16` e entregue com `normalized: true`:
`new THREE.BufferAttribute(data, 3, true)`. **A GPU divide por 32767 no fetch do atributo, de
graça.** Não existe passe de decode. 48k pontos com posição+normal+curvatura: 659 KB em `Int16`
contra 1,3 MB em `Float32`.

Precisão não é problema — o quantum é ~700× menor que o espaçamento entre vizinhos.

**Combine com shuffle determinístico** no build: qualquer prefixo do array vira amostra uniforme do
todo, então escalar por dispositivo é **um `setDrawRange`**, sem segundo buffer.

> 📁 `portfolio-3d/scripts/build-brain-pointcloud.ts`

---

# PARTE VI — Regras que atravessam tudo

Destiladas da varredura. Candidatas a virar validação automática na ferramenta.

1. **Progresso normalizado 0–1 como moeda comum.** Scroll, hover, áudio, tempo — tudo vira 0–1 e
   cada camada deriva sua faixa. Combine fontes concorrentes com `Math.max()`, não com caminhos
   paralelos.
2. **Um ticker, um estado.** Múltiplos `rAF` é a causa raiz de judder inexplicável.
3. **Meça uma vez por frame, antes de escrever.** `getBoundingClientRect()` em lote.
4. **Pré-processe o que não muda.** Contorno no Blender, ruído como textura, quantização no build.
   Runtime é para o que responde ao usuário.
5. **Textura em vez de procedural quando o olho não distingue.** Ruído seamless amostrado bate
   Perlin calculado por fragment.
6. **Escale por dispositivo com um número, não com um caminho de código.** `setDrawRange`, contagem
   de instâncias, densidade — nunca uma cena alternativa.
7. **Não monte o que está desligado.** Um `<EffectComposer>` aloca render targets ao existir; gatear
   por flag interna não economiza nada.
8. **`prefers-reduced-motion` desde a arquitetura.** Não é um `if` no fim — muda o frameloop, os
   callbacks assinados e o tier.
9. **Toda constante mágica precisa de um comentário com a medição.** Foi medido? Com qual método?
   Sem isso ninguém pode mexer com segurança depois.

---

# Backlog — artigos mapeados, mecanismo ainda não extraído

Levantados na varredura, valem leitura futura. Ordenados por potencial.

**Alto**
- [Composite rendering em pipeline WebGPU com transições seletivas de cena](https://tympanus.net/codrops/2026/05/19/80s-business-tech-seamless-scene-transitions-inside-shader-ses-scroll-driven-webgpu-pipeline/) (mai/26)
- [Geometria procedural com WebGPU — "geometry painter" com surface picking](https://tympanus.net/codrops/2026/08/11/exploring-procedural-geometry-with-three-js-and-webgpu/) (ago/26)
- [Milhões de elementos procedurais com compute shaders](https://tympanus.net/codrops/2026/04/21/false-earth-from-webgl-limits-to-a-webgpu-driven-world/) (abr/26)
- [DOM + WebGL dividindo o palco, com glass shaders](https://tympanus.net/codrops/2026/08/15/inside-haoqi-design-letting-dom-and-webgl-share-a-retro-futurist-stage/) (ago/26)
- [GSAP dirigindo uniforms de shader e wipes de clip-path](https://tympanus.net/codrops/2026/05/06/from-shader-uniforms-to-clip-path-wipes-how-gsap-drives-my-portfolio/) (mai/26)

**Médio**
- [Caminho de câmera autorado no Blender + scroll](https://tympanus.net/codrops/2026/07/07/building-a-scroll-driven-3d-gallery-using-a-blender-camera-path-with-three-js-and-gsap/) · [Cluster 3D interativo com TSL](https://tympanus.net/codrops/2026/08/12/creating-an-interactive-3d-cluster-with-three-js-tsl-and-three-start/) · [Grid de cubos com propagação de onda](https://tympanus.net/codrops/2026/07/09/building-an-interactive-wave-propagation-cube-grid-with-three-js/) · [Tubo de imagens infinito com inércia](https://tympanus.net/codrops/2026/02/17/reactive-depth-building-a-scroll-driven-3d-image-tube-with-react-three-fiber/) · [Goo reativo a música](https://tympanus.net/codrops/2026/08/20/run-rob-run-building-a-music-reactive-goo-with-three-js-and-webgpu/) · [Galeria por velocidade de scroll com paleta por humor](https://tympanus.net/codrops/2026/03/09/building-a-scroll-reactive-3d-gallery-with-three-js-velocity-and-mood-based-backgrounds/) · [Xilofone de vidro: instancing + fluido](https://tympanus.net/codrops/2026/08/04/building-an-endless-interactive-glass-xylophone-with-three-js/)

**Curiosidade / nicho**
- [160.000 cubos visualizando dithering](https://tympanus.net/codrops/2026/04/01/animating-160000-cubes-in-three-js-to-visualize-dithering/) · [Cobra procedural infinita (steering + Bézier)](https://tympanus.net/codrops/2026/02/10/building-an-endless-procedural-snake-with-three-js-and-webgl/) · [Aquarela não-fotorrealista](https://tympanus.net/codrops/2026/04/24/susurrus-crafting-a-cozy-watercolor-world-with-three-js-and-shaders/) · [Trilha de mouse com gravidade](https://tympanus.net/codrops/2026/05/20/made-with-gsap-building-a-fun-gravity-based-mouse-trail/) · [MotionPath: thumbnails em trajetória curva](https://tympanus.net/codrops/2026/06/04/creating-a-thumbnail-flow-animation-with-gsap-motionpath/) · [Proposta HTML-in-Canvas](https://tympanus.net/codrops/2026/05/13/exploring-the-html-in-canvas-proposal/)

**Fora do Codrops, ainda por varrer:** [Three.js Resources](https://threejsresources.com/) ·
[awesome-threejs](https://github.com/AxiomeCG/awesome-threejs) ·
[Shadertoy](https://www.shadertoy.com/) (padrões de shader) ·
[The Book of Shaders](https://thebookofshaders.com/) (fundamentos) ·
[Unicorn Studio](https://www.unicorn.studio/) (composição de shader sem código)

---

*Varredura de agosto/2026. Técnicas I.1–IV.1 com mecanismo extraído do artigo; Parte V verificada
no código do próprio portfólio.*
