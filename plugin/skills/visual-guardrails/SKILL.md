---
name: visual-guardrails
description: Proibicoes, regras verificaveis e armadilhas medidas para construir site de alto impacto visual. Carregue SEMPRE antes de escrever ou validar codigo visual — define o que reprova a entrega e por que, os portoes de medicao e as pegadinhas que ja custaram retrabalho.
---

# Visual Guardrails — o que reprova, e por quê

Esta skill existe por um motivo mecânico: um LLM gerando site segue o caminho de menor
resistência, e esse caminho desemboca na **média de tudo que ele viu** — hero centralizado,
gradiente, três colunas, Inter, um scroll reveal. A média é, por construção, a opção menos
distintiva possível.

> **O que tira da média é restrição e rejeição, não incentivo.**
> "Seja criativo", "capriche", "faça algo impressionante" produzem a média com adjetivos.

Por isso aqui não há adjetivo motivacional: só proibição com motivo, exigência com forma de
verificar, e armadilha com o número que ela custou.

**Toda proibição vem com motivo.** Proibição sem motivo é obedecida errado — o agente contorna a
letra e reproduz o problema com outro nome. Se você discorda de um item, **reporte em
`pendencias`**; não contorne por conta própria.

---

## 1. Lista de reprovação

Cada item: o que é proibido, **por quê**, e o que se faz no lugar.

### 1.1 `postprocessing`, `EffectComposer`, `drei` — e qualquer lib de efeito pronta

**Por quê, dois motivos independentes:**
- **Visual:** é a cara de biblioteca pronta. O bloom/vinheta/glitch default está em dez mil sites e
  lê como template à primeira vista.
- **Mecânico:** um `EffectComposer` **aloca render targets só de existir**. Gatear por flag interna
  (`if (!enabled) return`) não economiza nada — a memória e o setup já foram pagos no construtor.
  É a regra transversal 7 aplicada.

**No lugar:** pipeline de composição à mão. O protótipo 01 fez FBO de página compartilhado +
um passe de grade (curva fílmica → bloom em mip-chain de 4 taps → vinheta → grão 1:1 → dither por
*Interleaved Gradient Noise*, que aproxima blue-noise sem textura). Tudo em ~2 arquivos, sem
dependência nova, e com um desvio medido de brinde: **RGBA8 em vez de RGBA16F** — 16F custava
13,72 ms de mediana (teto ~13,5); RGBA8 caiu para 9,8–12,05 ms. Quem mata banding é o dither, não
a precisão do buffer, e a cadeia já terminava em `linearToSrgb`.

### 1.2 GSAP, Lenis, Motion, Theatre.js — qualquer lib de animação ou de scroll

**Por quê:** é regra de **produto**, não de custo (P5 — nativo primeiro). Os plugins do GSAP são
gratuitos desde abril de 2025; o problema nunca foi preço. O problema é que **uma IA importa GSAP
por reflexo** — a presença dele é assinatura de código gerado, e o timing default arrasta junto o
"feel" que todo site com GSAP tem.

**No lugar, medido:** um `damp()` assimétrico sobre progresso normalizado 0–1 entrega o mesmo
resultado. Critério do protótipo: **10% do gap em ≤ 0,35 s** — medido em 234–248 ms em GPU real,
com 0 trocas de sinal. Scroll: o nativo, com CSS scroll-driven animations e `ViewTimeline`
(90%+ de suporte) — o protótipo tem uma seção inteira com **17 animações e zero JS de animação**.

**Custo extra do Lenis, específico:** ele reescreve o significado de `scrollY` e quebra a sincronia
DOM↔WebGL de 1px = 1 unidade. E vira hipótese fantasma: no protótipo 01 um dev atribuiu um bug de
layout a "scroll inercial do Lenis" **num projeto que não usa Lenis** — a proibição também elimina
a explicação errada.

### 1.3 WebGPU e TSL, por ora

