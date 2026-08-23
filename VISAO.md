# 🔨 Forja Visual — visão completa do projeto

Documento central. Explica **o que é, por que existe, o que já sabemos e como pretendemos
construir**. Se você só for ler um arquivo deste repositório, leia este.

Escrito em agosto/2026, na fase de coleta. Tudo aqui é revisável — mas o raciocínio fica
registrado para que uma mudança futura seja uma decisão, não um esquecimento.

---

# 1. O que é

Uma ferramenta para criar **sites que impressionam visualmente e não têm cara de IA**.

O formato ainda não está decidido — pode ser uma skill do Forge, um servidor MCP, um framework,
ou uma combinação. Essa decisão vem depois do material amadurecer; escolher cedo demais congela
o desenho errado.

O que **está** decidido é o critério de sucesso, e ele é do dono do projeto:

> Um site gerado pela ferramenta tem que passar por trabalho de um estúdio, não por template.

---

# 2. O problema — e por que ele não é o que parece

## 2.1 A hipótese ingênua está errada

A leitura óbvia seria: "sites de IA são feios porque faltam bibliotecas boas". **Falso.** As
bibliotecas estão todas aí, maduras, e em 2026 quase todas gratuitas — o GSAP inteiro, com os
plugins que antes custavam assinatura, virou grátis em abril de 2025.

O problema é outro, e é mecânico.

## 2.2 A causa real

Da pesquisa, com todas as letras:

