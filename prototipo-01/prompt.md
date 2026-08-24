# Forja Visual — Protótipo 01

> Spec auto-contida. Um agente deve conseguir construir o projeto lendo só este arquivo.
> Contexto de origem: `../VISAO.md` e `../research/catalogo-tecnicas.md` (não obrigatórios,
> mas o mecanismo de cada técnica está transcrito aqui na seção 4).

## 1. Visão Geral

Um site de uma página que **apresenta a Forja Visual** — a tese de que sites gerados por IA
parecem iguais porque a IA prevê a média, a referência (o `portfolio-3d`) que escapou dela, e o
catálogo de técnicas que explica *por quê* — e que, ao mesmo tempo, **prova a tese em si mesmo**:
ele precisa passar por trabalho de estúdio, não por template, e demonstrar **8 técnicas do
catálogo** dentro de orçamentos numéricos rígidos.

É a etapa "provar antes de generalizar" do roadmap: o que funcionar aqui vira base da ferramenta;
o que não funcionar é registrado como aprendizado. Público: o próprio dono do projeto e quem ele
mostrar (devs/designers que avaliam o resultado a olho).

**Critério de sucesso (do dono):** *"tem que passar por trabalho de um estúdio, não por template."*
Operacionalizado na seção 6 (orçamentos) e na seção 7 (lista do que é proibido porque é "cara de IA").

## 2. Stack Técnica

- **Frontend**: Vite 8 + TypeScript strict, **vanilla** (sem React) — o orçamento de 300 KB não
  paga React + R3F (~200 KB gzip só de runtime). DOM é estático; o dinâmico é WebGL e CSS nativo.
- **WebGL**: `three` (core, tree-shaken: `WebGLRenderer`, `Scene`, `OrthographicCamera`/
  `PerspectiveCamera`, `PlaneGeometry`, `Mesh`, `ShaderMaterial`/`RawShaderMaterial`,
  `WebGLRenderTarget`, `TextureLoader`). **Nada** de `drei`, `postprocessing`, `EffectComposer`,
  `OrbitControls`. Shaders em GLSL cru (strings em `.ts`). Se o bundle crítico passar de 300 KB
  por causa do three, trocar por **OGL** (mesmos primitivos, ~25 KB) — decisão do dev, registrada.
- **Animação/scroll**: **nativo**. CSS scroll-driven animations (`animation-timeline: view()` /
  `scroll()`) para o que é DOM; um `damp()` próprio de ~20 linhas para o que é WebGL. **Proibido**
  importar GSAP, Lenis, Motion, Framer, AOS, Locomotive. Isso é regra de produto (P5), não gosto.
- **CSS**: vanilla moderno, um arquivo por seção + `tokens.css`. `@layer`, custom properties,
  container queries, `clamp()` para tipografia fluida. **Sem Tailwind** — o site tem ~6 seções
  com layout próprio; utility-first aqui só adiciona bytes e empurra para o grid padrão.
- **Tipografia**: 2 fontes **self-hosted** em `woff2` com `unicode-range` latino, subset e
  `font-display: swap`. Escolha do dev, com a restrição: **nenhuma** de {Inter, Roboto, Poppins,
  Montserrat, Open Sans, Space Grotesk, DM Sans, Manrope, Plus Jakarta}. Uma display com
  personalidade + uma texto. Licença aberta (OFL). Peso total das fontes ≤ 80 KB.
- **Ferramentas**: pnpm, ESLint flat config + `typescript-eslint`, Prettier, `playwright-core`
  (usa o Chrome do sistema), `tsx` para scripts. Scripts de medição em `scripts/` (seção 6).
- **Sem backend, sem banco, sem env.** Conteúdo em `src/content/*.ts` (tipado).

## 3. Funcionalidades

### MVP (Fase 1)

Página única com 7 seções, em ordem. A **direção visual do hero (F1) é decidida por divergência**
— 3 variantes construídas, 1 escolhida pelo dono (seção 3.1). As demais seções seguem a variante
vencedora.