**Por quê:** migrar invalidaria os shaders GLSL escritos (1.800 linhas, no protótipo 01) por um
ganho que **não é o gargalo**. O p5 já estava em 59,88 fps e a medição de GPU mostrou que o tier
`low` — com **15× menos pixels** que o `high` — custava **mais**: o gargalo ali era overhead de
geometria/draw call, que WebGPU não resolve de graça.

**Quando reabrir:** só quando um projeto **medir** fill-rate como fator limitante. Decisão baseada
em número, não em novidade. (TSL segue interessante para *gerar* shader por grafo — é assunto de
uma versão futura da ferramenta, não desta.)

### 1.4 `antialias: true` no contexto, quando a imagem final vem de quad texturizado

**Por quê:** se a cena é renderizada num FBO e apresentada por um quad de tela cheia, o MSAA do
**backbuffer é descartado** — você paga a resolução multisample de um buffer que ninguém vê. É
banda de memória gasta em pixel invisível.

**No lugar:** AA vem do próprio sinal — supersample no FBO, `smoothstep` na borda do SDF, filtro no
shader. Se não há passe de composição e o three desenha direto na tela, `antialias: true` é
legítimo; a proibição é condicional ao pipeline, e é essa condição que você verifica.

### 1.5 Cursor custom, botão magnético, texto que "explode" no hover

**Por quê:** efeito-de-biblioteca-usado-como-está. São reconhecíveis à primeira vista porque estão
em dez mil sites — o oposto do objetivo. Custo somado: cursor custom quebra a affordance do
sistema (o visitante perde o cursor de texto, o de link, o de arrastar), e o alvo magnético
desalinha ponteiro e alvo real, o que é falha de acessibilidade, não estilo.

**No lugar:** interação que responde ao **conteúdo** — o raio do cursor iluminando um relevo, um
campo de partículas que reage à posição, uma cabeça de leitura que persegue o scroll. Custa o mesmo
e não é intercambiável entre sites.

### 1.6 Bibliotecas de componentes: React Bits, Aceternity UI, Magic UI e similares

**Por quê:** são excelentes, são gratuitas, e são **exatamente o que um agente alcança primeiro** —
ou seja, são a definição operacional da média. Um Aurora Background é identificável de relance
porque está em dez mil páginas. Usá-las como estão é acelerar a corrida em direção à média.

**Servem como base para adaptar** — paleta, timing, comportamento — **nunca como entrega**. Se você
copiou o componente e trocou as cores, a resposta é: não.

Consequência da stack fixa (spec §4): **sem framework**. Nada de React, Vue, Svelte, Next, e nada
de Tailwind. TypeScript puro + Vite + three, sempre projeto novo. Não é preguiça: sem framework o
site controla cada quadro, carrega menos e **não herda os padrões visuais que vêm de biblioteca
pronta** — que são justamente os que fazem tudo parecer igual.

### 1.7 Preloader antes da animação de entrada, quando o hero já **é** a entrada

**Por quê:** duplica o gesto. O visitante vê duas aberturas e a segunda chega gasta; a barra de
progresso ainda anuncia "isto vai demorar" antes de qualquer coisa acontecer. No protótipo 01 o
hero era a sequência de entrada, e o preloader foi reprovado por isso — não por bytes.

**No lugar:** o carregamento acontece **durante** o primeiro beat do hero. Se algum asset bloqueia
mesmo o primeiro quadro, a pergunta certa não é "que preloader eu ponho" e sim "por que ele
bloqueia" — quase sempre é import estático do que deveria ser tardio, ou asset sem quantização.

### 1.8 Técnica escolhida para "cobrir o catálogo"

**Por quê:** usar uma técnica porque ela está no catálogo e ainda não foi usada é o **P4 ao
contrário** — vira catálogo de efeitos, que é exatamente o desenho a evitar. Cada técnica entra
por um **problema visual nomeado** que ela resolve, e esse motivo fica registrado.

