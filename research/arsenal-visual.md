# 🎛️ Arsenal Visual — material para a ferramenta de sites impressionantes

Ver também: [`catalogo-tecnicas.md`](./catalogo-tecnicas.md) — as técnicas extraídas da varredura do Codrops.

Dossiê de coleta. Pesquisa feita em **agosto/2026**. O objetivo final é destilar isto numa
ferramenta (skill, MCP ou framework) que produza sites que impressionam **e não têm cara de IA**.

Este arquivo é material bruto curado, não a ferramenta. Ele registra **o que existe, para que
serve, e quando NÃO usar** — a terceira coluna é a que mais vale, porque é a que impede a
ferramenta de virar um gerador de média.

---

## 0. A tese central — por que isso importa

A pesquisa confirmou o diagnóstico com todas as letras:

> *"AI predicts the most likely design, and the most likely design is the average of everything
> it trained on. It's not copying any one site but averaging all of them, and the average is by
> definition the least distinctive option available."*
> — [Shuffle](https://shuffle.dev/blog/2026/01/why-do-most-ai-generated-websites-look-the-same/)

**Isso é o problema a resolver.** Não é falta de bibliotecas — as bibliotecas estão todas aí e são
gratuitas. É que o caminho de menor resistência de um LLM leva sempre ao mesmo hero + gradiente +
grid de três colunas + Inter.

O portfólio 3D fugiu disso. Vale entender **por quê**, porque é o núcleo da ferramenta:

| O que fez a diferença | Por quê |
|---|---|
| **Uma ideia específica, não um estilo** | "Cérebro em nuvem de pontos com constelação de agentes" é uma decisão de conteúdo. "Site moderno com animações" é um prompt de média. |
| **Restrições numéricas medidas** | Orçamento de luz somada, contraste medido por pixel, FPS em GPU real. Restrição dura força soluções não-óbvias. |
| **Um problema técnico real, resolvido** | O depth prepass não existe em nenhum tutorial — nasceu de "a nuvem não lê como cérebro". Problema real → solução original. |
| **Asset próprio** | Um `.obj` processado por pipeline próprio, não um preset de biblioteca. |
| **Rejeição iterada** | Você rejeitou o fogo, rejeitou o poliedro, rejeitou os cards. Cada rejeição empurrou para longe da média. |

**Corolário para a ferramenta:** ela não pode ser "escolha efeitos de um catálogo". Tem que ser
algo que force ideia específica + restrição medida + iteração de rejeição. Catálogo é insumo, não
produto.

---

## 1. Renderização 3D / WebGL / WebGPU

### O estado da arte em 2026

Dado concreto: dos 47 vencedores de *Site of the Day* do Awwwards no Q1/2026 —
**29 usaram Three.js**, 8 usaram WebGL cru com shaders próprios, 4 usaram Babylon.js.
([Hon Tran](https://www.hontran.dev/blog/webgl-website-examples))

| Ferramenta | O que é | Quando usar | Quando NÃO usar |
|---|---|---|---|
| **[Three.js](https://threejs.org/)** | O padrão de fato | Praticamente sempre que houver 3D | Se o efeito cabe em CSS/SVG |
| **[React Three Fiber](https://r3f.docs.pmnd.rs/)** | Reconciliador React → three | Projeto React; cena que reage a estado | Cena estática sem React |
| **[drei](https://github.com/pmndrs/drei)** | Helpers do R3F | Sempre junto do R3F | — |
| **[Babylon.js](https://www.babylonjs.com/)** | Engine mais "completa" | Jogos, física integrada, editor | Cena decorativa (peso maior) |
| **[OGL](https://github.com/oframe/ogl)** | WebGL minimalista (~10× menor que three) | Um efeito só, bundle crítico | Cena com muitos sistemas |
| **[curtains.js](https://www.curtainsjs.com/)** | ⭐ Transforma **elementos DOM** em planos WebGL texturizados | Efeito de shader em imagens/vídeos que já estão no HTML, respeitando scroll e resize | Cena 3D de verdade |

**`curtains.js` merece destaque.** Ele resolve um problema que as outras libs fingem que não
existe: aplicar shader em conteúdo que vive no DOM, mantendo posição, scroll e responsividade.
É a ponte HTML↔WebGL — exatamente o tipo de coisa que dá "efeito impressionante" com pouco
esforço estrutural. Tem `ShaderPass` com FBO para post-processing. Wrappers React e Vue existem.

### WebGPU — virou realidade este ano

- **84,68%** de suporte global (março/2026); shipping por padrão em Chrome, Edge, Firefox e Safari
  ([webo360](https://webo360solutions.com/blog/webgpu-browser-support/), [byteiota](https://byteiota.com/webgpu-2026-70-browser-support-15x-performance-gains/))
- Safari 26 trouxe suporte em macOS/iOS/iPadOS/visionOS
- **Three.js `WebGPURenderer` é zero-config desde a r171** (set/2025)
- Ganho típico: **2–10×** em cenas complexas

### TSL — Three Shading Language ⭐

A mudança mais relevante do three.js em 2026. Shaders escritos **em JavaScript** como grafo de nós,
em vez de strings GLSL. O renderer compila para **GLSL no WebGL e WGSL no WebGPU** — mesmo código,
dois backends.

Por que importa para a ferramenta: shader em string é opaco, não compõe e não refatora. Um grafo em
JS é **programável** — dá para gerar, combinar e mutar shaders programaticamente. Para uma ferramenta
que *gera* efeitos, isso é decisivo.

Recursos: [Wawa Sensei](https://wawasensei.dev/courses/react-three-fiber/lessons/webgpu-tsl) ·
[Introdução (Prasetyo)](https://arie-m-prasetyo.medium.com/introduction-to-tsl-0e1fda1beffe) ·
[Threlte docs](https://threlte.xyz/docs/learn/advanced/webgpu/)

### Ecossistema R3F

`@react-three/postprocessing` · `@react-three/uikit` (UI renderizada em WebGL) ·
`@react-three/offscreen` (canvas em worker) · `@react-three/flex` · `gltfjsx` (GLTF → JSX)

Equivalentes em outros frameworks: **[Threlte](https://threlte.xyz/)** (Svelte) ·
**[TresJS](https://tresjs.org/)** (Vue) · **Angular Three**

**[Three-VFX](https://github.com/mustache-dev/Three-VFX)** — sistema de partículas via compute
shaders na GPU, funciona em R3F, TresJS e Threlte.

---

## 2. Animação e scroll

| Ferramenta | O que é | Nota |
|---|---|---|
| **[GSAP](https://gsap.com/)** | Timeline + ScrollTrigger | ⭐ **100% grátis desde abr/2025**, incluindo todos os plugins premium |
| **[Lenis](https://lenis.darkroom.engineering/)** | Smooth scroll com inércia | Rola a janela de verdade — não quebra `sticky` nem `scrollY` |
| **[Motion](https://motion.dev/)** | Sucessor do Framer Motion | ~8 KB, ótimo em React |
| **[Anime.js v4](https://animejs.com/)** | Motor modular com física | Vanilla JS |
| **[Theatre.js](https://www.theatrejs.com/)** | ⭐ Editor de timeline **visual no browser** para objetos definidos em código | Keyframe de cena three.js arrastando no navegador, não chutando números |

**GSAP virou grátis** — esse é provavelmente o fato mais acionável desta pesquisa. A Webflow
comprou a GreenSock em out/2024 e liberou tudo em abr/2025: **SplitText, MorphSVG, DrawSVG,
ScrollSmoother, ScrambleText** — sem licença, sem token, sem Club.
([GSAP 3.13](https://gsap.com/blog/3-13/) · [Codrops: 5 demos com os plugins liberados](https://tympanus.net/codrops/2025/05/14/from-splittext-to-morphsvg-5-creative-demos-using-free-gsap-plugins/))

**Theatre.js** é o que falta no portfólio hoje: os `STAGE_BEATS` foram autorados na mão, com
números. Um editor de timeline visual sobre a mesma cena eliminaria o chute.

### A abordagem que os sites premiados usam

> *"The best animated websites in 2026 do not use one library. They use the right library for each
> specific job, combined deliberately, with performance budgets respected at every layer.
> Motion handles component animations, GSAP handles scroll sequences, Lenis handles scroll feel,
> and Three.js handles any 3D scenes."*

Vale registrar como princípio da ferramenta: **combinação deliberada com orçamento por camada**,
não uma lib que faz tudo.

---

## 3. ⚠️ O que o browser já faz sozinho (não ignorar)

Isto mudou em 2025–2026 e muda o cálculo de "preciso de biblioteca?":

- **CSS scroll-driven animations** — shipping em Chrome, Edge, Firefox e Safari desde meados de
  2025; **90%+ de suporte**. `animation-timeline: scroll()` e `view()` substituem
  `IntersectionObserver` para reveal e progresso ligado ao scroll. Zero bundle, roda fora da main
  thread.
- **View Transitions API** — transições entre estados do DOM e **entre páginas**. Chrome/Edge/Safari
  desde 2024; Firefox com suporte parcial no começo de 2026.

([Frontend Horizon](https://www.frontendhorizon.com/blog/view-transitions-api-and-css-scroll-driven-animations-the-browser-wins-of-2026) ·
[Mintec](https://mintec.co/blog/css-scroll-driven-animacion/))

**Regra para a ferramenta:** antes de importar GSAP para um fade-in no scroll, checar se CSS nativo
resolve. É mais rápido, mais leve e não quebra. Biblioteca entra quando há *sequenciamento* real.

---

## 4. Componentes prontos (copy-paste)

Todos entregam **código-fonte**, não dependência npm — você é dono do arquivo.

| Lib | Foco | Nota |
|---|---|---|
| **[React Bits](https://reactbits.dev/)** | 110+ componentes: animações de texto, backgrounds | #3 no JS Rising Stars 2025, +26k stars. Já aprovado para o portfólio |
| **[Aceternity UI](https://ui.aceternity.com/)** | Dramático: spotlight, cards 3D, partículas | Tailwind + Framer Motion |
| **[Magic UI](https://magicui.design/)** | Landing pages animadas | Shimmer button, gradient text, blur fade |
| **[shadcn/ui](https://ui.shadcn.com/)** | Base sóbria | Recomendação comum: shadcn de base + os outros como tempero |

⚠️ **Armadilha dupla:**
1. Modelo copy-paste = **updates manuais**. Bug corrigido upstream não chega sozinho.
2. **São exatamente a fonte da "cara de IA".** Um Aurora Background da React Bits é reconhecível à
   primeira vista porque está em dez mil sites. Usar como **base para adaptar** (paleta, timing,
   comportamento), nunca como está. No portfólio isso já foi definido assim: adaptar à paleta fria
   e respeitar `prefers-reduced-motion`.

---

## 5. Ferramentas de autoria (fora do código)

| Ferramenta | O que é | Preço | Quando NÃO usar |
|---|---|---|---|
| **[Blender](https://www.blender.org/)** | Modelagem 3D → GLTF | Grátis | Curva íngreme; prototipagem rápida |
| **[Spline](https://spline.design/)** | 3D no browser com export web | Grátis / $12+ | Trabalho 3D complexo; cenas pesam no mobile |
| **[Rive](https://rive.app/)** | ⭐ Animação vetorial 2D com **state machines** | Grátis / pago | Quando precisa ser 3D |
| **[Theatre.js](https://www.theatrejs.com/)** | Timeline visual para código | Grátis, OSS | Animação trivial |

**Rive** é subestimado e muito relevante aqui: 2D vetorial é **ordens de grandeza mais leve** que 3D
em tempo real, e as *state machines* dão interatividade real (hover, loading, sucesso/erro) num
arquivo só. Para micro-interação e ícone reativo, ganha do three.js com folga.

**Distinção útil:** Rive = 2D interativo que roda em qualquer lugar. Spline = cena 3D bonita com
custo de render 3D. Theatre.js = timeline para cena que **você** codou.

---

## 6. Shaders — aprender e ferramentar

| Recurso | O que é |
|---|---|
| **[The Book of Shaders](https://thebookofshaders.com/)** | Guia interativo de GLSL. Grátis. A referência |
| **[Three.js Journey](https://threejs-journey.com/)** | Curso do Bruno Simon. Do zero a shaders + post-processing |
| **[Shadertoy](https://www.shadertoy.com/)** | Sandbox de fragment shaders. Aprender e prototipar — não produção |
| **[NodeToy](https://nodetoy.co/)** | Editor **visual** de shader |
| **[Codrops](https://tympanus.net/codrops/)** | ⭐ Tutoriais + demos com código: distorção, transições de imagem, texto |

**Codrops é uma mina** e merece varredura sistemática — [tag WebGL](https://tympanus.net/codrops/tag/webgl/),
[tag distortion](https://tympanus.net/codrops/tag/distortion/),
[Creative Hub](https://tympanus.net/codrops/hub/tag/distortion/). Efeitos catalogados: hover com
displacement map, transições de imagem com warp, bulge distortion, distorção de tipografia,
mesh outlines, fog animado, mundos infinitos.

---

## 7. Física, som e interação

| Ferramenta | Nota |
|---|---|
| **[Rapier](https://rapier.rs/)** | Engine em Rust via WASM. **2–5× mais rápido** que a versão de 2024; foco de 2025 foi justamente performance no browser |
| **[Matter.js](https://brm.io/matter-js/)** | 2D, mais simples, ótimas ferramentas de debug |
| **[Tone.js](https://tonejs.github.io/)** | Áudio sintetizado e reativo no browser |

Som é o eixo **mais subexplorado** em sites impressionantes — e o mais arriscado (autoplay é
hostil). Feedback sonoro sutil, opt-in, em interação deliberada é território pouco ocupado.

---

## 8. Tipografia cinética

- **Variable fonts** expõem eixos (peso, largura, slant) como propriedades CSS **animáveis** — é
  animação de tipografia sem JS e sem imagem.
- **GSAP SplitText** agora é grátis: quebra texto em linhas/palavras/caracteres para stagger.
- **[SplitType](https://github.com/lukePeavey/SplitType)** — alternativa leve e gratuita de sempre.
- Tendência 2026: texto que responde a **scroll, cursor e áudio**, não só entra na tela.

⚠️ Trocar Inter por uma fonte com personalidade é citado repetidamente como a correção nº 1 contra
a cara genérica.

---

## 9. Dev tooling

| Ferramenta | O que faz |
|---|---|
| **[Leva](https://github.com/pmndrs/leva)** | ⭐ Painel de GUI para tunar uniforms, cores e números **ao vivo** |
| **[r3f-perf](https://github.com/utsuboco/r3f-perf)** | Draw calls, geometrias, GPU — específico de R3F |
| **[Stats.js](https://github.com/mrdoob/stats.js)** | FPS, frame time, memória |

**Leva resolve um problema real do portfólio.** As constantes de calibração (`BRAIN_CALIBRATION`,
`BLOOM`, `STAGE_BEATS`) foram achadas por edita-recarrega-olha. Um painel em dev cortaria esse ciclo
para segundos. Custo zero em produção (fica atrás de flag de dev).

---

## 10. Assets

- **[Poly Haven](https://polyhaven.com/)** — HDRIs, texturas e modelos **CC0**, sem atribuição, uso
  comercial livre. Qualidade de produção.

⚠️ Lição do próprio portfólio: **registrar a procedência e a licença do asset no README na hora de
baixar**. O `Brain_Model.obj` já está com origem indeterminada, num repositório público.

---

## 11. Inspiração e referência

- **[Awwwards](https://www.awwwards.com/)** — Site of the Year 2025: site oficial do Lando Norris,
  pelo estúdio **OFF+BRAND**
- **[FWA](https://thefwa.com/)**
- **[Codrops](https://tympanus.net/codrops/)** — tutorial + código, não só vitrine
- **[awesome-threejs](https://github.com/AxiomeCG/awesome-threejs)** — lista curada
- **[Three.js Resources](https://threejsresources.com/)** — diretório de ferramentas
- **Three.js Conference Paris — 10 e 11 de setembro de 2026**

Estúdios que valem estudo de caso: OFF+BRAND, Utsubo, Psychoactive.

---

## 12. Notas para o design da ferramenta

Rascunho — a decidir depois, mas registrando o raciocínio enquanto está fresco.

### O que a ferramenta NÃO deve ser
Um catálogo de efeitos com um agente que escolhe. Isso reproduz a média com passos extras: dez mil
sites com Aurora Background e cursor magnético.

### O que ela provavelmente precisa ter

1. **Extração de conceito antes de qualquer código.** A skill `meta-prompt` (CPE) já faz metade
   disso. O que falta é forçar um **conceito visual específico** — "cérebro em nuvem de pontos",
   não "moderno e minimalista". Um conceito ruim não é salvo por nenhum efeito.

2. **Restrições numéricas como entrada, não como validação depois.** O portfólio ficou bom porque
   tinha orçamento de luz medido e contraste medido. A ferramenta deveria *exigir* orçamentos —
   KB no caminho crítico, FPS alvo, razão de contraste — antes de gerar.

3. **Loop de rejeição embutido.** Suas rejeições (fogo → poliedro → nuvem de pontos) foram o que
   afastou o site da média. A ferramenta deveria gerar **variantes divergentes** e fazer você matar
   as ruins, em vez de entregar uma opção plausível.

4. **Um catálogo de *técnicas*, não de componentes.** "Depth prepass para dar volume a nuvem de
   pontos aditiva" é conhecimento transferível. "Um card com gradiente" não é. Codrops é o modelo:
   técnica + porquê + código.

5. **Nativo primeiro.** CSS scroll-driven e View Transitions antes de qualquer lib. Menos bundle,
   menos IA-cheiro (porque a IA importa GSAP por reflexo).

6. **Medição obrigatória no fim.** O que o `tester` já faz. Nada aprovado sem número.

### Formato: skill, MCP ou framework?

Avaliação preliminar:
- **Skill** — mais barato, integra ao Forge que já existe, iteração rápida. Melhor começo.
- **MCP** — faria sentido para *servir o catálogo de técnicas* como recurso consultável, e para
  ferramentas com estado (screenshot, medição de contraste, orçamento de bundle).
- **Framework** — só depois que as técnicas estiverem provadas em 3–4 projetos. Framework cedo
  demais congela decisões erradas.

**Caminho sugerido:** skill primeiro (`visual-concept` + `visual-techniques`), catálogo de técnicas
em markdown, e só promover a MCP o que precisar de estado ou medição.

---

## Fontes

Pesquisa de agosto/2026. Principais:
[Hon Tran — WebGL websites](https://www.hontran.dev/blog/webgl-website-examples) ·
[Utsubo — o que mudou no three.js em 2026](https://www.utsubo.com/blog/threejs-2026-what-changed) ·
[Utsubo — APIs de fronteira prontas para produção](https://www.utsubo.com/blog/frontier-web-apis-2026-production-ready) ·
[Creative Dev Jobs — 12 ferramentas essenciais](https://www.creativedevjobs.com/blog/best-tools-for-creative-developers) ·
[PkgPulse — react-bits vs Aceternity vs Magic UI](https://www.pkgpulse.com/guides/react-bits-vs-aceternity-magic-ui-2026) ·
[GSAP 3.13](https://gsap.com/blog/3-13/) ·
[Shuffle — por que sites de IA parecem iguais](https://shuffle.dev/blog/2026/01/why-do-most-ai-generated-websites-look-the-same/) ·
[925 Studios — guia de AI slop](https://www.925studios.co/blog/ai-slop-web-design-guide) ·
[byteiota — WebGPU 2026](https://byteiota.com/webgpu-2026-70-browser-support-15x-performance-gains/) ·
[curtains.js](https://www.curtainsjs.com/) ·
[Dimforge — Rapier 2025/2026](https://dimforge.com/blog/2026/01/09/the-year-2025-in-dimforge/) ·
[Three.js Resources — shaders](https://threejsresources.com/best/shaders)