1. **F1 — Hero** — a primeira tela; carrega o conceito visual escolhido na divergência.
   - Given página carregada em 1280×720 / When nenhuma interação / Then o hero ocupa 100dvh, o
     título é legível (contraste ≥ 7:1 medido em pixel) e **não existe** botão "Get started",
     gradiente roxo→azul, nem badge "✨ Novo".
   - Given `prefers-reduced-motion: reduce` / When página carrega / Then não há animação contínua;
     o hero é um quadro estático equivalente.

2. **F2 — A Tese** ("por que sites de IA parecem iguais") — a seção é dividida em dois estados de
   WebGL: **"a média"** (uma cena que reproduz deliberadamente o hero genérico: gradiente,
   3 cards, Inter — renderizada em FBO) e **"o específico"** (a cena da variante vencedora). Uma
   **máscara de threshold** (III.1) faz a transição, dirigida pelo **scroll** via beat (V.2).
   Texto da tese ao lado, com a citação da Shuffle.
   - Given usuário rola a seção / When o beat vai de 0→1 / Then a transição vai de 0→1 sem
     crossfade uniforme (threshold por pixel: em `progress=0.5` existem pixels 100% A e 100% B,
     nunca 50/50) e é **reversível** ao rolar de volta.
   - Given resize de 1280→375 / When seção visível / Then a máscara cobre a tela inteira sem
     esticar (aspect corrigido no shader).

3. **F3 — A Referência** (portfolio-3d: os 5 fatores) — 5 blocos de texto; a coreografia de
   entrada/saída de cada um é ancorada no **próprio elemento DOM** (V.2, `ResizeObserver` +
   `rAF` coalescido), e o indicador visual (um cursor/agulha WebGL ou CSS que percorre os 5)
   segue com **damping assimétrico** (V.3).
   - Given um bloco a mais inserido acima de F3 (teste: `document.body.prepend` de um `div` de
     800px) / When rolar / Then todos os beats continuam alinhados aos elementos (nenhum offset
     hardcoded).
   - Given salto de scroll de 2 telas / When o indicador persegue / Then chega a 10% do gap em ≤ 0,35 s (medido: 250 ms) e
     assenta sem overshoot visível (teste: log de `gap` por frame, nunca troca de sinal 2×).

4. **F4 — Relevo** — a técnica IV.1: uma imagem 2D com **depth map** é reacesa em tempo real
   (normais derivadas do depth + sombra por ray march), a luz segue o cursor tratado como **raio**
   (V.4), não como ponto. Asset próprio (seção 5): relevo tipográfico "FORJA" cravado em metal.
   - Given cursor move sobre a seção / When luz passa por um sulco / Then a face voltada para a
     luz clareia e a oposta escurece (normais do depth), e sulcos projetam sombra na direção
     oposta à luz (ray march ≥ 8 amostras no tier `high`, 4 no `mid`, 0 no `low` = só normais).
   - Given cursor no canto da tela / When a superfície está a qualquer profundidade / Then a
     influência da luz é a mesma em toda a extensão (cilindro em torno do raio, não esfera).
   - Given touch (sem cursor) / When seção visível / Then a luz percorre uma órbita lenta
     automática; nunca fica parada num quadro sem iluminação.

5. **F5 — O Catálogo** — lista das 16 técnicas (título, camada, ⭐, uma linha do problema). Os
   **títulos são HTML** e um plano WebGL **sincronizado 1px = 1 unidade** (I.2) vive atrás de
   cada um, aplicando um shader (distorção/ruído sutil) que responde a hover e scroll. O DOM
   continua dono do layout, foco e seleção de texto.
   - Given `getBoundingClientRect()` chamado / When um frame roda / Then é chamado **uma vez por
     frame para todos** os elementos, antes de qualquer escrita (assert via `PerformanceObserver`
     de layout-shift = 0 e ausência de reflow forçado no Performance trace).
   - Given scroll / When qualquer velocidade / Then plano e texto não descolam (diferença ≤ 1px
     em screenshot comparando `rect` do DOM com a projeção do mesh).
   - Given resize / Then FOV recalculado, `updateProjectionMatrix()` e renderer redimensionado.