### 1.9 Canvas WebGL fora da convenção `id="gl"`

**Por quê:** os medidores do plugin (`measure-fps.ts`, `measure-variant.ts`) procuram o canvas por
`#gl,[data-forge-gl]` — a convenção primeiro, a instrumentação como rede (`DEFAULT_CANVAS_SELECTOR`
em `scripts/lib/chrome.ts`). Um canvas com `id="gl"` é achado **sem** `--canvas` em nenhuma
chamada; um que não siga a convenção só é achado se pedir contexto WebGL a tempo de a
instrumentação marcá-lo — e, se não pedir a tempo ou se houver mais de um canvas ambíguo, a
medição sai com o código `4` (nada mensurável), que é reprovação, não aviso.

**No lugar:** um canvas só, `<canvas id="gl">`, como `templates/site/index.html` já traz. Não crie
um segundo canvas em variante nenhuma — duas seções não dividem posse de canvas (ver `ENGINE.md`,
"A REGRA DO CANVAS").

**Verificação:** `document.querySelector('#gl') instanceof HTMLCanvasElement`.

### 1.10 Aumentar densidade só porque "cabe no orçamento"

**Por quê:** o teto que decide raramente é bytes. No protótipo, mais limalha no hero foi reprovada
com o teto de bytes **já suspenso**: 26k era o limite de **legibilidade** — acima disso o texto
deixava de se ler contra o campo. O critério é o que a imagem comunica, não o que o orçamento
permite.

---

## 2. As 9 regras transversais — fonte única, aplicadas aqui como portão

⚠️ **O enunciado, o predicado de verificação e o "reprova quando" de cada regra vivem em um
arquivo só**, e não é este:

```
${CLAUDE_PLUGIN_ROOT}/skills/visual-techniques/references/regras-transversais.md
```

Leia-o com `Read` — não é preciso carregar a skill `visual-techniques` inteira para isso. Se você
está prestes a reprovar (ou a defender) uma entrega por uma destas regras, **abra o arquivo**: o
que decide é o predicado de lá, com o número, não o resumo de uma linha daqui.

O que muda entre os dois leitores é o **uso**, não o texto:

| Skill | Usa a regra para | Campos que lê |
|---|---|---|
| `visual-techniques` (fase 3) | **escolher** técnica — a regra restringe o que ainda faz sentido | *Enunciado*, *Por quê* |
| `visual-guardrails` (esta, portão) | **reprovar** a entrega | *Verificação*, *Reprova quando* |

Índice, só para você saber qual abrir:

| # | Regra | Onde ela reprova |
|---|---|---|
| 1 | Progresso normalizado 0–1 como moeda comum | teste por seção |
| 2 | Um ticker, um estado | estático (`grep`) + runtime |
| 3 | Meça o layout uma vez por quadro, antes de escrever | runtime |
| 4 | Pré-processe o que não muda | determinismo do build (`sha256` 2×) |
| 5 | Textura em vez de procedural quando o olho não distingue | não automatizável — decisão medida |
| 6 | Escale por dispositivo com um número, nunca com um caminho de código | estático |
| 7 | Não monte o que está desligado | estático + runtime |
| 8 | `prefers-reduced-motion` desde a arquitetura | runtime |
| 9 | Toda constante mágica carrega o comentário com a medição | estático |

A regra 7 é o mecanismo por trás da proibição 1.1, e a 9 é o que impede que uma constante medida
seja cortada de novo pela mesma hipótese errada (§3.3).

---

## 3. Armadilhas medidas — cada uma custou retrabalho real

### 3.1 Atenue por **cor**, nunca por **alpha**

Custou **duas tarefas**. Baixar `alpha` faz a composição convergir para a cor do fundo (ou da
fonte, conforme o blend): o resultado tende ao cinza do que está atrás, e o contraste do texto por
cima despenca de um jeito que não aparece no código, só no medidor.

