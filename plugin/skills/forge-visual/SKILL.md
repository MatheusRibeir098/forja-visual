---
name: forge-visual
description: Conduz a construção de um site de alto impacto visual em cinco fases — questionário de direção visual, divergência com três amostras reais construídas e medidas, escolha de técnicas por mecanismo, construção com subagentes em paralelo e medição que reprova. Use quando o pedido for "quero um site que impressione", "site com 3D/WebGL", "site que não pareça feito por IA", ou quando o usuário invocar /forge-visual.
---

# /forge-visual — condução das cinco fases

Você é o **condutor**. Não escreve código de produto: extrai a direção visual, força a
divergência, escolhe técnicas, delega a construção aos subagentes `visual-dev` e a validação
ao `visual-tester`, e roda os portões.

**Onde conferir os números.** Tudo que aparece como "medido no protótipo 01" saiu de
[`forja-visual-site`](https://github.com/MatheusRibeir098/forja-visual-site) — código aberto, no ar
em [forja-visual.vercel.app](https://forja-visual.vercel.app).

## A regra que governa esta skill inteira

**O que tira da média é restrição e rejeição, não incentivo.**

Um LLM que gera site segue o caminho de menor resistência, e esse caminho desemboca sempre no
mesmo lugar: hero centralizado, gradiente, três colunas de features, Inter, um fade-up. Isso não
é falha de capacidade — é o comportamento esperado de um sistema que prevê o token mais provável.
A média é, por construção, a opção menos distintiva possível.

Consequência operacional, válida em todo briefing que você escrever:

- ⛔ Proibido escrever, em qualquer briefing de subagente: *"seja criativo"*, *"capriche"*,
  *"faça algo impressionante"*, *"surpreenda"*, *"ousado"*, *"único"*, *"moderno"*, *"clean"*,
  *"premium"*. Adjetivo motivacional produz a média com adjetivos.
- ✅ Cada exigência é **verificável**: um número, um arquivo, uma técnica nomeada, uma proibição,
  ou um valor de campo que o subagente devolve e você confere.
- **Autoteste:** se você escreveu um adjetivo, ou ele vira número/restrição, ou sai da frase.

## Escopo — quando esta skill não serve

Stack fixa: **TypeScript puro + Vite + three, sem framework, sempre projeto novo.** Não é
preguiça: sem framework o site controla cada quadro, carrega menos e **não herda os padrões
visuais que vêm de biblioteca pronta** — que são exatamente os que fazem tudo parecer igual.

Se o usuário já tem um projeto React/Next e quer aplicar a ferramenta nele, **diga que está fora
do escopo por ora** e ofereça o caminho de projeto novo. Não improvise uma adaptação.

## Artefatos (arquivos de controle, não código)

Grave em `.forge-visual/` na raiz do projeto:

| Arquivo | Fase | Conteúdo |
|---|---|---|
| `brief.json` | 1 | o `VisualBrief` (formato congelado, §"O contrato") |
| `hates.md` | 1 | cada rejeição do usuário traduzida em **check verificável** |
| `variantes.json` | 2 | as três `VariantCard` medidas |
| `direcao.md` | 2 | vencedora + o que sobrevive das perdedoras |
| `tecnicas.md` | 3 | técnica → problema visual que resolve → custo |
| `tasks.md`, `progress.md` | 4 | o loop de construção |
| `medicoes/` | 5 | saída dos medidores (`measurements.json`, JSON dos scripts) |
| `screenshots/` | 2–5 | prints do `visual-tester` — teto de 3 por tarefa |

## Convenções do projeto gerado — escreva-as em todo briefing

Estas quatro convenções não são preferência de estilo: os agentes e os medidores dependem delas.
**Todo briefing de `visual-dev` e de `visual-tester` as carrega**, porque convenção que só uma das
partes conhece não é convenção.

| Convenção | Valor | Quem depende |
|---|---|---|
| Variante | `src/variants/{a,b,c}/index.ts` exportando `mountHero(root: HTMLElement, engine: Engine): void` | `visual-dev` (escreve), fase 2 (monta) |
| Página de variante | `dev/<id>.html` → servida em `/dev/a.html`, `/dev/b.html`, `/dev/c.html` | `visual-tester` (mede e fotografa por URL) |
| Artefatos de controle | `.forge-visual/` na raiz do **projeto do usuário** — nunca dentro do plugin | todos |
| Configuração dos medidores | `forge-visual.config.json` na raiz do projeto (evita repetir argumentos) | os três `measure-*.ts` |
| Interface do motor | `ENGINE.md` na raiz do projeto (copiado do template) | `visual-dev` — lê antes de escrever `mountHero`/`mountSection` |

As variantes perdedoras **ficam** em `src/variants/`, fora do bundle (não importadas): são o
registro de rejeição.

## Como o projeto nasce — copie o template, não crie do zero

`templates/site/`, dentro do plugin, é o ponto de partida de **todo** site gerado: motor
provado (`src/engine/`), shaders genéricos, base de CSS e configuração inteira, sem nenhuma
decisão de imagem dentro. O scaffold da fase 2 é

```
cp -R "${CLAUDE_PLUGIN_ROOT}/templates/site/." ./<site>/ && cd <site> && pnpm install
```

**Não** `pnpm create vite`, nem `package.json` montado à mão — isso produziria um site sem
`engine`, e cada `visual-dev` de variante inventaria o seu.

**`ENGINE.md`, na raiz do projeto copiado, é a única fonte da interface `Engine`.** Todo
briefing que pedir `mountHero(root, engine)` ou `mountSection(root, engine)` manda o dev ler
esse arquivo antes de escrever a cena — antes dele isso era um buraco: o contrato existia sem
nada descrever o `engine`.

**A paleta em `src/styles/tokens.css` chega placeholder gritante de propósito** (magenta/ciano).
Enquanto o brief não entrar com as cores reais, `measure-contrast --min=7` **reprova** — é um
portão intencional para ninguém esquecer de decidir a paleta, não um bug do medidor. Se um dev
achar essa reprovação estranha antes de a paleta estar decidida, a resposta é decidir a paleta,
nunca "consertar" mudando o script de medição.

**`tsx` e `playwright-core` já vêm nas devDependencies do template.** Os medidores moram no
plugin, mas carregam o `playwright-core` **do projeto medido** — é assim que funcionam em
qualquer site sem instalar nada no plugin. Sem essas duas devDependencies, `measure-contrast` e
`measure-fps` não sobem navegador e os dois portões que reprovam ficam sem número. Onde um
briefing antigo mandava adicioná-las com `pnpm add -D`, isso agora é redundante — e **não devem
ser removidas** numa "limpeza" de `package.json`.

---

# Fase 1 — Questionário de direção visual

**Perguntas de escolha entre opções concretas, nunca abertas.** Perguntar *"que estética você
quer?"* a quem não é designer devolve silêncio ou "moderno". Perguntar *"futurista ou pé no
chão?"*, *"muito efeito ou contido?"*, *"com 3D ou sem?"* devolve resposta utilizável.

O roteiro literal — as perguntas, as opções, o que fazer com resposta inútil e com "tanto faz" —
está em [`references/questionario.md`](references/questionario.md). Leia antes de perguntar.

Eixos obrigatórios (nenhum pode ficar vazio no brief):

| Eixo | Forma |
|---|---|
| Tema/assunto | aberta, curta |
| Temperatura | futurista ↔ pé no chão |
| Densidade de efeito | muito efeito ↔ contido |
| 3D | com objetos 3D / sem (impacto por tipografia, layout, movimento) |
| Paleta | escura / clara / neon / monocromática / a definir pela amostra |
| Referências | o que admira **e o que odeia** — a segunda vale mais |
| Público e uso | portfólio, produto, evento… — define se o site pode ser lento para carregar |

## `hates` pesa mais que `loves` — e tem que ser usado, não coletado

Uma lista de rejeições que fica bonita no brief e não muda nada é decoração. Mecanismo obrigatório:

1. **Toda entrada de `hates` vira uma linha verificável** em `.forge-visual/hates.md`, no formato
   `rejeição do usuário → check`. Se você não consegue escrever o check, **pergunte de novo** até
   conseguir. Tabela de tradução em [`references/questionario.md`](references/questionario.md).

   | O usuário disse | Check que entra no arquivo |
   |---|---|
   | "odeio roxo" | nenhum token de cor com hue em 250–300 |
   | "odeio site lento" | `criticalKb` ≤ 150 e primeiro quadro pintado sem esperar WebGL |
   | "odeio aquele scroll que não obedece" | sem Lenis/scroll suave por JS; scroll é o do navegador |
   | "odeio cursor que vira bolinha" | sem cursor custom; `cursor` fica no valor nativo |
   | "odeio site que parece template" | ⚠️ não é check — reabra a pergunta com o menu de traços |

2. **`hates.md` é anexado literalmente** a todo briefing das fases 2 e 4, junto com as proibições
   fixas da skill `visual-guardrails`.
3. **Portão de exibição:** nenhuma amostra da fase 2 vai ao usuário sem você conferir os checks de
   `hates.md`. Amostra que viola um check é **re-briefada, não mostrada com ressalva**.
4. **Conflito `loves` × `hates`: `hates` vence.** Se o usuário admira um site que exibe um traço
   que ele odeia, o traço fica de fora — registre a decisão em `direcao.md`.

## O contrato — `VisualBrief`

Saída da fase 1, entrada das fases 2–5. **Forma congelada** (spec §5): outras partes do plugin
dependem dela. Se você achar que precisa mudar, **relate ao dono; não mude**.

```ts
interface VisualBrief {
  subject: string;              // do que o site trata
  temperature: 'futurista' | 'pe-no-chao' | string;
  effectDensity: 'alta' | 'media' | 'contida';
  use3D: boolean;
  palette: string;              // 'escura' | 'neon' | ... | descrição livre
  loves: string[];              // referências que admira
  hates: string[];              // o que rejeita — pesa mais que `loves`
  audience: string;
  budget: {                     // DERIVADO das respostas, não fixado antes
    criticalKb: number;
    lazyKb: number;
    rationale: string;          // por que estes números, dadas as respostas
  };
}
```

## O `budget` é derivado — nunca fixado antes

⚠️ Teto arbitrário no início produziu, no protótipo 01, relevo em meia resolução, nuvem de pontos
com 1/4 dos pontos e pós-processamento banido — um site que **passava em todas as métricas e não
impressionava ninguém**. O orçamento existe para forçar uma decisão de arquitetura, não para
degradar asset.

Esqueleto da derivação (tabelas, multiplicadores e dois exemplos resolvidos em
[`references/orcamento.md`](references/orcamento.md) — use as tabelas de lá, não invente números):

```
criticalKb = 50 (shell TS+CSS+conteúdo)
           + 25 × (nº de famílias de fonte variável)
           + 124 se o WebGL aparece no PRIMEIRO quadro   // three core tree-shaken, medido
           + 20 de folga

lazyKb     = base(audience) × mult(effectDensity) + Σ custo medido dos assets previstos
```

Três regras que acompanham o número:

- **Bytes informam, não reprovam** (spec §6). Estourar o `lazyKb` nunca autoriza você ou um
  `visual-dev` a baixar resolução de asset, cortar amostras de shader ou remover efeito por conta
  própria. Autoriza **uma pergunta ao dono**.
- **Tensão entre público e direção resolve-se na arquitetura.** "Tráfego pago" (crítico baixo) +
  "3D no hero" não se resolve tirando o 3D: resolve-se tirando o `three` do primeiro quadro. A
  decisão vai escrita no `rationale`.
- **Re-derive depois da fase 2.** Só quando a direção vencedora existe é que os assets reais
  aparecem. Substitua as estimativas pelos números medidos e reescreva o `rationale`.

O `rationale` cita **qual resposta** produziu cada parcela. Exemplo aceitável:
*"crítico 219 KB: 50 shell + 25 (1 fonte variável) + 124 (three no primeiro quadro, porque o
hero é o objeto 3D) + 20 folga. Lazy 1000 KB: base 600 (lançamento com tráfego pago) × 1,6
(densidade alta) + 10 KB de shader — a direção é futurista por shader, não por asset, então não
há malha pesada. Tensão registrada: tráfego pago pediria crítico ≤ 150; o dono aceitou 219 em
troca do 3D no primeiro quadro."*

**Feche a fase 1** mostrando o brief ao usuário em prosa curta (não o JSON cru) e pedindo aval.

---

# Fase 2 — Divergência

**É aqui que a ferramenta vive ou morre.** No protótipo 01 a divergência falhou em silêncio: três
variantes foram construídas e as três saíram da mesma família editorial. Ninguém notou até o dono
ver o site pronto e dizer *"achei que seria futurista"*. Um agente instruído a "gerar 3 direções
diferentes" **converge sozinho** — a média é o atrator.

Por isso a divergência aqui é **pré-atribuída antes do disparo e conferida por número depois**.
Se você só ler uma parte desta skill com atenção, leia
[`references/divergencia.md`](references/divergencia.md): lá estão o briefing literal que cada
subagente recebe, a tabela de âncoras, a partição do catálogo e os checks de colisão.

## O mecanismo, em cinco passos — e um passo zero que é serial

**0. O projeto e o `engine` existem antes das três variantes — e vêm prontos do template.** As
variantes montam `mountHero(root, engine)`: sem um `engine` já escrito, cada `visual-dev`
inventa o dele, e você volta a ter três sites em vez de três variantes. `templates/site/` já
traz o motor provado, então essa tarefa deixou de ser "escrever o motor do zero" e virou uma
tarefa **serial**, curta, de `visual-dev`, antes do fan-out:

- `cp -R "${CLAUDE_PLUGIN_ROOT}/templates/site/." ./<site>/ && cd <site> && pnpm install` —
  entrega junto `src/engine/` (ticker único + contrato de posse do canvas), a pasta `dev/`, e
  `tsx`/`playwright-core` já como devDependencies (não adicione de novo);
- `.forge-visual/` com `brief.json` e `hates.md` já gravados;
- opcionalmente `forge-visual.config.json`, para os medidores rodarem só com `--project`.

Todo briefing de variante manda o dev ler `ENGINE.md`, na raiz do projeto copiado, antes de
escrever `mountHero` — é a única fonte da interface `Engine`, não invente pelos nomes dos
campos. E toda variante nasce com `src/styles/tokens.css` em placeholder gritante
(magenta/ciano): até a paleta real da direção entrar, `measure-contrast` reprova de propósito —
não é bug do medidor.

É o mesmo erro de sequenciamento da fase 4 ("a amarração é serial, antes do fan-out"), uma fase
mais cedo.

**1. Pré-atribua, antes de disparar qualquer coisa.** Você escolhe três âncoras distintas
(**luz**, **material**, **tipografia**, **movimento**, **espaço**) e, para cada variante, fixa
valores **obrigatórios e distintos** em três dimensões:

| Dimensão | A | B | C |
|---|---|---|---|
| Faixa de luminância de fundo | (uma faixa) | (outra) | (outra) |
| Classe tipográfica | serifada / grotesca / mono / display / condensada — três valores diferentes |
| Eixo de layout | centrado / assimétrico-esq / assimétrico-dir / grade-editorial / tela-cheia — três valores diferentes |

Se a paleta escolhida na fase 1 travar a luminância (ex.: `escura`), use **sub-faixas** dentro
dela (0,02–0,06 · 0,08–0,14 · 0,15–0,25) e mantenha as outras duas dimensões distintas. Paleta
fechada não é desculpa para convergir.

**2. Partição do catálogo.** Cada variante recebe um **pool de técnicas exclusivo** e é
**proibida de usar as técnicas dos pools das irmãs**. A camada de infraestrutura (ticker único,
composite/FBO, sync DOM↔WebGL, ping-pong) é comum a todas — infraestrutura não diferencia imagem.
Pools por âncora em [`references/divergencia.md`](references/divergencia.md).

**3. Contexto limpo.** Uma invocação de `visual-dev` por variante, **as três na mesma mensagem**
(chamadas em mensagens separadas viram fila). Nenhum subagente vê o briefing, o código ou a
técnica das irmãs — o briefing dele traz só o próprio pool e a lista do que está proibido.

**4. Meça antes de mostrar.** Cada variante roda `measure-contrast`, `measure-fps` e
`measure-variant` (os três scripts do plugin, rodados pelo `visual-tester`) e o `visual-dev`
devolve, no JSON padrão dele, um `variant_card` **parcial** — o formato está em
[`references/divergencia.md`](references/divergencia.md) §5. `variant_card.techniques` é o mesmo
array de `tecnicas_usadas`, e `contrast`/`fps` são os mesmos números de `medicoes`; mas
`bgLuminance`, `motionCoverage`, `typeScaleRatio` e `palette` **nunca** vêm do `visual-dev` — só de
`measure-variant`, rodado depois contra a página pronta, e fundidos no card por você. Deixar o dev
declarar esses quatro é reabrir o defeito do protótipo 01: três métodos diferentes do mesmo número.
Variante que não atinge contraste ≥ 7:1 e FPS mediana ≥ 60 **não vai ao usuário** — é corrigida
antes. Mostrar uma opção quebrada ao lado de duas saudáveis é eleição fraudada: o dono escolhe o
acabamento, não a direção.

⚠️ Medição que sai com **código 3 (inconclusivo)** não é variante reprovada nem variante aprovada:
é máquina disputada. Isole e remeça — nunca mande cortar efeito por causa de um `3`.

**5. Confira a colisão por número, não por impressão.** Com as três `VariantCard` na mão, rode os
checks abaixo. **Duas ou mais falhas = as três estão na mesma família** — exatamente o defeito do
protótipo 01, que só apareceu no fim.

| Check | Critério |
|---|---|
| Técnicas | interseção vazia entre os `techniques` com `camada === 'pool'` (a infraestrutura é comum por desenho) |
| Classe tipográfica | três valores distintos |
| Eixo de layout | três valores distintos |
| Luminância de fundo | três faixas (ou sub-faixas) distintas, sem sobreposição |
| Movimento | `motionCoverage` máx ÷ mín ≥ 3 **e** máx ≥ 0,05 — sem o piso absoluto, `0,0050` vs `0,0166` (razão 3,3, duas páginas praticamente paradas) passaria como divergência |
| Paleta | no máximo 1 token coincide entre duas variantes, com tolerância — `\|Δr\|+\|Δg\|+\|Δb\| < 24` conta como o mesmo token (`#101318` e `#111419` são a mesma cor) |

**Falhou?** Re-briefe **só a variante que repetiu** o valor de outra (preserve a que apareceu
primeiro na ordem A→B→C — critério determinístico, não estético), em invocação nova de contexto
limpo, com a restrição explicitada. Teto de **2 re-briefes por variante**; na terceira, o
problema é a âncora, não a execução: troque a âncora.

## O que uma variante é — e o que ela não é

- **É:** uma tela só (o hero), construída e rodando, montada em `dev/<id>.html` exportando
  `mountHero(root, engine)`, com título e um parágrafo de conteúdo real, sem quebrar em 375×667.
- **Não é:** o site inteiro, seções abaixo, responsivo polido, conteúdo final, nem — em hipótese
  alguma — **texto descrevendo como seria**. No protótipo 01 o dono escolheu vendo as três rodarem
  em GPU real; lendo descrições teria escolhido diferente. Se você se pegar escrevendo *"a
  variante B seria…"*, pare: variante que não roda não existe.
- **Custo:** 3×. Está no desenho, foi decisão do dono, e é justamente com três que o defeito de
  convergência fica visível.

## A escolha do usuário tem dois níveis

Suba as três (`pnpm dev` + as três URLs) e peça que ele abra **no navegador dele, em GPU real**.
O `visual-tester` captura **no máximo 1 print por variante** — registro, não substituto.

Faça exatamente duas perguntas:

1. **"Qual das três continua?"** — resposta A, B ou C.
2. **"Das duas que morrem, o que sobrevive?"** — apresente **3 a 5 características nomeadas de
   cada perdedora** (extraídas da `VariantCard` e do resumo do dev: a técnica, o gesto, a cor, o
   tempo), e o usuário marca quais viram seção ou elemento do site final.

O segundo nível não é cortesia: no protótipo 01, duas técnicas das variantes rejeitadas viraram
seções inteiras do site final.

Grave em `.forge-visual/direcao.md`: a vencedora, cada sobrevivente com origem (`de B`) e destino
(`vira a seção X`), e o que foi **explicitamente descartado** — o registro de rejeição vale tanto
quanto o de escolha. As perdedoras **ficam no repositório** em `src/variants/{a,b,c}/`, fora do
bundle (não importadas): são o registro do fator "rejeição iterada".

---

# Fase 3 — Técnicas

Consulte a skill **`visual-techniques`** e escolha os mecanismos que entregam a direção escolhida.
**Técnica, nunca componente:** "depth prepass para dar volume a nuvem de pontos aditiva" é
conhecimento transferível — explica o mecanismo e serve a problemas que ainda não apareceram;
"card com gradiente" não é.

Cada linha de `.forge-visual/tecnicas.md` tem **quatro campos**, e nenhum é opcional:

| Campo | Regra |
|---|---|
| Técnica | id + nome, como está em `visual-techniques` |
| Problema visual concreto | o que **nesta página** está errado sem ela. "Dar mais impacto" não é problema |
| Mecanismo | por que ela resolve — a física/matemática, não a receita |
| Custo | ms de GPU **ou** KB, estimado agora e medido na fase 5 |

Regras de corte:

- **Técnica sem problema concreto é reprovada.** Cobrir o catálogo por cobrir é o P4 ao contrário.
  No protótipo 01, três técnicas foram explicitamente reprovadas por esse motivo, com o teto de
  bytes já solto — não era orçamento, era ausência de problema.
- **Técnica herdada de sobrevivente tem prioridade sobre técnica nova.** O usuário já a escolheu.
- **Proibições da `visual-guardrails` valem aqui**, antes de custarem código: nada de
  `postprocessing`/`EffectComposer`, GSAP, Lenis, Motion, drei, cursor custom, biblioteca de
  componentes. Efeito de biblioteca pronta usado como está é acelerar a corrida rumo à média.
- **Nativo primeiro:** CSS scroll-driven animations e View Transitions API antes de qualquer
  biblioteca. Menos bundle, e um sinal real de não-IA — uma IA importa GSAP por reflexo.

---

# Fase 4 — Construção

É o loop de orquestração já provado: `visual-dev` em paralelo, um por tarefa, **arquivos
disjuntos**, teto de **3–4 simultâneos**, briefing auto-contido, todas as chamadas na mesma
mensagem.

Cada briefing de `visual-dev` carrega, sem exceção:

1. os arquivos que ele é o **único** dono, com o aviso de concorrência;
2. o `VisualBrief` inteiro;
3. a direção vencedora e os sobreviventes que essa tarefa realiza;
4. as técnicas designadas a ela (da fase 3), com o problema que cada uma resolve;
5. `hates.md` literal + a skill `visual-guardrails`;
6. critério de aceite Given/When/Then, com **número** (contraste, FPS, dimensão, tempo);
7. as skills a consultar — **1 ou 2, nomeadas**. Sem isso o subagente carrega várias por
   precaução e o contexto dele enche sem melhorar o código.

## O erro de sequenciamento que o protótipo 01 quase pagou

**A amarração é tarefa serial, antes do fan-out.** Quem desenha o quadro, quem faz `clear`, como
o scissor é dividido entre seções, quem inscreve no ticker único — se isso não estiver decidido e
escrito **antes** de disparar as seções em paralelo, cada `visual-dev` reclama o canvas do seu
jeito e o resultado é dois renders por quadro ou "quem desenha por último vence". No protótipo 01
três devs convergiram sobre esse contrato sem que ninguém o tivesse escrito.

Ordem que funciona: **motor/engine (serial) → contrato de posse do canvas (serial) → seções
(paralelo, arquivos disjuntos) → amarração final (serial) → acabamento (paralelo)**.

Regras que valem em toda tarefa desta fase:

- **Um ticker só.** Múltiplos `rAF` é a causa raiz de judder inexplicável.
- **`prefers-reduced-motion` desde a arquitetura**, não um `if` no fim: muda o frameloop, os
  callbacks assinados e o tier.
- **Escale por dispositivo com um número, não com um caminho de código** (contagem de pontos,
  amostras, densidade) — nunca uma cena alternativa.
- **Toda constante mágica carrega o comentário com a medição que a justifica**, incluindo método e
  data. Sem isso ninguém consegue mexer depois com segurança — e um comentário que envelheceu
  mentindo já custou uma decisão de densidade errada neste projeto.
- **Texto de conteúdo é DOM real, nunca dentro de `<canvas>`.**

---

# Fase 5 — Medição

**Não é relatório: é build vermelho.** Os portões rodam pelos scripts do plugin, contra a raiz do
projeto, mais o `build`/`typecheck`/`lint`/`test` do próprio site:

```bash
cd <raiz do site>
pnpm exec tsx "${CLAUDE_PLUGIN_ROOT}/scripts/measure-bundle.ts"   --project=. --brief=.forge-visual/brief.json
pnpm exec tsx "${CLAUDE_PLUGIN_ROOT}/scripts/measure-contrast.ts" --project=. --min=7
pnpm exec tsx "${CLAUDE_PLUGIN_ROOT}/scripts/measure-fps.ts"      --project=. --min=60
```

(`pnpm exec` a partir da raiz do site: o `tsx` é devDependency do site, não do plugin.)

Quem os roda é o `visual-tester`; ele lê os **códigos de saída** (`0` ok · `1` reprovou · `2`
medição inválida · `3` inconclusivo · `4` nada mensurável) e devolve o veredito. Você lê o JSON
dele, não a saída bruta. Um `forge-visual.config.json` na raiz do projeto dispensa os argumentos.

⚠️ **Código `3` continua vermelho, mas o diagnóstico é outro:** *isole a máquina e remeça*, nunca
*corte o efeito*. Re-briefar um `visual-dev` para "aliviar" um `3` é repetir os 20 minutos que dois
devs perderam no protótipo 01 por causa de um player de música disputando a GPU.

| Portão | Critério | Natureza |
|---|---|---|
| Contraste | ≥ 7:1, medido **por pixel** | **reprova** |
| FPS | mediana ≥ 60 em GPU real | **reprova** |
| Bytes | contra o `budget` do brief | **informa** |
| Build / typecheck / lint / test | verde | **reprova** |

Três armadilhas medidas neste projeto, que você tem que carregar:

- **GPU real ou o número é ficção.** Chrome headless puro cai em SwiftShader e mediu 27,2 FPS num
  site que fazia 60,3. Os medidores sobem o Chrome com `--use-gl=angle --use-angle=gl`; se alguém
  "otimizar" com base num FPS medido sem isso, está otimizando ruído.
- **Medida nova exige validação do ambiente antes de virar critério.** Dois devs gastaram ~20 min
  cada perseguindo uma cauda de p5 que era o player de música do dono disputando a GPU integrada.
  **Se um número não correlaciona com a variável que você mexe, o problema não é a variável** —
  cheque contenção de CPU/GPU antes de mexer no código. E não mate processos do usuário.
- **O medidor de contraste precisa saber o que é texto invisível.** Um parágrafo com `clip-path`
  fechado mediu "2,86:1" porque o medidor lia ruído de fundo e chamava de texto. Antes de aceitar
  uma reprovação de contraste, confirme que o elemento está de fato desenhando glifos.

**Quando um portão reprova:** re-briefe o `visual-dev` dono do arquivo com a falha descrita em
número. Mesmo erro na 3ª tentativa → reformule por outro ângulo técnico; persistiu → pare e
pergunte ao dono. Nunca fique re-briefando a mesma coisa.

**Fechamento:** re-derive o `budget` com os números medidos, atualize o `rationale`, e reporte ao
usuário: o que passou, o número de cada portão, e o que ficou de fora com o motivo.

---

## Checklist antes de dizer que terminou

- [ ] Todo eixo do questionário preenchido no `brief.json` — nenhum `""`, nenhum `null`.
- [ ] Todo item de `hates` tem check verificável em `hates.md`, e `hates.md` foi anexado aos
      briefings das fases 2 e 4.
- [ ] `budget` derivado das respostas, com `rationale` citando quais respostas, e **re-derivado**
      após a fase 2 com números medidos.
- [ ] As três variantes foram **construídas e rodadas**, medidas antes de mostrar, e passaram nos
      seis checks de colisão.
- [ ] A escolha do usuário foi registrada nos **dois níveis**, com os sobreviventes destinados a
      seções.
- [ ] Cada técnica em `tecnicas.md` tem problema concreto, mecanismo e custo.
- [ ] Contraste, FPS, build/typecheck/lint/test verdes; bytes medidos e relatados.
- [ ] Nenhum briefing que você escreveu contém adjetivo motivacional.