6. **F6 — Princípios & Roadmap** — os 7 princípios (P1–P7) e o roadmap. **Zero WebGL**. Tudo o
   que se move é **CSS scroll-driven animation** e `@starting-style`. É a prova do P5 ("nativo
   primeiro"): a seção deve ser tão boa quanto as outras sem um byte de JS de animação.
   - Given JS desabilitado / When página carrega / Then F6 é legível e as animações de scroll
     funcionam (só CSS).
   - Given `animation-timeline` sem suporte / Then conteúdo aparece estático (progressive
     enhancement via `@supports`).

7. **F7 — Medição** — o rodapé mostra **os números reais deste site**, lidos no build e em
   runtime: KB do caminho crítico (gzip, do `dist/`), FPS mediano atual (do ticker), contraste
   mínimo medido (do último `pnpm measure`), tier de qualidade ativo, e o nome do renderer GL
   (`WEBGL_debug_renderer_info`) — porque o portfólio aprendeu que medir em SwiftShader mente.
   - Given `pnpm build` / When `scripts/measure-bundle.ts` roda / Then gera `src/generated/
     measurements.json` que F7 importa; o valor exibido bate com `dist/` (nunca hardcoded).

Transversais (aplicam-se a todas):
- **Um ticker só** (I.3): um único `requestAnimationFrame` no projeto; tudo se inscreve nele.
  `grep -c requestAnimationFrame src/` deve dar **1** (fora do próprio ticker).
- **Progresso 0–1 como moeda**: scroll, hover, tempo → tudo normalizado antes de chegar num shader.
- **Tiers por número, não por caminho de código** (regra VI.6): `low/mid/high` alteram `dpr`,
  amostras de ray march, resolução do FBO. Nunca uma cena alternativa.
- **`prefers-reduced-motion` na arquitetura** (VI.8): muda o frameloop (`demand` em vez de
  `always`), não é um `if` no fim.
- **Toda constante mágica tem comentário com a medição** (VI.9 / P7): `// 0.35s medido em
  measure-fps.ts, run 2026-08-xx` — sem isso o lint de revisão do tester reprova.
- **Mobile 375×667 funcional**: WebGL roda em tier `low` (dpr 1), nada quebra, nada corta.
- **A11y**: WCAG 2.2 AA mínimo, foco visível, `aria-hidden` nos canvases, texto real (não em
  canvas) para tudo que é conteúdo.

### 3.1 Divergência (P3) — como o hero é decidido

Antes de construir F2–F7, **3 devs em paralelo** constroem 3 heros **deliberadamente
incompatíveis** sobre o mesmo motor (Lote 1). Cada um é uma tela só, sem seções abaixo. O
`tester` tira **1 print desktop por variante** (3 no total) e o dono mata duas. Os três eixos
foram escolhidos para serem incompatíveis em narrativa, material e luminosidade — não três
sabores da mesma coisa:

| | A — "A Média" | B — "Bigorna" | C — "Revista Técnica" |
|---|---|---|---|
| **Ideia** | O hero **começa** parecendo o site de IA genérico (gradiente, Inter, 3 cards, "Get started") e, em 1,5 s, a máscara de threshold **destrói** isso revelando o site real por baixo. A tese como ato de abertura. | Tipografia oversized "FORJA" cravada em metal escuro, relevo por depth map em tela cheia, a luz do cursor é a brasa. Scroll = martelada (beat com damping). Quase sem cor: uma laranja de forja. | Layout editorial claro, colunas assimétricas, serifada grande, numeração de seções, notas de margem. O WebGL age sobre o texto (DOM sync), como se a página fosse impressa e o shader fosse a tinta reagindo. |
| **Luminosidade** | escuro → escuro | escuro | **claro** (contra o reflexo dark-first) |
| **Técnica que carrega** | I.1 + III.1 | IV.1 + V.4 | I.2 + V.2 |
| **Risco** | virar piada de uma vez só | virar "site de heavy metal" | virar Medium |

Regras da divergência: variantes em `src/variants/{a,b,c}/` com **arquivos disjuntos**; cada uma
exporta `mountHero(root: HTMLElement, engine: Engine)`. A vencedora é promovida para
`src/sections/hero/`; as perdedoras **ficam no repositório** em `src/variants/` (são registro de
rejeição — fator ⑤ da referência) mas fora do bundle (não importadas).

### Fase 2 (pós-MVP, fora deste protótipo)

- Trocar o relevo tipográfico por foto real + depth map gerado por Depth Anything.
- Cena WebGL persistente entre páginas (III.3) se o site ganhar uma segunda página.
- Extrair do que foi construído a skill `visual-techniques` (fase 3 do VISAO).

## 4. Arquitetura

```
prototipo-01/
├── index.html                 # semântico: <main> com 7 <section>; canvases fixos atrás
├── public/
│   ├── fonts/                 # 2 woff2 subset
│   └── relief/
│       ├── forja-albedo.webp  # ≤ 200 KB, 1600×900
│       └── forja-depth.png    # 16-bit ou float packed em RGBA; ≤ 300 KB
├── scripts/
│   ├── build-relief.ts        # gera albedo + depth do relevo tipográfico (seção 5)
│   ├── measure-bundle.ts      # gzip do caminho crítico → src/generated/measurements.json
│   ├── measure-contrast.ts    # playwright: screenshot + contraste por pixel das regiões de texto
│   └── measure-fps.ts         # playwright em GPU real; FALHA se renderer contém "SwiftShader"
├── src/
│   ├── main.ts                # boot: engine → sections em ordem
│   ├── engine/
│   │   ├── ticker.ts          # o único rAF; subscribe(fn), unsubscribe; modo always|demand
│   │   ├── composite.ts       # I.1: render targets A/B + quad de tela + shader de composição
│   │   ├── domSync.ts         # I.2: câmera 1px=1un, rect batch por frame, coverUv
│   │   ├── beats.ts           # V.2: registerBeat(el) → progresso 0–1; ResizeObserver
│   │   ├── damp.ts            # V.3: damp assimétrico; independente de frame rate
│   │   ├── pointer.ts         # V.4: raio do cursor em view space (dividido pela profundidade)
│   │   ├── tier.ts            # low|mid|high por GPU/dpr/reduced-motion; só números
│   │   └── gl.ts              # renderer único, resize, contexto, renderer name
│   ├── shaders/               # .ts exportando strings GLSL; um por técnica
│   │   ├── thresholdMask.ts
│   │   ├── relight.ts
│   │   └── domPlane.ts
│   ├── sections/
│   │   ├── hero/ tese/ referencia/ relevo/ catalogo/ principios/ medicao/
│   │   └── (cada uma: index.ts + style.css; recebe { root, engine })
│   ├── variants/{a,b,c}/      # divergência — só a vencedora é importada
│   ├── content/               # tese.ts, fatores.ts, tecnicas.ts (as 16), principios.ts
│   ├── generated/measurements.json
│   └── styles/{tokens,base,typography}.css
└── e2e/                       # specs Playwright do tester (uma por seção)
```

- **Padrão**: SPA estática, sem router. Um `Engine` (renderer + ticker + tier + pointer + beats)
  criado uma vez em `main.ts` e injetado nas seções. Seções não se importam entre si.
- **Composição**: `composite.ts` mantém 2 render targets; seções que precisam de cena própria
  (F2 "média"/"específico") renderizam nos targets; o quad final compõe com `thresholdMask`.
  F4 e F5 renderizam direto (cena única → I.1 diz "não usar" quando não há transição).
- **Modelo de dados**: `Technique { id, layer, stars, title, problem }`, `Factor { n, title,
  why }`, `Principle { id, title, body }`, `Measurements { criticalKb, fonts, minContrast,
  fpsMedian, renderer, measuredAt }`.

## 5. Design & UX

- **Conceito**: decidido pela divergência (3.1). Este documento **não** fixa paleta nem fonte
  além das restrições — fixar aqui seria a média por antecipação.
- **Asset próprio** (`scripts/build-relief.ts`): renderiza offline, com `canvas` do Node ou
  Playwright, a palavra **FORJA** na fonte display do projeto como **heightfield** — letra
  rebaixada 1 mm com bisel + grão de metal por ruído seamless (regra VI.5: textura, não
  procedural em runtime). Saída: albedo (metal escuro com desgaste) + depth (float, **borrado**
  para matar quantização de 8 bits — refinamento citado na IV.1). Não é preset de biblioteca.
- **Layout**: 7 seções empilhadas; 100dvh só no hero e no relevo; o resto tem altura do
  conteúdo. Mobile-first no CSS; a experiência premium é desktop, mas mobile nunca quebra.
- **Tipografia**: escala fluida por `clamp()`; display oversized ≥ 12vw no hero.
- **Movimento**: tudo é resposta a scroll ou cursor. **Nenhuma animação em loop** que não tenha
  função (a órbita da luz no touch é a única exceção, e para com `reduced-motion`).

## 6. Constraints & Orçamentos

**Orçamentos (P2 — entrada, não validação):**

| Métrica | Teto | Como medir |
|---|---|---|
| Caminho crítico (HTML+CSS+JS carregados antes do first paint) | **≤ 300 KB gzip** | `measure-bundle.ts` sobre `dist/` |
| Fontes | ≤ 80 KB | idem |
| Assets lazy (relevo, texturas) | ≤ 600 KB | idem |
| FPS | **mediana ≥ 60** em GPU real, 5 s de scroll automático em 1280×720 tier `high`; ≥ 30 em tier `low` dpr 1 | `measure-fps.ts` — aborta se `renderer` contém `SwiftShader`/`llvmpipe` |
| Contraste | **≥ 7:1** em todo texto de conteúdo, medido **por pixel** no screenshot (não por token de cor) | `measure-contrast.ts` |
| CLS | 0 | PerformanceObserver no E2E |
| `requestAnimationFrame` | 1 chamada no código-fonte | `grep` no E2E |

**O que NÃO fazer (é "cara de IA" — lista de reprovação do tester):**
- Hero centralizado com título + subtítulo + 2 botões (primário/outline) + badge de novidade.
- Gradiente roxo→azul, roxo→rosa, ou "aurora" de fundo. Glassmorphism em card.
- Grid de 3 colunas de features com ícone em círculo.
- Inter/Roboto/Poppins/Montserrat/Space Grotesk/DM Sans/Manrope/Plus Jakarta.
- Fade-up genérico igual em todos os elementos ao entrar na tela.
- Importar GSAP/Lenis/Motion/Framer/drei/postprocessing/Tailwind.
- Texto de conteúdo dentro de `<canvas>`.
- Efeito de biblioteca pronta usado como está (Aurora, Spotlight, Meteors, Sparkles…).
- Número mágico sem comentário de medição.

**Segurança / processo:**
- Sem env, sem secrets, sem chamada de rede em runtime (fontes e assets são locais).
- Não commitar `dist/`, `node_modules/`, prints do tester, nem `measurements.json`? — **commitar
  sim** o `measurements.json` (é conteúdo do site e registro histórico).

## 7. Assumptions

- [ASSUMPTION] **Vanilla TS, sem React** — orçamento de 300 KB. Se o dono preferir React, o teto
  precisa ir para ~500 KB.
- [ASSUMPTION] **three.js core tree-shaken** em vez de OGL — o dev conhece melhor; OGL é o plano B
  registrado se o bundle estourar.
- [ASSUMPTION] **Sem Tailwind, CSS vanilla** — 6 seções com layout próprio; menos bytes.
- [ASSUMPTION] **Asset do relevo é o relevo tipográfico "FORJA"**, gerado por script — não há
  foto nem depth map fornecidos. Trocar por foto real fica para Fase 2 (o shader é o mesmo).
- [ASSUMPTION] **As 3 variantes de divergência são A/B/C acima** — o dono pode trocar qualquer
  eixo antes do Lote 2.
- [ASSUMPTION] **Idioma do site: PT-BR**, mesmo idioma do VISAO.
- [ASSUMPTION] **Localização**: `projects/forja-visual/prototipo-01/`, dentro do git já existente
  de `forja-visual` (identidade `MatheusRibeir098`). Sem `git init` novo, sem remote.
- [ASSUMPTION] **Chrome do sistema** é usado pelo Playwright (como no portfolio-3d) — sem
  download de browser.
- [ASSUMPTION] "Caminho crítico" = tudo que o browser baixa antes do first contentful paint,
  gzip. Assets com `loading=lazy`/fetch sob demanda ficam fora, com teto próprio.

## 8. Tarefas de Implementação

> Base do `.forge/tasks.md`. Arquivos disjuntos dentro de cada lote.

**Lote 0 — setup (1 dev)**
1. [Setup] Scaffold Vite 8 + TS strict + ESLint/Prettier + `playwright-core` + `tsx`; `index.html`
   semântico com 7 `<section>` vazias; `styles/tokens.css` + `base.css`; `.gitignore`;
   `package.json` com scripts `dev/build/preview/measure/e2e`; fontes escolhidas e subsetadas.
   Aceite: `pnpm build` verde, `pnpm preview` serve, bundle inicial ≤ 30 KB.

**Lote 1 — motor + conteúdo + medição (4 devs em paralelo, arquivos disjuntos)**
2. [Engine-GL] `engine/{gl,ticker,tier,composite}.ts` + `shaders/thresholdMask.ts`. Aceite:
   demo interna em `/dev/composite.html` transiciona 2 cenas de cor sólida com máscara; 1 rAF.
3. [Engine-Scroll] `engine/{beats,damp,pointer}.ts` (puro TS, sem WebGL). Aceite: testes
   unitários com Vitest: beat realinha após inserir elemento acima; damp chega em ≤ 0,35 s
   sem trocar de sinal 2×; raio do cursor independe de z.
4. [Conteúdo] `content/*.ts` tipados a partir do VISAO e do catálogo (16 técnicas, 5 fatores,
   7 princípios, tese com citação) + `styles/typography.css`. Aceite: `tsc` verde; nenhum texto
   hardcoded fora de `content/`.
5. [Medição] `scripts/measure-{bundle,contrast,fps}.ts` + `scripts/build-relief.ts` + assets em
   `public/relief/`. Aceite: `pnpm measure` gera `measurements.json`; `measure-fps` **falha**
   deliberadamente quando forçado `--use-gl=swiftshader`; relevo gerado ≤ 500 KB somados.

**Lote 2 — divergência (3 devs em paralelo)**
6. [Variante A] `variants/a/` — "A Média" (I.1 + III.1).
7. [Variante B] `variants/b/` — "Bigorna" (IV.1 + V.4).
8. [Variante C] `variants/c/` — "Revista Técnica" (I.2 + V.2).
   Aceite comum: `mountHero(root, engine)`; 100dvh; contraste ≥ 7:1; ≥ 60 FPS; reduced-motion
   estático. Tester: **1 print desktop cada**, sem `fullPage`. → **Dono escolhe.**

**Lote 3 — seções (4 devs em paralelo, após escolha)**
9. [Hero+Tese] promover vencedora para `sections/hero/`; `sections/tese/` (F2) com a cena
   "média" em FBO e a máscara dirigida por beat.
10. [Referência+Princípios] `sections/referencia/` (F3, beats + damping) e `sections/principios/`
    (F6, só CSS scroll-driven).
11. [Relevo] `sections/relevo/` (F4) + `shaders/relight.ts`: normais do depth, ray march por
    tier, cursor-raio, órbita no touch.
12. [Catálogo] `sections/catalogo/` (F5) + `engine/domSync.ts` + `shaders/domPlane.ts`.

**Lote 4 — amarração (2 devs)**
13. [Medição-UI] `sections/medicao/` (F7) lendo `measurements.json` + FPS/renderer em runtime;
    `main.ts` montando tudo em ordem; tiers aplicados; `reduced-motion` → `demand`.
14. [Responsivo+A11y] mobile 375×667 em todas as seções; foco; `aria-hidden` nos canvases;
    `@supports` para scroll-driven; `@starting-style`.

**Lote 5 — validação final**
15. [Tester] `pnpm build && pnpm measure && pnpm e2e`: todos os orçamentos da seção 6 dentro do
    teto, lista de reprovação da seção 7 vazia, máx. 3 prints (desktop hero, desktop relevo,
    mobile catálogo). Registrar os números em `progress.md` e em `../VISAO.md` § 8 (roadmap).