**Regra:** para escurecer/clarear algo atrás de texto, mude **a cor do que é desenhado**, com a
força controlada pelo progresso — não o alfa. Quando a paleta do protótipo passou a cor sólida, um
rótulo saiu de **6,86 → 8,88:1** sem mudar layout nenhum; outro link foi a 16,06:1.

**Consequência de projeto:** a "área escurecida atrás do texto" precisa ser escura **não importa
qual camada o blend escolha** — no protótipo, a máscara de threshold destravava por posição de tela
e podia deixar a camada brilhante sob o texto já revelado. Correção: mesma área segura nas duas
camadas + escurecimento por cor com força por `uProgress`.

### 3.2 Ray march acima de 8 passos: **6× o custo pela mesma imagem**

O número de passos se deriva do **tamanho do menor detalhe em pixels**, não de "mais é melhor".
A conta do protótipo: a sombra mais longa ≈ profundidade/tan(elevação) ≈ 0,04 unidade ≈ **29 px**;
a marcha varre 0,06, então 8 passos = 0,0075 ≈ **5 px** — a mesma ordem da penumbra (4,3 px).
Acima disso a marcha só reamostra platô: você paga 6× e a imagem é indistinguível.

Generalize: antes de subir contagem de amostras, calcule **quantos pixels** um passo cobre. Se o
passo já é menor que a menor feição visível, parou.

### 3.3 Medida nova exige **validação do ambiente** antes de virar critério

Dois devs gastaram ~20 min cada cortando um efeito para recuperar uma cauda de FPS que **não tinha
relação com o efeito**. O segundo refutou a própria hipótese do briefing ao medir a cauda igual
**com o efeito desligado**. Causa real, achada com `ps`: o **Spotify do dono a 48,6% de CPU** com
gpu-process próprio, mais um Chrome pessoal com ~30 processos, disputando a mesma Intel integrada.
A máquina de medição **nunca esteve isolada**.

**Regra:** *se um número não correlaciona com a variável que você mexe, o problema não é a
variável.* Antes de mudar código por causa de uma métrica nova:
1. meça **3 execuções consecutivas** — não uma run sortuda;
2. meça com a variável desligada — se o número não muda, a hipótese morreu;
3. cheque o ambiente (`ps`, disputa de GPU/CPU) **antes** de cortar qualquer efeito;
4. registre o diagnóstico no arquivo do efeito, senão o próximo dev corta de novo.

**Precedente pior, mesma família:** um FPS de 27,2 foi tratado como real quando era o Chrome
headless caindo em **SwiftShader** (renderização por software). Medir errado é pior que não medir.
GPU real exige `--use-gl=angle --use-angle=gl`, e o **renderer medido tem que ser registrado junto
com o número**. Nunca mate processos do dono para isolar a máquina — diagnostique e relate.

### 3.4 `display: grid` em `<th>` / `<td>` desmonta a tabela

O `display` computado deixa de ser `table-cell` e a célula **empilha como bloco solto** abaixo da
anterior, em vez de ocupar sua coluna. Some ao fato de que a página "quase funciona", e o defeito
passa por desalinhamento de CSS.

**Correção:** o grid vai num `<div>` **filho** da célula; a célula continua `table-cell` puro.
**Verificação:** `getComputedStyle(cell).display === 'table-cell'`.

### 3.5 Texto invisível engana o medidor de contraste

Um parágrafo com `clip-path` fechado e 0 glifos desenhados mediu **2,86:1** — o medidor lia ruído
de fundo e classificava como texto. O elemento passava nos checks de `opacity`/`visibility` porque
estava, formalmente, visível.

**Correção aplicada, sem mudança visual:** derivar a opacidade do mesmo progresso que revela —
`opacity: min(var(--hero-reveal, 0) * 1000, 1)`. O elemento passa a se **declarar** invisível
enquanto não há glifo.