> *"AI predicts the most likely design, and the most likely design is the average of everything it
> trained on. It's not copying any one site but averaging all of them, and the average is by
> definition the least distinctive option available."*
> — [Shuffle](https://shuffle.dev/blog/2026/01/why-do-most-ai-generated-websites-look-the-same/)

Um LLM gerando site segue o caminho de menor resistência, e esse caminho desemboca sempre no mesmo
lugar: hero centralizado, gradiente, grid de três colunas, Inter, um scroll reveal.

Isso não é falta de capacidade — é o comportamento **esperado** de um sistema que prevê o token
mais provável. A média é, por construção, a opção menos distintiva possível.

## 2.3 O corolário desconfortável

**As bibliotecas de componentes prontos são a principal fonte do problema, não a cura.**

React Bits, Aceternity UI, Magic UI: são excelentes, são gratuitas, e são exatamente o que um
agente alcança primeiro. Um Aurora Background é reconhecível à primeira vista porque está em dez
mil sites. Usá-las como estão é acelerar a corrida em direção à média.

Elas servem como **base para adaptar** — paleta, timing, comportamento — nunca como entrega.

## 2.4 Portanto

Uma ferramenta que seja "catálogo de efeitos + agente que escolhe" **reproduz o problema com
passos extras**. Esse é o desenho a evitar, e é o desenho para o qual tudo tende naturalmente.

---

# 3. A referência: por que o portfolio-3d escapou

O [`portfolio-3d`](../portfolio-3d) é a prova de conceito — o site mais distinto já feito aqui, e
o motivo deste projeto existir. Vale dissecar **por que** funcionou, porque é isso que a ferramenta
precisa reproduzir.

## 3.1 Os cinco fatores

**① Uma ideia específica, não um estilo.**
"Cérebro em nuvem de pontos cercado por uma constelação de agentes" é uma decisão de *conteúdo* —
diz algo sobre quem é o dono do site. "Site moderno com animações" é um prompt de média. A ideia
específica é o que nenhuma quantidade de efeito compensa depois.

**② Restrições numéricas medidas.**
Orçamento de luz somada (o script imprime `luz somada` por vista), contraste medido por pixel
(pior caso 9,59:1), FPS em GPU real (60,3 — e a descoberta de que 27,2 era falso porque o Chrome
headless caía em SwiftShader). Restrição dura força solução não-óbvia. Sem restrição, o gerador
produz o que é fácil.

**③ Um problema técnico real, resolvido de verdade.**
O depth prepass não sai de tutorial nenhum. Nasceu de um feedback específico — *"o cérebro está
irreconhecível"* — e da investigação da causa: sprites aditivos sem `depthWrite` não se ocluem, o
fundo somava através da frente, e o meio da silhueta virava a região mais clara do quadro. A
solução (uma malha invisível que só escreve profundidade) é original porque o problema era real.

**④ Asset próprio.**
Um `.obj` de 20 MB processado por um pipeline escrito para ele — normais por Newell, curvatura,
downsample por voxel, shuffle determinístico, quantização `Int16` normalizada. Não é um preset.

**⑤ Rejeição iterada.**
Fogo → poliedro facetado → nuvem de pontos. Cards → linhas. Cada rejeição do dono empurrou o
resultado para longe da média. **Este é provavelmente o fator mais importante e o mais difícil de
automatizar.**

## 3.2 O que isso ensina

Nenhum dos cinco é um efeito. Todos são **processo**. A ferramenta precisa ser um processo, não um
catálogo.

---

# 4. Princípios de desenho

Derivados do que está acima. São as regras que o desenho da ferramenta tem que respeitar.

### P1 — Conceito antes de código
Nada é gerado antes de existir um conceito visual específico e defensável. A skill `meta-prompt`
(CPE) já faz metade disso, mas extrai *requisitos*; falta extrair **imagem**. Um conceito ruim não
é salvo por efeito nenhum.

### P2 — Restrição como entrada, não validação no fim
Orçamentos numéricos — KB no caminho crítico, FPS alvo, razão de contraste, densidade — são
**entrada obrigatória**, declarados antes de gerar. Validar depois só reprova; restringir antes
força criatividade.

### P3 — Divergência forçada, com o dono matando as opções
Em vez de entregar uma opção plausível, gerar variantes **deliberadamente divergentes** e fazer o
dono rejeitar. É a mecanização do fator ⑤. Uma opção plausível é a média; três opções brigando
não são.

### P4 — Catálogo de técnicas, nunca de componentes
"Depth prepass para dar volume a nuvem de pontos aditiva" é conhecimento transferível: explica o
mecanismo e se aplica a problemas que ainda não apareceram. "Card com gradiente" não é. O modelo é
o Codrops: técnica + porquê + código.

### P5 — Nativo primeiro
CSS scroll-driven animations (90%+ de suporte) e View Transitions API antes de qualquer
biblioteca. Menos bundle, menos dependência — e um sinal real de não-IA, porque **uma IA importa
GSAP por reflexo**.

### P6 — Medição obrigatória no fim
O que o subagente `tester` já faz no Forge. Nada aprovado sem número. E o número tem que ser
honesto: a lição do FPS falso em SwiftShader é que medir errado é pior que não medir.

### P7 — Comentário como ativo
Toda constante mágica carrega a medição que a justifica. O portfólio provou o custo do contrário:
um comentário afirmando que as camadas eram "depth-less" sobreviveu a uma mudança que o tornou
falso, e uma decisão de densidade foi tomada em cima dele.

---

# 5. Arquitetura proposta

Rascunho. Cinco fases, na ordem em que o valor aparece.

```
┌─────────────────────────────────────────────────────────────┐
│  1. CONCEITO      extrai a ideia específica + os orçamentos │
│                   → saída: brief com conceito e restrições  │
├─────────────────────────────────────────────────────────────┤
│  2. DIVERGÊNCIA   gera N direções incompatíveis entre si    │
│                   → o dono mata as ruins (P3)               │
├─────────────────────────────────────────────────────────────┤
│  3. TÉCNICA       consulta o catálogo, escolhe o mecanismo  │
│                   → saída: quais técnicas, e por quê        │
├─────────────────────────────────────────────────────────────┤
│  4. CONSTRUÇÃO    subagentes dev em paralelo (Forge)        │
├─────────────────────────────────────────────────────────────┤
│  5. MEDIÇÃO       orçamentos verificados, não estimados     │
└─────────────────────────────────────────────────────────────┘
```

As fases 4 e 5 **já existem** no Forge (`orchestrator`, `dev`, `tester`). O que falta construir é
1, 2 e 3 — e a 3 depende do catálogo, que é o trabalho em andamento.

---

# 6. Formato: skill, MCP ou framework?

| Formato | A favor | Contra | Veredito |
|---|---|---|---|
| **Skill** | Barato, integra ao Forge que já existe, itera rápido, testável em projeto real amanhã | Sem estado, sem ferramenta própria | ✅ **Começar aqui** |
| **MCP** | Serve o catálogo como recurso consultável; ferramentas com estado (screenshot, medir contraste, medir bundle) | Mais infra, mais coisa para manter | 🔶 Só o que precisar de estado |
| **Framework** | Reuso máximo | Congela decisões antes de estarem provadas | ⛔ Só após 3–4 projetos |

**Caminho:** duas skills primeiro — algo como `visual-concept` (fases 1–2) e `visual-techniques`
(fase 3) — com o catálogo em markdown. Promover a MCP apenas o que exigir estado ou medição real.

---

# 7. O que já existe

```
forja-visual/
├── VISAO.md                    ← este documento
├── README.md                   — resumo e ponto de entrada
└── research/
    ├── arsenal-visual.md       — ferramentas (18 KB)
    └── catalogo-tecnicas.md    — técnicas (24 KB)
```

## 7.1 `arsenal-visual.md` — o que existe lá fora

Panorama de agosto/2026, com a coluna que mais importa: **quando NÃO usar**.

- **Renderização:** three.js (29 dos 47 Sites of the Day do Awwwards no Q1/2026), R3F, Babylon,
  OGL, curtains.js
- **WebGPU virou realidade:** 84,68% de suporte, `WebGPURenderer` zero-config desde a r171, ganho
  de 2–10×
- **TSL (Three Shading Language):** shader como grafo em JavaScript, compila para GLSL *e* WGSL —
  decisivo para uma ferramenta que precisa **gerar** shaders, porque string GLSL não compõe
- **Animação:** GSAP (grátis desde abr/2025, plugins inclusos), Lenis, Motion, Theatre.js
- **Nativo:** CSS scroll-driven (90%+), View Transitions API
- **Autoria:** Blender, Spline, Rive
- **Tooling:** Leva, r3f-perf, Stats.js

## 7.2 `catalogo-tecnicas.md` — o mecanismo por trás dos efeitos

16 técnicas no formato `Problema → Mecanismo → Custo → Quando NÃO usar`, em camadas:

- **Infraestrutura:** composite rendering (FBO), sync DOM↔WebGL (1px = 1 unidade), ticker único,
  ping-pong FBO
- **Mundos:** chunking infinito, fog animado por injeção de shader, contorno por inverted hull
- **Transições:** máscara de threshold, x-ray com fluido, cena WebGL persistente entre páginas
- **Imagem:** reacender foto 2D com depth map
- **Nossas:** as 5 provadas no portfólio

Mais 9 regras transversais e um backlog priorizado de ~20 artigos ainda não abertos.

---

# 8. Roadmap

**Agora — coleta**
- [x] Panorama de ferramentas
- [x] Catálogo v1 (16 técnicas com mecanismo)
- [ ] Backlog de varredura, prioridade alta
- [ ] Varrer fora do Codrops: Three.js Resources, awesome-threejs, Shadertoy, Unicorn Studio

**Depois — provar**
- [ ] Aplicar 2–3 técnicas do catálogo num protótipo real
- [ ] Destilar as 9 regras transversais num validador executável

**Depois — construir**
- [ ] Skill `visual-concept` (fases 1–2)
- [ ] Skill `visual-techniques` (fase 3)
- [ ] Testar num projeto de verdade, do zero
- [ ] Só então avaliar MCP

⚠️ **Ordem inegociável:** provar antes de generalizar. Framework construído sobre técnica não
provada congela o erro.

---

# 9. Decisões em aberto

1. **Como mecanizar a rejeição (P3)?** É o fator mais importante e o menos óbvio. Gerar N variantes
   custa N vezes mais. Quantas? Como garantir que divergem de verdade em vez de serem três
   sabores da média?
2. **Como extrair conceito visual?** O CPE extrai requisitos funcionais bem. Extrair *imagem* de
   alguém que não é designer é outro problema.
3. **O catálogo é lido por quem?** Um agente consultando markdown, ou um índice estruturado com
   busca? Muda se vira MCP.
4. **Escopo:** só sites com WebGL, ou também os que impressionam sem 3D nenhum (tipografia,
   layout, movimento)? A segunda opção é mais ampla e talvez mais honesta.

---

# 10. Riscos

| Risco | Mitigação |
|---|---|
| **Virar catálogo de efeitos** — o desenho para o qual tudo tende | P4 é regra dura: técnica, nunca componente |
| **Generalizar cedo** | Provar em 2–3 projetos antes de framework |
| **Catálogo envelhecer** | Datar tudo; TSL/WebGPU mudam rápido |
| **Automatizar a rejeição de menos** | Se P3 não funcionar, a ferramenta produz média com passos extras — é o risco existencial |
| **Confundir "impressionante" com "pesado"** | O portfólio já paga 675 KB só no cérebro. Orçamento é entrada (P2) |

---

# 11. Contexto de trabalho

- **Repositório próprio**, com git independente. `projects/` é ignorado pelo repo do Forge.
- **Identidade git:** conta pessoal (`MatheusRibeir098`), configurada localmente.
- **Sem remote ainda** — o commit vive só nesta máquina. Decidir público ou privado; há notas de
  estratégia de produto aqui.
- **Idioma:** documentação e conversa em PT-BR; código e identificadores em inglês.

---

*Última revisão: agosto/2026, fase de coleta. Ver [`README.md`](README.md) para o resumo curto e
[`research/`](research/) para o material.*
