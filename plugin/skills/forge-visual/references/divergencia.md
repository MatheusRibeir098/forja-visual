# Divergência executável (fase 2)

Referência da skill `forge-visual`. Este arquivo é o mecanismo, não o conselho: a tabela de
âncoras, a pré-atribuição, a partição do catálogo, o **briefing literal** que cada `visual-dev`
recebe, o objeto que ele devolve, os checks de colisão e o procedimento de re-briefe.

**O número de variantes é `brief.variantCount` (2 a 5, padrão 3) — perguntado ao dono na fase 1,
nunca fixado aqui.** Ao longo do arquivo, `N` é esse número. Nada abaixo depende de `N` valer 3.

## O defeito que este mecanismo existe para impedir

No protótipo 01, três variantes foram construídas por três subagentes instruídos a "gerar três
direções deliberadamente incompatíveis". **As três saíram da mesma família editorial.** O defeito
não apareceu na hora — apareceu semanas depois, com o site pronto, quando o dono disse *"achei que
seria futurista"*. Um site correto, medido e bem construído no gosto errado continua sendo o gosto
errado, e a rejeição não pôde corrigir porque as três opções eram sabores da mesma coisa.

A causa é mecânica: pedir divergência a um modelo que otimiza plausibilidade produz N pontos
próximos do centro. **Divergência precisa ser atribuída antes e conferida depois** — nunca pedida.
Aumentar `N` não conserta isso: cinco pontos no centro continuam sendo o centro, custando cinco
vezes mais.

---

## 1. Âncoras — o eixo pelo qual cada variante ataca o problema

Cada variante recebe **uma** âncora, obrigatória e exclusiva. A âncora diz o que **carrega a
imagem**; o resto fica subordinado. Não é o tema, é o meio.

| Âncora | O que carrega a imagem | O que fica subordinado | Fracasso típico |
|---|---|---|---|
| **Luz** | a cena existe porque algo é iluminado; a fonte de luz é personagem (cursor, scroll, tempo) | material neutro, tipografia sóbria, layout simples | virar demo de shader sem assunto |
| **Material** | a superfície: grão, tinta, metal, papel, vidro sujo, desgaste | a luz é fixa; o movimento é pequeno | virar textura bonita e página morta |
| **Tipografia** | a letra é o objeto: escala, corte, sobreposição, deformação. O WebGL, se houver, age sobre a letra | cor reduzida; poucos elementos | virar Medium com fonte grande |
| **Movimento** | timing, inércia, coreografia de scroll. Em repouso a página é quase sóbria | paleta contida, tipografia neutra | virar carrossel de animações |
| **Espaço** | profundidade e enquadramento: câmera, paralaxe, escala relativa, vazio | superfície simples, pouca cor | virar cena vazia sem foco |

**A lista tem cinco âncoras, e é o teto absoluto de `N`.** Duas variantes com a mesma âncora
convergem — é literalmente o defeito que esta fase existe para impedir. Não desdobre uma âncora em
duas ("luz quente" e "luz fria" é uma âncora, não duas), não invente uma sexta no meio da execução,
não deixe uma variante "misturar duas" — mistura é o caminho de volta ao centro.

### 1.1 Quais âncoras estão elegíveis para *este* brief

Antes de escolher, corte as que o brief exclui. A regra é mecânica e roda uma vez:

- `use3D === false` → **luz** sai. Luz sem objeto tem pouco a iluminar.
- `effectDensity === 'contida'` → **movimento** sai, **exceto** se o usuário tiver pedido reação
  forte a scroll/hover em P3 ou no `freeForm`.