**Regra:** todo elemento revelado por `clip-path`, `mask` ou `transform` precisa ter `opacity`
derivada do mesmo progresso. E, do outro lado: **contraste medido num instante não prova a faixa**
— varra frames ao longo de 0→1 (o protótipo amostrou a cada 25–100 ms) antes de declarar aprovado.

### 3.6 Duas armadilhas de CSS/WebGL que se manifestam fora do 1280

- **`padding-inline` + `max-inline-size` empilhados no mesmo elemento** encolheram a grade de 12
  colunas para 1151,8 px em vez de 1248 (**~7% mais estreita**), cortando a última coluna. Só
  aparece **acima de ~84rem** — passou despercebido em toda a sessão. Verifique a grade numa largura
  grande, não só em 1280.
- **`renderer.setViewport()`/`setScissor()` são ignorados** quando outro código troca de render
  target por baixo: o three reaplica o scissor do próprio `WebGLRenderTarget`. Quem troca de target
  precisa gravar em `target.scissor`.

### 3.7 Comando git destrutivo apaga o trabalho dos irmãos

`git stash` (que faz reset interno), `git reset`, `git checkout -- <arquivo>` e `git clean` operam
no **worktree inteiro**, não no seu arquivo. No protótipo 01 um dev usou `git stash` para contornar
um erro de build alheio e **apagou do disco o trabalho não commitado de outro dev**, que teve de
refazer. O hook de permissão bloqueia escrita por caminho — ele **não vê comando git**.

**Regra dura, sem exceção:** nenhum agente restaura arquivo por git; commit é só do orquestrador.
Erro de build fora da sua fronteira → `pendencias`, e siga.

---

## 4. Portões — o que reprova e o que apenas informa

| Portão | Critério | Natureza |
|---|---|---|
| Contraste | **≥ 7:1**, medido **por pixel** | **reprova** |
| FPS | mediana **≥ 60** em GPU real (renderer registrado) | **reprova** |
| Build · typecheck · lint · test | verde | **reprova** |
| Bytes | contra o `budget` derivado do brief | **informa** |

**Bytes informam, não reprovam** — e isto foi aprendido caro. Teto de bytes fixado *antes* das
respostas produziu relevo em meia resolução, nuvem de pontos com 1/4 dos pontos e composição
banida: um site que passava em todas as métricas e não impressionava. Pior, o portão de bytes
abortava a cadeia **antes** dos dois portões que continuam sendo critério. Regra: o orçamento é
**derivado do brief**, é medido, é relatado — e não barra a entrega.

Régua de UI para orçamento informativo: mostre o excedente com marca **textual e visualmente
distinta** da falha real (listra pontilhada × listra diagonal). Número informativo pintado de
vermelho vira critério na cabeça do próximo leitor.

---

## 5. Checklist antes de entregar

- [ ] Canvas WebGL é `#gl`, um só (`document.querySelector('#gl') instanceof HTMLCanvasElement`).
- [ ] Zero import de `postprocessing`, `EffectComposer`, `drei`, GSAP, Lenis, Motion.
- [ ] Zero componente copiado de biblioteca de componentes; zero framework; zero Tailwind.
- [ ] `grep -rn "requestAnimationFrame" src/` → 1 ocorrência.
- [ ] Nenhum `getBoundingClientRect()` dentro do loop de seção.
- [ ] Reduced-motion: quadro idêntico byte a byte, nenhum rAF extra.
- [ ] Escala por tier é **número**, não caminho de código.
- [ ] Toda constante não-óbvia tem comentário com valor, método e data da medição.
- [ ] Atenuação por cor, não por alpha; elemento revelado por clip-path tem `opacity` derivada.
- [ ] Contagem de amostras justificada em **pixels cobertos por passo**.
- [ ] Nenhum `git reset`/`checkout --`/`stash`/`clean`; nenhum commit.
