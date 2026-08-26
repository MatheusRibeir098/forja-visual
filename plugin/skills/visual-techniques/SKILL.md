---
name: visual-techniques
description: Use na fase 3 do /forge-visual, ou sempre que precisar decidir COMO entregar um efeito visual — índice de 16 técnicas WebGL/DOM indexadas por problema, com o mecanismo por dentro, o custo em bytes e em GPU, quando NÃO usar, e o número medido quando a técnica já foi provada no protótipo 01.
---

# Catálogo de técnicas — do problema ao mecanismo

Esta skill não te diz o que construir. Ela te diz **por qual mecanismo** a direção visual já
escolhida é entregue, e **por quê** — para que a escolha caiba no brief como decisão defensável,
não como gosto.

## Regra dura: técnica, nunca componente (P4)

Entra aqui: *"depth prepass para dar volume a nuvem de pontos aditiva"* — explica o mecanismo e
serve a problemas que ainda não apareceram.
Não entra: *"card com glassmorphism"*, *"hero com gradiente animado"*, *"navbar sticky com blur"*.

Teste de uma linha: **se a frase pode ser copiada para outro site sem que ninguém entenda por que
funciona, é componente — descarte.** Se ela obriga a entender o que o shader faz, o que o buffer
guarda ou por que a conta é aquela, é técnica.

Consequência prática: ao registrar a escolha no brief, escreva o *mecanismo* e o *número*, nunca o
resultado montado. "III.1 com máscara de espiral, `uCurve` 5, porque a transição precisa varrer e
não desbotar" — não "transição bonita entre as seções".

## Como consultar

1. Comece pelo **problema em uma frase**, do jeito que ele aparece na direção visual.
2. Ache a linha na tabela abaixo. Ela devolve a técnica e o arquivo de referência.
3. Abra a referência e leia a ficha inteira — em especial **Quando NÃO usar**. Metade das técnicas
   custa um passe extra que só se paga sob condição.
4. Registre no brief: técnica, mecanismo em uma frase, custo esperado, e o que a reprovaria.

Formato de toda ficha: **Problema -> Mecanismo -> Custo -> Quando NÃO usar -> Provado (número)**.

## Índice por problema

| O problema, como ele aparece | Técnica | Referência |
|---|---|---|
| A transição entre duas seções não pode ser um crossfade genérico | III.1 máscara de threshold (sobre I.1) | `revelacao-e-transicao.md` |
| Quero trocar a personalidade da transição sem reescrever shader | III.1 (troca-se a textura, não o código) | `revelacao-e-transicao.md` |
| Preciso misturar duas cenas independentes com controle de profundidade | I.1 composite rendering | `infraestrutura.md` |
| Quero pós-processamento sem importar `EffectComposer`/`postprocessing` | I.1 + passe de grade à mão | `infraestrutura.md` |
| Cada seção precisa desenhar numa faixa da tela sem atropelar a vizinha | I.1 (scissor por alvo — ver armadilha) | `infraestrutura.md` |
| Há banding na borda da transição ou no gradiente de fundo | I.1 (dither no passe final) + III.1 (resolução da máscara) | `infraestrutura.md` |
| Quero revelar o interior de um objeto seguindo o cursor, sem círculo duro | III.2 x-ray com fluido (I.1 + I.4) | `revelacao-e-transicao.md` |
| O efeito precisa lembrar do quadro anterior (rastro, fluido, difusão, calor) | I.4 ping-pong FBO | `infraestrutura.md` |
| Shader sobre conteúdo que vive no HTML, mantendo layout e scroll | I.2 sincronizar DOM<->WebGL | `infraestrutura.md` |
| Os planos 3D ficam parados enquanto a página rola | I.2 (armadilha: subtrair o scroll) | `infraestrutura.md` |
| A imagem distorce dentro do mesh | I.2 (`coverUv` no shader) | `infraestrutura.md` |
| Judder que ninguém debuga; cada camada isolada está correta | I.3 um ticker só | `infraestrutura.md` |
| Hover e scroll brigam pelo mesmo estado, sem vencedor | I.3 (fontes concorrentes por `Math.max`) + regra 1 | `infraestrutura.md` |
| A coreografia por scroll quebra quando o conteúdo muda de tamanho | V.2 beats ancorados no DOM | `materia-e-movimento.md` |
| O movimento demora a alcançar, ou estala ao assentar | V.3 damping assimétrico | `materia-e-movimento.md` |
| O cursor "só funciona em algumas partes" do objeto | V.4 cursor como raio | `materia-e-movimento.md` |
| Nuvem de pontos aditiva vira borrão claro no meio da silhueta | V.1 depth prepass | `materia-e-movimento.md` |
| A nuvem satura/mancha no celular e está certa no desktop | V.1 (sprite proporcional ao raio) | `materia-e-movimento.md` |
| O buffer de geometria virou o download da página | V.5 Int16 normalizado | `materia-e-movimento.md` |
| Preciso escalar densidade por dispositivo sem manter duas cenas | V.5 (shuffle no build + `setDrawRange`) + regra 6 | `materia-e-movimento.md` |
| Uma foto comum precisa reagir à luz e ao cursor como se tivesse relevo | IV.1 relight por depth map | `imagem-e-superficie.md` |
| Quero sombra projetada sem geometria nenhuma | IV.1 (ray march no depth map) | `imagem-e-superficie.md` |
| A superfície reage à luz mas parece granulada | IV.1 (depth de 8 bits: converter para float e borrar) | `imagem-e-superficie.md` |
| Um mundo/corredor que não acaba, sem caber na memória | II.1 chunking | `mundo-e-atmosfera.md` |
| Não há modelo 3D e não vai haver | II.1 (planos com textura autoral) ou IV.1 | `mundo-e-atmosfera.md` |
| A cena tem profundidade mas não tem atmosfera; o fog nativo é morto | II.2 fog por injeção de shader | `mundo-e-atmosfera.md` |
| Contorno de desenho na malha, sem passe de post | II.3 inverted hull | `mundo-e-atmosfera.md` |
| Navegar entre páginas pisca: recarrega modelo e recompila shader | III.3 cena WebGL persistente | `revelacao-e-transicao.md` |