- Qualquer item de `hates` que proíba o que a âncora **carrega** derruba a âncora (ex.: *"odeio
  página que se mexe sozinha"* → movimento sai; *"odeio textura suja"* → material sai). `hates`
  que proíbe um traço subordinado **não** derruba a âncora — só entra como restrição no briefing.
- A âncora também precisa passar na auditoria de pool da §3.2 (ter ≥ 2 mecanismos exclusivos
  utilizáveis sob este brief). Uma âncora sem com o que trabalhar não é uma âncora.

### 1.2 Escolher as `N` âncoras

Da lista elegível, na ordem de preferência abaixo — determinística de propósito, porque "escolher
as mais interessantes" é julgamento, e julgamento é o que este mecanismo remove:

- `use3D === true` → **luz, espaço, material, tipografia, movimento**, nessa ordem.
- `use3D === false` → **tipografia, material, espaço, movimento**, nessa ordem.

Regra extra **só para `N = 2`**, e ela vem antes da ordem acima: as duas âncoras têm de vir de
grupos opostos — **uma** de `{luz, material, espaço}` (a cena e a superfície) e **uma** de
`{tipografia, movimento}` (a letra e o tempo). Com duas variantes só, escolher `luz` + `espaço`
entrega duas cenas 3D escuras que o dono lê como "a mesma ideia com a câmera em outro lugar", e a
rejeição — que é o mecanismo inteiro — não tem em que se apoiar. Se o grupo `{tipografia,
movimento}` estiver inteiro inelegível, `N = 2` não é construível sob este brief: pare e pergunte
(§1.3).

### 1.3 Teto efetivo — quando `N` pedido não cabe

`N` não é limitado só pelas âncoras. Três listas precisam ter valores distintos para as `N`
variantes: **âncoras elegíveis** (§1.1), **classes tipográficas elegíveis** (§2) e **eixos de
layout elegíveis** (§2). O teto efetivo é o **menor** dos três. (A quarta dimensão, a luminância,
tem banda para todo `N` até 5 — mas com paleta travada elas ficam estreitas o bastante para pesar
pouco no olho; é recomendação, não teto. Ver o aviso na §2.)

Se `brief.variantCount` for maior que o teto efetivo, você tem exatamente três saídas permitidas —
e nenhuma delas é escolher sozinho:

1. **Pare e pergunte ao dono**, dizendo qual lista limitou e por quê. Ex.: *"você pediu 5, mas como
   o site não usa 3D a âncora `luz` não se sustenta e sobram 4 eixos distintos — construo 4?"*
2. Se o dono quiser mesmo as `N`, a saída é **mudar a resposta que apertou a lista** (ligar o 3D,
   soltar a paleta, remover um `hates` que ele reconheça como exagero) e recalcular — decisão dele,
   registrada no brief.
3. Construir menos variantes, com o número novo escrito em `.forge-visual/direcao.md`.

⛔ **Nunca** repita uma âncora, nunca invente uma sexta, nunca dê a duas variantes a mesma classe
tipográfica "porque a lista acabou". A degradação silenciosa é o defeito do protótipo 01 voltando
com outro nome — e desta vez você o viu chegando.

---

## 2. Pré-atribuição — antes de disparar qualquer subagente

Preencha esta tabela com **uma coluna por variante** (`A`, `B`, … até a `N`-ésima letra; `N = 5` vai
até `E`) e cole **a linha da variante** dentro do briefing dela. Os valores de cada linha são
**obrigatórios**, e os das colunas são **mutuamente distintos**.

| | A | B | C | (D) | (E) |
|---|---|---|---|---|---|
| Âncora | | | | | |
| Faixa de luminância de fundo (0–1) | | | | | |
| Classe tipográfica | | | | | |
| Eixo de layout | | | | | |
| Pool de técnicas | | | | | |

A tabela fecha **inteira antes do primeiro disparo**, mesmo quando as variantes forem construídas
em lotes (§4). Pré-atribuir em duas rodadas é decidir a segunda metade já sabendo o que a primeira
fez — e é assim que a segunda metade converge.

**Faixas de luminância** (mediana da luminância relativa do fundo em repouso, medida por
`measure-variant.ts`). Escolha a linha pelo `N` e pela paleta:

Paleta livre:

| N | Bandas |
|---|---|
| 2 | `0,02–0,10` · `0,70–0,92` |
| 3 | `0,02–0,10` · `0,25–0,45` · `0,70–0,92` |
| 4 | `0,02–0,08` · `0,20–0,32` · `0,45–0,60` · `0,75–0,92` |
| 5 | `0,02–0,07` · `0,15–0,25` · `0,34–0,46` · `0,55–0,67` · `0,78–0,93` |

Paleta travada em `escura`:

| N | Bandas |
|---|---|
| 2 | `0,02–0,06` · `0,15–0,25` |
| 3 | `0,02–0,06` · `0,08–0,14` · `0,15–0,25` |
| 4 | `0,02–0,05` · `0,07–0,10` · `0,12–0,16` · `0,18–0,25` |
| 5 | `0,02–0,04` · `0,055–0,075` · `0,09–0,115` · `0,13–0,16` · `0,18–0,25` |

Paleta travada em `clara`:

| N | Bandas |
|---|---|
| 2 | `0,60–0,70` · `0,88–0,95` |
| 3 | `0,60–0,70` · `0,75–0,85` · `0,88–0,95` |
| 4 | `0,60–0,68` · `0,72–0,78` · `0,82–0,88` · `0,90–0,95` |
| 5 | `0,60–0,66` · `0,69–0,74` · `0,77–0,82` · `0,85–0,89` · `0,91–0,95` |

**Quem fica com qual banda:** se a âncora **luz** estiver entre as escolhidas, ela fica com a banda
mais escura (a fonte de luz só vira personagem contra o escuro). As demais vão na ordem dos ids, de
baixo para cima. Determinístico de propósito.

⚠️ **Paleta travada com `N ≥ 4`** (e a `escura` é o caso extremo): as bandas caem para 0,02–0,03 de
largura, com 0,015–0,02 de intervalo entre elas. É estreito o bastante para que a luminância pare
de ser um eixo forte de divergência — a diferença existe no número e quase não existe no olho. Não
é proibido, mas **conte o custo ao dono antes**: o peso da divergência migra para tipografia,
layout e técnicas, e a taxa de re-briefe sobe, porque acertar uma faixa de 0,02 de largura é mais
difícil do que acertar uma de 0,10. Com paleta travada, `N ≤ 3` é a recomendação.

Paleta fechada **não** é licença para convergir: as faixas encolhem, as outras dimensões continuam
obrigatoriamente distintas.

**Classes tipográficas:** `serifada` · `grotesca` · `mono` · `display` · `condensada` — `N` valores
diferentes. Fontes proibidas em qualquer variante: Inter, Roboto, Poppins, Montserrat, Space
Grotesk, DM Sans, Manrope, Plus Jakarta.
Com `N = 2`, **pelo menos uma** das duas classes vem de `{serifada, display}`: duas sem-serifa
(`grotesca`/`mono`/`condensada`) leem como a mesma página com outra fonte instalada.

**Eixos de layout:** `centrado` · `assimetrico-esq` · `assimetrico-dir` · `grade-editorial` ·
`tela-cheia` — `N` valores diferentes. `centrado` só entra se **nenhum** item de `hates` o excluir
(ele é o traço mais reconhecível da média) — e repare que barrar `centrado` derruba o teto efetivo
de layout para 4, o que impede `N = 5` (§1.3).
Com `N = 2`, o par **não** pode ser `assimetrico-esq` + `assimetrico-dir`: é a mesma composição
espelhada, e espelho não é direção diferente.

**O `freeForm` do dono entra aqui, não no meio do briefing.** Quando o texto livre contradiz um
valor pré-atribuído (*"queria tudo bem escuro"* contra uma banda de `0,70–0,92`), quem resolve é o
orquestrador, **nesta seção**, antes do disparo — tratando o pedido como restrição de paleta e
recalculando as bandas. Deixar a contradição chegar ao `visual-dev` é pedir que ele decida entre
duas ordens, e ele decide pela que soa mais agradável. O texto livre chega ao briefing **literal**
(§4), mas já sem conflito com a pré-atribuição.

---

## 3. Partição do catálogo — e os assets do dono

A skill `visual-techniques` é a fonte; os ids abaixo são os do catálogo do projeto (se a skill
renomear, case pelo nome do mecanismo).

**Camada comum a todas** — infraestrutura não diferencia imagem, então não é disputada:
composite rendering / FBO (I.1), sync DOM↔WebGL (I.2), ticker único (I.3), ping-pong FBO (I.4).
Sincronizar a letra com o WebGL por I.2 é **infraestrutura**, não é técnica de ninguém: o que
diferencia a variante de tipografia é o mecanismo que age *sobre* a letra, não o sync.

### 3.1 Pools exclusivos, por âncora

| Âncora | Pool (com 3D) | Substituto quando `use3D === false` |
|---|---|---|
| Luz | IV.1 relight por depth map · V.4 cursor como raio · II.2 fog animado por injeção de shader | — (âncora inelegível sem 3D) |
| Material | V.5 quantização Int16 sem decode · II.3 contorno por inverted hull · grão/dither de superfície · tinta com bleed | grão/dither · tinta com bleed · half-tone/tramas em canvas 2D |
| Tipografia | III.1 máscara de threshold sobre a letra · SDF de texto · recorte da letra por máscara DOM | os mesmos (não dependem de 3D) |
| Movimento | V.2 beats ancorados no DOM · V.3 damping assimétrico · CSS scroll-driven / ViewTimeline | os mesmos |
| Espaço | V.1 depth prepass para nuvem aditiva · II.1 chunking infinito · III.2 x-ray reveal com fluido | paralaxe de camadas ancorada em scroll · escala relativa extrema com crop de sangria · câmera 2D sobre plano maior que a tela |

Mecanismos fora do catálogo entram com `id: null` e o nome do mecanismo — o check 1 compara por
`id ?? tecnica`, então **o nome importa**.

**Reserva:** os pools das âncoras que **não** foram escolhidas, mais III.3 (cena WebGL persistente,
que só se paga em site multi-página). A reserva não é terra de ninguém: o orquestrador pode alocar
um item dela a **no máximo uma** variante, nominalmente, na §2, quando o pool daquela âncora ficar
apertado. Alocado, ele vira exclusivo daquela variante como qualquer outro. Nunca dois donos.

Regra no briefing: *"você pode usar as técnicas do seu pool e a camada de infraestrutura. As
técnicas dos pools das outras âncoras estão proibidas nesta variante — outra variante as está
usando."* Liste **nominalmente** as proibidas: proibição genérica não é verificável.

### 3.2 Auditoria de pool — antes do disparo, uma vez

Quanto maior o `N`, mais apertada a partição: com `N = 5`, cinco variantes disputam 12 técnicas de
catálogo (as 16 menos as 4 de infraestrutura), e nenhuma pode tocar no que é da irmã.

Para **cada** âncora escolhida, conte quantos mecanismos do pool dela sobrevivem ao brief —
descartando os que `use3D === false` inviabiliza, os que um `hates` proíbe, os que o `budget` não
paga (`V.5` com nuvem grande, `IV.1` com depth map em resolução alta). O piso é **2**.

**Quando o pool de uma âncora fica abaixo de 2, na ordem, sem pular etapa:**

1. **Puxe da reserva** um mecanismo compatível com o que a âncora carrega, e registre-o na §2 como
   exclusivo dela.
2. **Complete com mecanismo fora do catálogo** (`id: null`). Isso é permitido e não é racionado — o
   catálogo é piso de invenção, não teto. Mas escreva no briefing, nominalmente, que rebatizar um
   mecanismo proibido não vale: *"paralaxe de camadas"* e *"coreografia de scroll com beats"* têm
   de sair com nomes diferentes porque **são** coisas diferentes, e o orquestrador confere lendo o
   par `tecnica` + `problema` de cada `TecnicaUsada`, não só o id.
3. **A âncora é inelegível sob este brief.** Troque-a pela próxima da ordem da §1.2 e refaça a
   auditoria para a nova.
4. **Acabaram as âncoras elegíveis** → o teto efetivo caiu: volte à §1.3 e **pergunte ao dono**.

Esta auditoria roda **antes** do primeiro disparo, e é a razão de ela existir: um `visual-dev` que
descobre no meio da construção que só tem um mecanismo permitido não devolve `BLOQUEADO` — ele
inventa um jeito de usar o que sobrou, e o que sobrou é o centro.

### 3.3 Os assets do dono valem para todas as variantes

Os arquivos de `brief.assets[]` — modelo 3D, imagem, fonte — ficam disponíveis para **todas** as
`N` variantes, sem exceção e sem racionamento.

**Por quê:** dar o modelo 3D do dono a uma só é vantagem arbitrária. A variante que tem o crânio
dele ganha da que não tem por um motivo que **não é direção visual**, e a escolha da fase 2 — a
única decisão de gosto da ferramenta inteira — deixa de ser sobre a imagem e passa a ser sobre quem
ficou com o brinquedo. O dono escolheria a direção errada com a sensação de ter escolhido bem, que
é a pior falha possível aqui.

**A tensão com a partição é aparente, não real.** O asset é o **substantivo**; a âncora é o
**verbo**. O mesmo crânio pode aparecer em três variantes sem que nenhuma se pareça com a outra:

- a de **luz** o usa como coisa que *é iluminada* — o personagem é a fonte de luz, e a malha
  poderia ser outra;
- a de **material** o usa como *superfície* — grão, tinta, desgaste, e a luz fica parada;
- a de **espaço** o usa como *escala* — o vazio em volta, o enquadramento, a câmera.

Isso é exatamente o que a âncora existe para produzir, e é o melhor teste de divergência que existe:
mesmo objeto, `N` imagens que não se confundem. **O que continua exclusivo é o mecanismo**, não o
arquivo: `V.5` (Int16 sem decode) é do pool de material; a variante de espaço que também monta uma
nuvem do mesmo `.stl` chega lá por outro caminho (ex.: `V.1`). Asset comum, mecanismo exclusivo — o
check 1 não muda uma vírgula por causa de assets.

**Regras de execução, todas verificáveis:**

- **O derivado é gerado uma vez, num passo serial, antes do primeiro disparo** — no mesmo lugar em
  que o `engine` e a pasta `dev/` já são preparados (§4). `N` devs processando o mesmo `.stl`
  custam `N`× e produzem `N` arquivos ligeiramente diferentes do que deveria ser o mesmo binário.
  Processamento é de **build**, nunca de runtime (PLUGIN-SPEC §5).
- O derivado vive num caminho **comum** do projeto (ex.: `src/assets/`), e os briefings só o
  **leem**. Nenhuma variante escreve ali — está fora da fronteira de arquivos de todas elas.
- **`attribution` não nula é obrigação, não formalidade.** Toda variante que usa o asset renderiza
  o crédito como `<a>` real na própria tela, porque a vencedora vira o site e o crédito precisa
  sobreviver ao corte de qualquer seção. Variante que usa um asset com atribuição e não mostra o
  crédito **não vai ao dono** — reprova junto com contraste e FPS (§7).
- O peso do derivado já está no `budget` do brief (fase 1). Uma variante não pode estourá-lo
  sozinha por usar o asset "com mais capricho".
- **Não usar o asset é permitido e não é demérito.** A âncora tipografia pode não ter o que fazer
  com um `.stl`. Mas o card dessa variante diz isso explicitamente (numa `feature` ou no `resumo`),
  para o dono não ler a ausência como desleixo — ele está comparando direções, e "esta direção não
  precisa do seu modelo" é informação legítima de direção.

---

## 4. Briefing literal do `visual-dev` de variante

⚠️ **Pré-requisito serial:** o projeto, o `engine` (ticker único + posse do canvas), a pasta `dev/`
e os **derivados dos assets** (§3.3) já existem quando este briefing é disparado, e `tsx` +
`playwright-core` já estão nas devDependencies. Todos os briefings assumem isso — se o `engine` não
existir, todos os `visual-dev` devolvem `BLOQUEADO` (ou, pior, cada um escreve o seu).

Uma invocação por variante, **na mesma mensagem**. Com `N > 4`, dispare em lotes de no máximo 4 —
a ordem é irrelevante e os lotes não convergem, porque a pré-atribuição inteira fechou antes do
primeiro disparo (§2). Contexto limpo: nenhum subagente vê o briefing, o código ou o resultado das
irmãs. Substitua tudo entre `<>`.

```md
# Variante <id: A..E> do hero — amostra construída para escolha do dono

Você constrói UMA tela. Outras <N-1> variantes estão sendo construídas em paralelo por outros
agentes, com âncoras e técnicas diferentes. Você não as vê e não pode adivinhá-las.

## Arquivos — você é o único dono
- `src/variants/<id>/**` (crie o que precisar aqui dentro)
- `dev/<id>.html` (a página que monta esta variante)
Não edite nada fora dessa lista. Não rode `pnpm install`/`pnpm add`: falta dep? reporte em
`pendencias`. Nunca rode `git reset`, `git checkout -- <arquivo>`, `git stash` ou `git clean`;
não commite.

## Contrato de montagem
`src/variants/<id>/index.ts` exporta `mountHero(root: HTMLElement, engine: Engine): void`.
Um ticker só (o do engine); nenhum `requestAnimationFrame` novo. **Leia `ENGINE.md`, na raiz do
projeto, antes de escrever a cena** — é a única fonte da interface `Engine`; não deduza pelos
nomes dos campos.

⚠️ `src/styles/tokens.css` chega com paleta placeholder gritante (magenta/ciano), de propósito:
enquanto ela não vira a paleta real da direção, `measure-contrast --min=7` reprova. Isso é o
portão funcionando, não um bug do medidor — não "conserte" mudando o script.

## O brief do projeto (fase 1)
<cole o VisualBrief inteiro, em JSON>

## Rejeições do dono — checks verificáveis
<cole .forge-visual/hates.md literal>

## Pedido em texto livre do dono
<cole brief.freeForm literal, ou "(não respondido)">
Ele é precisão adicional, não licença para trocar qualquer valor obrigatório abaixo. Se algo
nele parecer contradizer um valor obrigatório, o valor obrigatório vence e você reporta a
contradição em `pendencias` — não escolha por conta própria.

## Assets do dono — disponíveis para você e para todas as irmãs
<para cada item de brief.assets[]: caminho do DERIVADO já processado, kind, origin, license,
attribution, peso. Ou "(nenhum)">
Estes arquivos não são exclusividade de ninguém: as outras variantes também os têm. O que
diferencia a sua tela é **como a sua âncora os usa**, nunca o fato de os ter. O derivado já
está processado — não reprocesse, não gere outro, não escreva no caminho comum.
Se `attribution` não for nula e você usar o asset, o crédito vai na tela como `<a>` real; sem
ele a variante não é mostrada ao dono.
Não usar um asset é uma decisão legítima da sua direção — se for a sua, diga isso em `features`.

## Sua âncora: <LUZ|MATERIAL|TIPOGRAFIA|MOVIMENTO|ESPAÇO>
<cole a linha da tabela de âncoras: o que carrega a imagem, o que fica subordinado>
A imagem tem que ser explicável por esta âncora. Se a sua tela continuar funcionando ao remover o
que a âncora carrega, você atacou por outro eixo — refaça.

## Valores obrigatórios (não são sugestão; são conferidos por medição no retorno)
- Luminância mediana do fundo em repouso, dentro de: <faixa>
- Classe tipográfica: <classe> (proibidas: Inter, Roboto, Poppins, Montserrat, Space Grotesk,
  DM Sans, Manrope, Plus Jakarta)
- Eixo de layout: <eixo>

## Técnicas
- Permitidas: seu pool <lista> + a camada de infraestrutura <lista>.
- **Proibidas nesta variante** (outra variante as está usando): <lista nominal, uma por linha>.
- Mecanismo fora do catálogo é permitido — desde que seja outro mecanismo, não um proibido com
  nome novo. O `problema` que você declarar em cada técnica é o que denuncia o rebatismo.
- Proibições permanentes: consulte a skill `visual-guardrails`. Resumo: sem
  `postprocessing`/`EffectComposer`, GSAP, Lenis, Motion, drei, Tailwind, biblioteca de
  componentes, cursor custom, texto de conteúdo dentro de `<canvas>`.

## Escopo — o que NÃO construir
Uma tela só: um título, um parágrafo de conteúdo real, e a imagem. Sem seções abaixo, sem menu,
sem rodapé, sem responsivo polido (só não pode quebrar em 375×667), sem conteúdo final.
A comparação é entre direções, não entre acabamentos.

## Aceite (Given/When/Then, com número)
- Given a página em 1280×720 dpr 2, When medida com `measure-contrast`, Then contraste ≥ 7:1.
- Given a página em repouso, When medida com `measure-fps` em GPU real, Then mediana ≥ 60.
- Given 375×667, When carregada, Then `scrollWidth === clientWidth` e nada corta.
- Given `prefers-reduced-motion: reduce`, When carregada, Then não há animação contínua.
- Given cada check de `hates.md`, When aplicado a esta tela, Then passa.
- Given um asset com `attribution`, When usado, Then o crédito está na tela como `<a>` real.
- Toda constante mágica tem comentário com a medição que a justifica (método + data).

## Skills a consultar
`visual-techniques` e `visual-guardrails`. Não carregue outras.

## Retorno
O JSON padrão do `visual-dev`, com **um campo a mais**: `variant_card`.
<cole as interfaces TecnicaUsada e VariantCard da §5 desta referência>

- `variant_card.techniques` é **o mesmo array** que `tecnicas_usadas` — não escreva duas versões.
- `variant_card.contrast` e `.fps` são `medicoes.contraste_min` e `medicoes.fps_mediana`, medidos
  pelos scripts do plugin. Sem eles a variante não pode ser mostrada ao dono.
- **Não preencha `bgLuminance`, `motionCoverage`, `typeScaleRatio` nem `palette`.** Omita as quatro
  chaves — não estime, não calcule, não copie de um print. Elas chegam depois de você: o
  `visual-tester` roda `measure-variant.ts` contra a URL desta variante (método na §5.3) e o
  orquestrador funde o resultado no seu card antes de rodar os checks de colisão. Um valor seu
  nessas quatro chaves é descartado e, se a divergência entre as variantes parecer real só por
  causa dele, a comparação é invalidada — é exatamente o defeito que este mecanismo existe para
  impedir.
- Toda técnica que você usou entra em `tecnicas_usadas` com `camada` preenchida — inclusive a
  infraestrutura, marcada como `'infraestrutura'`. Omitir uma técnica do pool esconde uma colisão.
```

⛔ **O que não pode entrar neste briefing:** "seja criativo", "surpreenda", "algo impressionante",
"ousado", "único". Se a frase não vira número, arquivo, técnica nomeada ou proibição, ela sai.

---

## 5. `VariantCard` — o que volta

**Um formato só, montado em duas etapas por dois donos diferentes.** O `visual-dev` de variante
devolve o JSON padrão dele (`status`, `arquivos_alterados`, `build_ok`, `tecnicas_usadas`,
`medicoes`, `resumo`, `pendencias`) **mais** um `variant_card` **parcial** — sem `bgLuminance`,
`motionCoverage`, `typeScaleRatio` nem `palette` (§4). O card não repete nada do JSON padrão em
outra forma: ele **reusa** os mesmos arrays e os mesmos números. Se as duas partes divergirem, o
card é inválido e a variante é re-briefada — não "conciliada na leitura".

O card **completo** só existe depois que o `visual-tester` roda `measure-variant.ts` contra a URL
da variante (§5.3) e o orquestrador funde as quatro chaves que faltavam. Essa separação é o ponto
central desta seção: os quatro campos que os checks 4, 5 e 6 comparam **nunca** vêm de quem
construiu a variante — sempre da mesma implementação, rodada depois, sobre a página já pronta.
Deixar o `visual-dev` calculá-los devolveria `N` métodos diferentes do mesmo número, no exato
lugar onde a comparação precisa ser exata (ver "O defeito que este mecanismo existe para
impedir", no topo deste arquivo).

### 5.1 `TecnicaUsada` — a unidade que os dois lados compartilham

É o elemento de `tecnicas_usadas` no retorno do `visual-dev` **e** o elemento de
`VariantCard.techniques`. Mesmo tipo, mesmo array.

```ts
interface TecnicaUsada {
  id: string | null;          // id do catálogo: 'I.3', 'V.1', 'III.1'... null se não está no catálogo
  tecnica: string;            // o mecanismo, não o efeito: 'depth prepass com casco invisível'
  camada: 'pool' | 'infraestrutura';  // 'infraestrutura' NÃO conta no check de colisão
  problema: string;           // o problema visual nomeado que ela resolve NESTA tela
  constantes_medidas: string; // valor + método: 'HULL_SHRINK_MARGIN 0,018 por varredura; descarte 53,7%'
}
```

O campo `camada` existe para tornar o check 1 mecânico: sem ele, o orquestrador teria de adivinhar
o que é infraestrutura na hora de cruzar as listas — e adivinhar é exatamente o que falhou no
protótipo 01. Infraestrutura (I.1 composite/FBO, I.2 sync DOM↔WebGL, I.3 ticker único, I.4
ping-pong) é comum a todas por desenho e **nunca** caracteriza colisão.

### 5.2 `VariantCard`

```ts
interface VariantCard {
  id: 'A' | 'B' | 'C' | 'D' | 'E';   // até a N-ésima letra; N = brief.variantCount
  anchor: 'luz' | 'material' | 'tipografia' | 'movimento' | 'espaco';
  techniques: TecnicaUsada[];  // o MESMO array de `tecnicas_usadas` — não escreva uma segunda versão
  bgLuminance: number;       // 0–1, mediana da luminância relativa do fundo em repouso — medido, §5.3
  typeClass: 'serifada' | 'grotesca' | 'mono' | 'display' | 'condensada';
  typeScaleRatio: number;    // maior ÷ menor font-size renderizado na tela — medido, §5.3
  layoutAxis: 'centrado' | 'assimetrico-esq' | 'assimetrico-dir' | 'grade-editorial' | 'tela-cheia';
  motionCoverage: number;    // 0–1, fração de pixels que mudam entre dois quadros, sem input — medido, §5.3
  palette: string[];         // hex dos 3 tokens dominantes — medido, §5.3
  contrast: number;          // = `medicoes.contraste_min` do mesmo retorno (measure-contrast)
  fps: number;               // = `medicoes.fps_mediana` do mesmo retorno (measure-fps)
  features: string[];        // 3 a 5 características NOMEADAS, é o que o dono marca no 2º nível
}
```

**Onde cada campo é usado** — nenhum está aí por simetria:

| Campo | Serve a |
|---|---|
| `techniques` (`camada: 'pool'`) | check de colisão 1 |
| `typeClass` · `layoutAxis` · `bgLuminance` · `motionCoverage` · `palette` | checks 2 a 6 |
| `contrast` · `fps` | portão de exibição (§7, item 3): variante fora do piso não vai ao usuário |
| `anchor` · `features` | as duas perguntas ao dono, e `direcao.md` |
| `problema` / `constantes_medidas` de cada técnica | fase 3: a técnica sobrevivente já chega com o motivo e o número |

**Quem preenche cada campo — os dois donos não se misturam:**

| Campo | Preenchido por | Quando |
|---|---|---|
| `id` · `anchor` · `techniques` · `typeClass` · `layoutAxis` · `features` | `visual-dev` da variante | no próprio retorno (§4) |
| `contrast` · `fps` | `medicoes` do `visual-dev`, reconferido pelo `visual-tester` | `measure-contrast.ts` / `measure-fps.ts` |
| `bgLuminance` · `motionCoverage` · `typeScaleRatio` · `palette` | **só** `measure-variant.ts`, rodado pelo `visual-tester` | depois que a variante existe (§5.3), fundido pelo orquestrador |

Os quatro campos medidos por `measure-variant.ts` **nunca** chegam do `visual-dev` — nem como
estimativa, nem como "o que eu esperava construir". Um `variant_card` que os traga preenchidos
pelo próprio dev é inválido: descarte-os e use só o que `measure-variant.ts` devolveu. O método
completo de cada um — por que mediana e não média, por que dois pares de quadro com intervalos
diferentes, por que o fundo é fotografado sem a tinta do texto — está no comentário de topo de
`scripts/measure-variant.ts`; não há uma segunda descrição da fórmula aqui de propósito, para as
duas nunca divergirem.

**Card incompleto não entra na comparação.** `contrast`, `fps`, ou qualquer um dos quatro campos
medidos ausente (porque a medição não rodou ou saiu inconclusiva) **não** vira `null` no card: a
variante volta ao `visual-dev`/`visual-tester`, ou a máquina é isolada e remedida. Comparar duas
variantes medidas com uma estimada é a eleição fraudada da §7.

`features` são frases curtas e concretas — é o material do segundo nível de escolha. Aceitável:
*"a luz do cursor é a única fonte da cena"*, *"a palavra é cortada pela borda da tela"*, *"a
rolagem tem inércia assimétrica: entra rápido, sai devagar"*. Inaceitável: *"visual moderno"*.

### 5.3 Como as variantes são medidas

Os medidores vêm com o plugin e rodam **contra o projeto**, não contra o plugin. Mesma família de
CLI que os irmãos — `--project`, `forge-visual.config.json` na raiz do site, códigos de saída
`0`–`4` — mas para `measure-variant.ts` **o `--out` da linha de comando é a única coisa que decide
o destino**; o campo `out` do config é ignorado por este script de propósito, porque todas as
variantes rodam contra o mesmo projeto e escreveriam por cima uma da outra no mesmo caminho
default:

```bash
cd <raiz do site>
pnpm exec tsx "${CLAUDE_PLUGIN_ROOT}/scripts/measure-contrast.ts" --project=. --url=<url da variante> --min=7
pnpm exec tsx "${CLAUDE_PLUGIN_ROOT}/scripts/measure-fps.ts"      --project=. --url=<url da variante> --min=60 --runs=3
pnpm exec tsx "${CLAUDE_PLUGIN_ROOT}/scripts/measure-variant.ts" --project=. --url=<url da variante> --id=<A..E> \
  --bg-min=<faixa atribuída> --bg-max=<faixa atribuída> \
  --out=.forge-visual/medicoes/variant-<id>.json
```

Quem roda os três é o `visual-tester`, uma vez por variante — `N` vezes no total.
`measure-variant.ts` grava `bgLuminance`, `motionCoverage`, `typeScaleRatio` e `palette` em
`.forge-visual/medicoes/variant-<id>.json` — **um arquivo por variante** — e é dali, não de
declaração de quem construiu, que o orquestrador lê os quatro campos que faltavam no
`variant_card` (§5.2) antes de rodar os checks de colisão da §6.

Códigos de saída de `measure-variant.ts`: `0` dentro da faixa atribuída (`--bg-min`/`--bg-max`) ·
`1` fora da faixa · `2` medição inválida (caiu em SwiftShader) · `3` **inconclusivo** · `4` nada
mensurável. `measure-variant.ts` só confere a variante contra a **própria** faixa — a comparação
entre as variantes (checks 4, 5 e 6) continua sendo do orquestrador, com os `N`
`.forge-visual/medicoes/variant-*.json` na mão.

⚠️ **`3` não autoriza cortar efeito.** Ele diz *"a máquina estava disputada ou a falha não se
repetiu"* — a resposta é isolar a máquina e remedir. Cortar um efeito por causa de um `3` é
exatamente o que custou 20 minutos a dois devs no protótipo 01, e a causa era um player de música.

---

## 6. Checks de colisão — rode com os `N` cards completos na mão

**Colisão é sempre uma propriedade de um par**, nunca "das três". Com `N` variantes há
`P = N × (N−1) ÷ 2` pares, e é sobre cada par que os checks 1, 2, 3, 4 e 6 são avaliados:

| N | 2 | 3 | 4 | 5 |
|---|---|---|---|---|
| Pares `P` | 1 | 3 | 6 | 10 |

| # | Check | Escopo | Critério |
|---|---|---|---|
| 1 | Técnicas | **par** | interseção vazia entre os `techniques` dos dois, filtrados por `camada === 'pool'`, comparando por `id ?? tecnica` |
| 2 | Tipografia | **par** | os dois `typeClass` são diferentes |
| 3 | Layout | **par** | os dois `layoutAxis` são diferentes |
| 4 | Luminância | **par** | cada `bgLuminance` dentro da **própria** banda atribuída, e as duas bandas não se sobrepõem |
| 5 | Movimento | **conjunto** | `max(motionCoverage) ÷ max(min(motionCoverage), 0,001) ≥ 3` **e** `max(motionCoverage) ≥ 0,05` |
| 6 | Paleta | **par** | no máximo 1 token coincide entre o par (**0**, quando `N = 2`), onde "coincide" é `\|Δr\| + \|Δg\| + \|Δb\| < 24` |

**Atalho de contagem, para não conferir 10 pares à mão:** os checks 2, 3 e 4 são categóricos e
transitivos — basta varrer a coluna e procurar valor repetido; qualquer repetição é um par
colidindo, e os pares são exatamente os que compartilham o valor. O check 1 idem, por técnica: uma
técnica de pool que aparece em duas colunas é uma colisão entre essas duas. **O check 6 é o único
que exige percorrer os pares de verdade**, porque a igualdade dele é por tolerância e **não é
transitiva**: `X` pode estar a menos de 24 de `Y`, `Y` a menos de 24 de `Z`, e `X` a mais de 24 de
`Z`. Não deduza o par que falta.

**Check 5, por que ele é do conjunto e não do par:** movimento é carregado por **uma** âncora.
Exigir razão ≥ 3 em todo par obrigaria a um espalhamento de `3^(N−1)` — com `N = 5`, de `0,01` a
`0,81`. Isso não é divergência, é caricatura. O que o check impede é o conjunto inteiro estar
parado (ou inteiro tremendo igual), e para isso basta comparar o **par extremo**: a variante de
maior e a de menor `motionCoverage`.

**Check 5, o porquê da segunda condição:** razão sozinha mente perto de zero. `0,0050` e `0,0166`
dão razão `3,3` — passaria no critério antigo — e as duas páginas estão **praticamente paradas**:
nenhuma chega perto do que um olho chamaria de "página com movimento". Por isso a razão só conta
como divergência satisfeita quando **pelo menos uma** das variantes tem `motionCoverage ≥ 0,05`;
abaixo disso o check **falha** (não satisfeito) mesmo com razão alta. Isso não é o código `3`
(inconclusivo) do medidor: é o critério do check dizendo que nenhuma variante tem movimento
suficiente para a razão significar alguma coisa.

**Check 5, quando ele é exigido:** só quando a âncora **movimento** está entre as `N` escolhidas.
Ela é a única que se comprometeu a carregar esse eixo; se ela não está no conjunto (porque
`effectDensity` é `contida`, ou porque `N = 2` e as âncoras foram outras), ninguém prometeu
movimento e reprovar por isso seria exigir do conjunto algo que a pré-atribuição não pediu. Nesse
caso o check é **informativo**: registre os números e siga. Com uma exceção que não é colisão e sim
recado para a fase 4 — se `effectDensity === 'alta'` e `max(motionCoverage) < 0,05`, o conjunto
inteiro está abaixo da densidade que o dono pediu: anote em `pendencias`, não em colisão.

E quando **movimento está** entre as âncoras, o check ganha um dono: a variante de âncora movimento
tem de ser a de **maior** `motionCoverage`. Se não for, quem falhou foi ela — não a irmã que ficou
quieta. Re-briefe essa, com o piso `0,05` escrito como número no briefing.

**Check 6, o porquê da tolerância:** hex diferente não é cor diferente para quem olha. `#101318` e
`#111419` — tokens de duas páginas propositalmente parecidas — têm `Δ = |1| + |1| + |1| = 3`, bem
abaixo de `24`: são a mesma cor. Comparação por igualdade exata de hex leria "0 tokens coincidem"
e aprovaria a colisão. `24` é a mesma constante que `measure-variant.ts` usa para montar a própria
paleta (`PALETTE_MIN_DISTANCE`, em `scripts/measure-variant.ts`) — dois pontos que ficam a menos
de `24` de distância já contam como o mesmo token ali, e o check reusa o critério em vez de
inventar um segundo.

**Check 6 com `N = 2`, por que 0 e não 1:** com duas variantes existe **um** par, e ele é a
comparação inteira que o dono vai fazer. Um token comum, num universo de três tokens dominantes,
já é um terço da identidade de cor compartilhada — com três variantes isso é ruído, com duas é
metade da eleição.

### 6.1 Veredito

Chame de **par falho** todo par que falhou em pelo menos um dos checks 1, 2, 3, 4 ou 6. Um par que
falha em vários checks continua sendo **um** par falho — só é um par especialmente ruim, e a nota
no fim desta seção diz o que fazer se ele reincidir.

Aplique **nesta ordem**, e pare no primeiro que couber:

0. **Nenhum par falho e check 5 satisfeito (ou não exigido)** → mostre ao usuário (§7).
1. **Alguém violou a própria pré-atribuição** (`bgLuminance` fora da faixa designada, `typeClass`
   ou `layoutAxis` diferente do atribuído, técnica de pool alheio) → re-briefe **essa(s)**, e só.
   Ela não colidiu com a irmã: descumpriu a ordem que recebeu, e o par volta a passar quando ela
   obedecer. Isso vem antes de qualquer contagem.
2. Senão, ache o **menor conjunto `S` de variantes que, refeitas, zerariam todos os pares falhos**
   (com no máximo 5 nós dá para achar de cabeça: comece pela variante que aparece em mais pares
   falhos). Então:
   - `|S| = 1` → re-briefe **só ela**, mesmo que ela colida com várias irmãs. Uma variante que
     colide com todo mundo é uma variante no centro; as outras estão separadas entre si e não têm
     por que ser jogadas fora.
   - `2 ≤ |S| ≤ N ÷ 2` → frentes independentes (ex.: `A×B` e `C×D`). Re-briefe as de `S`, **todas
     na mesma mensagem**, e mantenha as demais como estão.
   - `|S| > N ÷ 2` → mais da metade do conjunto teria de ser refeita. **Não há infratora: a
     pré-atribuição não separou.** Não re-briefe variante nenhuma e não mostre nada ao dono; volte
     à §1/§2, refaça a atribuição inteira (âncoras, bandas, classes, eixos, pools) e reconstrua
     **todas**. Com `N = 3` isso acontece quando os 3 pares falham — é o "as três estão na mesma
     família" do protótipo 01, pego antes de o site existir.

**Empate ao montar `S`** (duas escolhas de mesmo tamanho): preserve a de letra menor (A antes de B
antes de C…) e re-briefe a outra. Determinístico de propósito: escolher "a mais bonita" reintroduz
julgamento onde o mecanismo existe para removê-lo.

**Com `N = 2` não existe meio-termo.** O único par é a comparação inteira, e `|S| = 1 > N ÷ 2 = 1`
é falso por um fio — então a regra é escrita à mão: qualquer par falho com `N = 2` significa que o
dono escolheria entre duas versões da mesma ideia. Refaça a pré-atribuição **das duas** (âncoras
inclusive, respeitando a regra de grupos opostos da §1.2) e reconstrua as duas.

**Como re-briefar:** invocação **nova**, contexto limpo, mesmo template, com (a) o valor específico
que precisa mudar e por quê, (b) a técnica que agora está proibida porque a irmã a tomou. Não
reaproveite o subagente anterior — o histórico dele contém a solução que colidiu, e ele volta para
ela.

**Um par que falha em ≥ 3 dos 5 checks** são duas variantes quase idênticas. Ainda é um par falho e
segue a regra acima — mas se **o mesmo par** voltar a falhar depois do re-briefe, não insista no
valor: pule direto para a troca de âncora do parágrafo seguinte, porque duas âncoras que produzem a
mesma imagem sob este brief não vão se separar por outra fonte.

**Teto: 2 re-briefes por variante.** Na terceira colisão, o problema é a âncora escolhida (ela não
consegue produzir imagem distinta sob este brief): troque a âncora por outra **elegível** (§1.1),
refaça a auditoria de pool dela (§3.2) e recomece essa variante. Se não houver âncora elegível
sobrando, o teto efetivo caiu — volte à §1.3 e pergunte ao dono. Registre a troca; é informação
sobre a ferramenta, não sobre o projeto.

---

## 7. Mostrar e colher a escolha

1. Suba (`pnpm dev`) e entregue **as `N` URLs** (`/dev/a.html`, `/dev/b.html`, … até a `N`-ésima).
   O usuário abre **no navegador dele, em GPU real**.
2. `visual-tester`: **no máximo 1 print por variante** (`N` no total, teto de 5), sem `fullPage`, e
   a descrição textual das falhas. A print é registro; a decisão é tomada com a tela rodando.
3. Nenhuma variante que reprovou em contraste, FPS, nos checks de `hates.md` ou na atribuição de
   asset (§3.3) é mostrada.

Duas perguntas, nesta ordem:

> **1) Qual das <N> continua? <A, B, C…>**

> **2) Das <N−1> que morrem, o que sobrevive?** Marque o que você quer manter:
> — de <perdedora 1>: `features[]` dela, uma por linha
> — de <perdedora 2>: `features[]` dela, uma por linha
> — … uma lista por perdedora

O segundo nível não é cortesia: no protótipo 01, duas técnicas das variantes rejeitadas viraram
**seções inteiras** do site final. Com `N = 5` a lista fica longa — não a resuma nem pré-selecione
"as melhores": pré-selecionar é decidir pelo dono no único lugar em que ele decide.

### `.forge-visual/direcao.md`

```md
# Direção escolhida
Variantes construídas: <N> (brief.variantCount = <N>; teto efetivo <n>, limitado por <lista>)
Vencedora: <id> — âncora <âncora>
Card medido: bgLuminance <x> · typeClass <x> · layoutAxis <x> · motionCoverage <x> ·
contraste <x> · fps <x>

## Sobreviventes
- de <id>: "<feature>" → vira <seção/elemento do site final>
- de <id>: "<feature>" → vira <seção/elemento do site final>

## Descartado explicitamente
- <feature/técnica> — motivo: <o dono não marcou | colide com hates.md | colide com a vencedora>

## Assets do dono
- <arquivo> (<origin>, <license>) — crédito obrigatório: <attribution ou "não">

## Conflitos loves × hates resolvidos
- <traço> aparecia em <referência admirada> e viola <check de hates.md> → fora.
```

As perdedoras **permanecem no repositório** em `src/variants/<id>/`, fora do bundle (não
importadas). São o registro de rejeição — o fator que mais empurrou o resultado para longe da
média no projeto de referência.