## As 16, em uma linha cada

Custo em ordem de grandeza. "Provado" = rodou e foi medido no protótipo 01
([código](https://github.com/MatheusRibeir098/forja-visual-site), [no
ar](https://forja-visual.vercel.app)).

| # | Técnica | Custo dominante | Provado |
|---|---|---|---|
| I.1 | Composite rendering (render target + quad) | 1 passe de tela cheia + memória de textura | sim — RGBA8 no FBO: 9,8–12,05 ms contra 13,72 ms em RGBA16F |
| I.2 | DOM<->WebGL, 1px = 1 unidade | 1 leitura de layout por quadro | sim — desvio 2,3e-13 px em 140 amostras/40 quadros |
| I.3 | Um ticker só | zero; é arquitetura | sim — 1 `rAF` no site inteiro, incluindo demand mode |
| I.4 | Ping-pong FBO | 2 texturas permanentes + 1 passe/quadro | não — teoria |
| II.1 | Chunking (3 segmentos / grade 3x3) | memória constante, custo de costura | não — recusado no protótipo por P4 |
| II.2 | Fog animado por injeção de shader | 1 amostra de textura por material | não — teoria |
| II.3 | Contorno por inverted hull | dobra os triângulos do objeto; zero por quadro | não — recusado no protótipo por P4 |
| III.1 | Máscara de threshold | 1 amostra + `step` por fragment | sim — 43,6% de pixels puros no pior aspecto |
| III.2 | X-ray reveal com fluido | 2 FBOs por quadro + 2 cenas | não — teoria |
| III.3 | Cena WebGL persistente entre páginas | zero por quadro; custo é de arquitetura | não — site de página única |
| IV.1 | Relight de foto por depth map | fetch por passo de ray march, por pixel | sim — 8 passos; 48 custavam 6x pela mesma imagem |
| V.1 | Depth prepass para nuvem aditiva | 1 draw call, zero fill | sim — 53,7% dos pontos descartados |
| V.2 | Beats ancorados no DOM | 1 `ResizeObserver` + leitura coalescida | sim — beat imune a `prepend` de 800 px |
| V.3 | Damping assimétrico | aritmética; nada | sim — 10% do gap em 234–248 ms (teto 350) |
| V.4 | Cursor como raio | 1 `vec2` de uniform | sim — 59,6/31,8 -> 24,6/33,1 ao inverter a luz |
| V.5 | Int16 normalizado (payload sem decode) | zero em runtime; a GPU divide no fetch | sim — 45k pontos em 673 KB, sem passe de decode |

Dez das dezesseis têm número medido. As seis restantes (I.4, II.1, II.2, II.3, III.2, III.3) têm
mecanismo extraído do artigo de origem, não medição própria — ao escolher uma delas, **trate o
custo como estimativa e meça antes de fechar a fase 5**.

## Combinações que se pagam

O catálogo não é uma lista plana; metade das técnicas é composta de outras.

- **I.1 é pré-requisito** de III.1, III.2 e de qualquer grade/bloom/dither próprio. Se a direção
  pede transição, x-ray ou atmosfera de imagem, I.1 entra primeiro e o orçamento de um passe de
  tela cheia é gasto uma vez só, para todos.
- **III.2 = I.1 + I.4.** Duas cenas em dois alvos, mais uma simulação com memória gerando a máscara.
  Se você já tem I.1, o incremento é I.4.
- **V.1 + V.5** andam juntas: o prepass devolve orçamento de luz, a quantização devolve orçamento de
  bytes; juntas foi possível ir de 12k para 45k pontos sem estourar nenhum dos dois.
- **V.2 + V.3** formam a base de qualquer movimento dirigido por scroll: o beat diz *onde*, o damp
  diz *como chega*. Sem V.3 o beat cru estala; sem V.2 o damp suaviza um alvo errado.
- **V.4 é modificador**, não cena: aplica-se a qualquer material que já receba `mvPosition`.
- **I.3 não é opcional** quando duas ou mais das outras coexistem. É a única cujo custo de ignorar
  aparece só no fim, como judder sem dono.

## Quatro perguntas antes de escolher

1. **O passe extra se paga?** Cena única, sem transição e sem post: I.1 é custo puro.
2. **O efeito tem estado?** Se cada quadro é função só do tempo, é uniform — não é I.4.
3. **O que isso obriga a carregar?** Toda técnica que depende de asset (depth map, malha, modelo)
   entra no `budget` do brief como número, e o número é derivado das respostas da fase 1 —
   nunca fixado antes (ver PLUGIN-SPEC §5).
4. **Como ela reprova?** Se você não sabe qual medida cairia se a técnica estivesse mal aplicada,
   você não entendeu o mecanismo. Volte à ficha.

## As 9 regras transversais

Valem para qualquer técnica escolhida. **`references/regras-transversais.md` é a fonte única das
9 no plugin** — enunciado, predicado de verificação e "reprova quando" moram lá, e a
`visual-guardrails` aponta para o mesmo arquivo em vez de reenunciá-las. A tabela abaixo é índice,
não definição: quando o número decidir, abra a referência.

O que muda entre os dois leitores é o **uso**: aqui a regra existe para **informar a escolha da
técnica**; na `visual-guardrails` ela é **portão de build**.

| # | Regra | Máquina |
|---|---|---|
| 1 | Progresso normalizado 0–1 como moeda comum; fontes concorrentes combinadas por `Math.max` | parcial (teste) |
| 2 | Um ticker, um estado | sim |
| 3 | Meça o layout uma vez por quadro, antes de escrever | sim (runtime) |
| 4 | Pré-processe o que não muda | parcial (determinismo do build) |
| 5 | Textura em vez de procedural quando o olho não distingue | não |
| 6 | Escale por dispositivo com um número, nunca com um caminho de código | sim (estático) |
| 7 | Não monte o que está desligado | sim (estático) |
| 8 | `prefers-reduced-motion` desde a arquitetura | sim (runtime) |
| 9 | Toda constante mágica carrega o comentário com a medição | sim (estático) |

## Antes de transformar qualquer número em critério

Duas lições caras do protótipo 01, que valem para toda medição de técnica:

- **Medida nova exige validação do ambiente antes de virar critério.** Dois devs gastaram ~20 min
  cada perseguindo uma cauda de p5 fps que era outro processo disputando a GPU. Se um número não
  correlaciona com a variável que você mexe, o problema não é a variável.
- **Meça a faixa, não o instante.** Um texto com `clip-path` fechado media "2,86:1" porque o
  medidor lia ruído de fundo e chamava de texto; e uma máscara de threshold pode deixar o pior
  contraste em qualquer ponto de `uProgress`, não no 0 nem no 1.

Números completos, com o que cada um prova, em `references/medicoes-prototipo-01.md`.

## Arquivos de referência

| Arquivo | Conteúdo |
|---|---|
| `references/infraestrutura.md` | I.1 composite · I.2 DOM<->WebGL · I.3 ticker único · I.4 ping-pong FBO |
| `references/mundo-e-atmosfera.md` | II.1 chunking · II.2 fog injetado · II.3 inverted hull |
| `references/revelacao-e-transicao.md` | III.1 threshold · III.2 x-ray com fluido · III.3 cena persistente |
| `references/imagem-e-superficie.md` | IV.1 relight por depth map |
| `references/materia-e-movimento.md` | V.1 prepass · V.2 beats · V.3 damp · V.4 cursor-raio · V.5 Int16 |
| `references/regras-transversais.md` | as 9 regras, cada uma com o predicado verificável |
| `references/medicoes-prototipo-01.md` | todos os números medidos, e o que cada um prova ou refuta |
