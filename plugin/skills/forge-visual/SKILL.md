---
name: forge-visual
description: Conduz a construção de um site de alto impacto visual em cinco fases — questionário de direção visual, divergência com N amostras reais construídas e medidas, escolha de técnicas por mecanismo, construção com subagentes em paralelo e medição que reprova. Use quando o pedido for "quero um site que impressione", "site com 3D/WebGL", "site que não pareça feito por IA", ou quando o usuário invocar /forge-visual.
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
| `variantes.json` | 2 | as `variantCount` `VariantCard` medidas |
| `direcao.md` | 2 | vencedora + o que sobrevive das perdedoras |
| `tecnicas.md` | 3 | técnica → problema visual que resolve → custo |
| `tasks.md`, `progress.md` | 4 | o loop de construção |
| `medicoes/` | 5 | saída dos medidores (`measurements.json`, JSON dos scripts) |
| `screenshots/` | 2–5 | prints do `visual-tester` — teto de 3 por tarefa |

## Convenções do projeto gerado — escreva-as em todo briefing

Estas convenções não são preferência de estilo: os agentes e os medidores dependem delas.
**Todo briefing de `visual-dev` e de `visual-tester` as carrega**, porque convenção que só uma das
partes conhece não é convenção — e `check-structure.ts` reprova quem sair delas.

| Convenção | Valor | Quem depende |
|---|---|---|
| Seção | **uma pasta**: `src/sections/<nome>/index.ts` exportando `mountSection(root: HTMLElement, engine: Engine)` — `<nome>` = `id` da `<section>` no `index.html` = chave do `MOUNTS` | `visual-dev` (escreve), `check-structure` (reprova) |
| Texto da seção | `src/content/<nome>.ts`, tipado — **nunca** escrito no markup | `visual-dev`, `check-structure` |
| Estilo da seção | `src/sections/<nome>/style.css`, importado pelo `index.ts`; `src/styles/` é só o global | `visual-dev`, `check-structure` |
| Shader | `src/shaders/`, um arquivo por técnica, nomeado pelo **mecanismo** | `visual-dev` |
| Saída de script | `src/generated/`, produzida por `scripts/` e nunca editada à mão | `ingest-asset`, `check-structure` |
| Motor | `src/engine/` vem do template e **não se edita** | todos |
| Página de inspeção | `dev/<nome>.html` + `dev/<nome>.ts`, uma por seção | `visual-tester` (mede e fotografa por URL) |
| Variante | `src/variants/<id>/index.ts` exportando `mountHero(root: HTMLElement, engine: Engine): void` — `<id>` é `a`, `b`, `c`… até `variantCount` | `visual-dev` (escreve), fase 2 (monta) |
| Página de variante | `dev/<id>.html` → servida em `/dev/a.html`, `/dev/b.html`, … | `visual-tester` (mede e fotografa por URL) |
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

**O template já traz a estrutura, com um `README.md` por pasta.** `src/{sections,content,generated}`,
`scripts/`, `dev/` e `public/` chegam prontos, cada um com o que vai e o que não vai ali escrito
onde o dev vai olhar — mais o molde completo de uma seção (`src/sections/exemplo/` +
`src/content/exemplo.ts` + `dev/exemplo.{html,ts}`), que existe para ser copiado, renomeado e
apagado. Ele não está no `MOUNTS`, então não entra no bundle e sai sem quebrar nada. Nenhum
`visual-dev` precisa inventar onde as coisas moram — e `check-structure.ts` reprova quem inventar.

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

Eixos obrigatórios (nenhum pode ficar vazio no brief — as duas exceções estão marcadas):

| Eixo | Forma |
|---|---|
| Tema/assunto | aberta, curta |
| Temperatura | futurista ↔ pé no chão |
| Densidade de efeito | muito efeito ↔ contido |
| 3D | com objetos 3D / sem (impacto por tipografia, layout, movimento) |
| Paleta | escura / clara / neon / monocromática / a definir pela amostra |
| Referências | o que admira **e o que odeia** — a segunda vale mais |
| Público e uso | portfólio, produto, evento… — define se o site pode ser lento para carregar |
| Anexos | arquivos do usuário: caminho, tipo, **origem, licença e crédito** — `[]` é resposta válida |
| Nº de amostras | 2..5, padrão **3**; piso 2, teto = âncoras disponíveis |
| Campo livre | aberto — **última pergunta do roteiro**; `''` é resposta válida |

As três últimas linhas são a rodada 3 e têm ordem fixa: **anexos → nº de amostras → campo livre**,
e o campo livre nunca sobe. Perguntar em aberto antes das escolhas devolve "moderno"; depois delas
a pessoa já tem vocabulário e o texto vira precisão.

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

  /**
   * Quantas variantes construir na fase 2. Perguntado, não fixado.
   * PISO 2 — com uma só não existe rejeição, e a rejeição é o mecanismo (P3).
   * TETO = número de âncoras disponíveis; duas variantes com a mesma âncora
   * convergem de volta, que é o defeito que a fase 2 existe para evitar.
   */
  variantCount: number;         // 2..5, padrão 3

  /**
   * Campo livre, respondido DEPOIS de todas as escolhas concretas — nunca antes.
   * Chega LITERAL aos briefings das fases 2 e 4, como `hates`.
   */
  freeForm: string;             // '' quando não respondido

  /** Arquivos trazidos pelo usuário. */
  assets: BriefAsset[];

  budget: {                     // DERIVADO das respostas, não fixado antes
    criticalKb: number;
    lazyKb: number;
    rationale: string;          // por que estes números, dadas as respostas
  };
}

interface BriefAsset {
  path: string;                 // caminho do arquivo na máquina do usuário
  kind: 'model3d' | 'image' | 'font' | 'other';
  origin: string;               // de onde veio (autor, site, "próprio")
  license: string;              // licença declarada pelo usuário
  attribution: string | null;   // crédito exigido pela licença, se houver
  estimatedKb: number | null;   // peso previsto DEPOIS do processamento
}
```

Três campos merecem regra própria, abaixo: `variantCount`, `assets` e `freeForm`.

## `variantCount` — perguntado, com piso e teto

**Piso 2.** Com uma variante só não existe rejeição, e a rejeição é o mecanismo pelo qual esta
ferramenta sai da média (P3). Uma variante é "o agente entregou a primeira ideia plausível" —
o que o projeto existe para evitar. Quem pedir 1 recebe 2, com o motivo dito.

**Teto = âncoras disponíveis.** Cada variante recebe uma âncora distinta e obrigatória (luz,
material, tipografia, movimento, espaço). Mais variantes que âncoras significa duas com a mesma
âncora, que é convergência de volta. São 5 âncoras; com `use3D === false` a luz sai e o teto cai
para 4 (regra em [`references/divergencia.md`](references/divergencia.md) §1).

**O custo vai dito na pergunta:** cada variante é um hero construído de verdade por um subagente
próprio e medido antes de ser mostrado — N variantes custam ~N× tempo e tokens, e as conferências
de colisão crescem por par (3 → 3 pares, 5 → 10). Quem escolhe paga; então quem escolhe precisa
saber. Sem resposta → 3, declarado como assunção.

## `assets` — a entrada que nenhum gerador inventa

Um `.obj` processado por pipeline próprio é um dos **cinco fatores** que tiraram o portfólio de
referência da média (`VISAO.md` §3.1). Quem traz o próprio modelo, a própria textura ou a própria
fonte está trazendo o caminho mais curto para um site que não parece de IA. Por isso `assets` não
é conveniência de UX: é uma das entradas mais valiosas do brief.

Quatro regras, e nenhuma é opcional:

1. **Origem e licença são perguntadas sempre**, e o roteiro explica ao usuário **por quê** — ver
   P8 em [`references/questionario.md`](references/questionario.md). `license: "desconhecida"` é
   registrável, mas vai ao dono antes da fase 4: asset de origem desconhecida não entra em site
   publicado sem decisão explícita.
2. **`attribution` não-nulo é obrigação de renderização.** O crédito é um `<a>` real e fica numa
   região que **sobrevive ao corte de qualquer seção** — se uma tarefa da fase 4 remove ou
   reorganiza a seção que o continha, o crédito é realocado, nunca perdido. Todo briefing da fase 4
   que toque essa região carrega a lista de créditos junto.
3. **Processamento em build time, nunca em runtime**, e o arquivo fonte fica **fora** do
   repositório do site: só o derivado determinístico entra (no protótipo 01, `.stl` → `Int16` com
   sha256 estável).
4. **O anexo vale para todas as variantes da fase 2.** Dar o modelo a uma só seria vantagem
   arbitrária, e a escolha do usuário deixaria de ser sobre direção visual.

E o peso entra no `budget` **agora**, com `estimatedKb` (tabela por tipo em
[`references/orcamento.md`](references/orcamento.md)) — não é descoberto com o site pronto.
`estimatedKb` é o peso do **derivado**, nunca o tamanho do arquivo em disco: o arquivo fonte de
~20 MB do protótipo virou 670 KB. Quando não dá para estimar antes de processar, é `null` e o `rationale`
diz qual parcela ficou em aberto. **Não invente número.**

## `freeForm` — última pergunta, e chega literal

A ordem é o mecanismo, não gentileza: perguntar em aberto a quem não é designer devolve "moderno",
que é a razão de o questionário ser de escolhas. Depois de P1–P9 a pessoa já tem o vocabulário das
escolhas que fez, e o texto dela vira precisão.

- **Vai inteiro, sem reescrita, sem resumo**, aos briefings das fases 2 e 4 — o mesmo tratamento de
  `hates.md`. Resumir descarta justamente a parte que não coube em nenhum menu.
- **Rejeição escrita no campo livre também vira check** em `hates.md`. Duplicar é barato.
- **Não reabre eixo.** Contradição com uma escolha de P1–P9 é apontada ao usuário, que escolhe uma
  — nunca resolvida pela média.
- Sem resposta → `''`. Nunca preenchido com o seu resumo das respostas: um campo livre escrito por
  você entra na fase 4 como se fosse voz do usuário.

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
                                                  + Σ estimatedKb dos anexos (fonte vai no crítico)
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

**Feche a fase 1** mostrando o brief ao usuário em prosa curta (não o JSON cru) e pedindo aval —
incluindo quantas amostras serão construídas, os anexos com a licença de cada um, e o campo livre
citado literalmente.

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

**N = `variantCount` do brief (2..5, padrão 3), perguntado na fase 1.** Onde este documento diz
"três", leia N; a mecânica para N ≠ 3 — quais âncoras cabem, como o catálogo é partido e como os
checks de colisão são feitos par a par — está em
[`references/divergencia.md`](references/divergencia.md). Os anexos do brief (`assets`) ficam
disponíveis para **todas** as variantes: dar o modelo a uma só seria vantagem arbitrária, e a
escolha do usuário deixaria de ser sobre direção visual.

## O mecanismo, em cinco passos — e um passo zero que é serial

**0. O projeto e o `engine` existem antes das variantes — e vêm prontos do template.** As
variantes montam `mountHero(root, engine)`: sem um `engine` já escrito, cada `visual-dev`
inventa o dele, e você volta a ter N sites em vez de N variantes. `templates/site/` já
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

**1. Pré-atribua, antes de disparar qualquer coisa.** Você escolhe N âncoras distintas
(**luz**, **material**, **tipografia**, **movimento**, **espaço**) e, para cada variante, fixa
valores **obrigatórios e distintos** em três dimensões:

| Dimensão | A | B | C | … |
|---|---|---|---|---|
| Faixa de luminância de fundo | (uma faixa) | (outra) | (outra) | uma por variante, sem sobreposição |
| Classe tipográfica | serifada / grotesca / mono / display / condensada — N valores diferentes |
| Eixo de layout | centrado / assimétrico-esq / assimétrico-dir / grade-editorial / tela-cheia — N valores diferentes |

Se a paleta escolhida na fase 1 travar a luminância (ex.: `escura`), use **sub-faixas** dentro
dela (0,02–0,06 · 0,08–0,14 · 0,15–0,25 — divida a faixa em N sub-faixas sem sobreposição) e
mantenha as outras duas dimensões distintas. Paleta
fechada não é desculpa para convergir.

**2. Partição do catálogo.** Cada variante recebe um **pool de técnicas exclusivo** e é
**proibida de usar as técnicas dos pools das irmãs**. A camada de infraestrutura (ticker único,
composite/FBO, sync DOM↔WebGL, ping-pong) é comum a todas — infraestrutura não diferencia imagem.
Pools por âncora em [`references/divergencia.md`](references/divergencia.md).

**3. Contexto limpo.** Uma invocação de `visual-dev` por variante, **todas na mesma mensagem**
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

**5. Confira a colisão por número, não por impressão.** Com as N `VariantCard` na mão, rode os
checks abaixo. **Duas ou mais falhas = as N estão na mesma família** — exatamente o defeito do
protótipo 01, que só apareceu no fim.

| Check | Critério |
|---|---|
| Técnicas | interseção vazia entre os `techniques` com `camada === 'pool'` (a infraestrutura é comum por desenho) |
| Classe tipográfica | N valores distintos |
| Eixo de layout | N valores distintos |
| Luminância de fundo | N faixas (ou sub-faixas) distintas, sem sobreposição |
| Movimento | `motionCoverage` máx ÷ mín ≥ 3 **e** máx ≥ 0,05 — sem o piso absoluto, `0,0050` vs `0,0166` (razão 3,3, duas páginas praticamente paradas) passaria como divergência |
| Paleta | no máximo 1 token coincide entre duas variantes, com tolerância — `\|Δr\|+\|Δg\|+\|Δb\| < 24` conta como o mesmo token (`#101318` e `#111419` são a mesma cor) |

**Falhou?** Re-briefe **só a variante que repetiu** o valor de outra (preserve a que apareceu
primeiro na ordem alfabética dos ids — critério determinístico, não estético), em invocação nova de contexto
limpo, com a restrição explicitada. Teto de **2 re-briefes por variante**; na terceira, o
problema é a âncora, não a execução: troque a âncora.

## O que uma variante é — e o que ela não é

- **É:** uma tela só (o hero), construída e rodando, montada em `dev/<id>.html` exportando
  `mountHero(root, engine)`, com título e um parágrafo de conteúdo real, sem quebrar em 375×667.
- **Não é:** o site inteiro, seções abaixo, responsivo polido, conteúdo final, nem — em hipótese
  alguma — **texto descrevendo como seria**. No protótipo 01 o dono escolheu vendo as três rodarem
  em GPU real; lendo descrições teria escolhido diferente. Se você se pegar escrevendo *"a
  variante B seria…"*, pare: variante que não roda não existe.
- **Custo:** N×, e o usuário já ouviu isso em P9 antes de escolher N. O padrão é 3 porque é onde
  o defeito de convergência fica visível sem multiplicar o custo por cinco.

## A escolha do usuário tem dois níveis

Suba todas (`pnpm dev` + uma URL por variante) e peça que ele abra **no navegador dele, em GPU
real**.
O `visual-tester` captura **no máximo 1 print por variante** — registro, não substituto.

Faça exatamente duas perguntas:

1. **"Qual delas continua?"** — um id.
2. **"Das que morrem, o que sobrevive?"** — apresente **3 a 5 características nomeadas de
   cada perdedora** (extraídas da `VariantCard` e do resumo do dev: a técnica, o gesto, a cor, o
   tempo), e o usuário marca quais viram seção ou elemento do site final.

O segundo nível não é cortesia: no protótipo 01, duas técnicas das variantes rejeitadas viraram
seções inteiras do site final.

Com `variantCount === 2` há **uma** perdedora só, e o segundo nível continua valendo — o usuário
já foi avisado disso em P9.

Grave em `.forge-visual/direcao.md`: a vencedora, cada sobrevivente com origem (`de B`) e destino
(`vira a seção X`), e o que foi **explicitamente descartado** — o registro de rejeição vale tanto
quanto o de escolha. As perdedoras **ficam no repositório** em `src/variants/<id>/`, fora do
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

## Onde cada coisa mora — a estrutura que torna o paralelismo possível

```
src/
├── engine/            motor, vem do template — o dev de seção NÃO edita
├── shaders/           GLSL cru; um arquivo por técnica, nome do mecanismo
├── styles/            tokens, base, tipografia — o global, nada de seção
├── content/           TEXTO tipado, um arquivo por seção + index (site/colofão)
├── sections/
│   └── <nome>/        index.ts (mountSection) · style.css · markup.ts · scene.ts
├── variants/<id>/     variantes de hero da fase 2
├── generated/         medições e assets processados — nunca editado à mão
└── main.ts            monta as seções na ordem do documento

dev/<nome>.html+.ts    página isolada por seção, para inspecionar uma técnica de cada vez
scripts/               build de assets (determinístico)
public/                assets servidos (fontes em public/fonts/)
```

**Isto não é preferência estética — é a condição do fan-out.** A regra de ouro desta fase é
*arquivos disjuntos*: dois devs no mesmo arquivo significa que o segundo sobrescreve o primeiro.
Uma seção por pasta é o que garante interseção vazia **sem você negociar caso a caso**. Antes
desta convenção existir, três ou quatro `visual-dev` em paralelo inventavam cada um a sua — e o
resultado era arquivo jogado em qualquer pasta.

Três consequências que vêm de graça:

1. **Conteúdo separado de apresentação** (`content/` × `sections/`) — o texto é revisado sem
   tocar em código, e a seção pode ser remontada sem reescrever a cópia.
2. **Uma página de dev por seção** — inspecionar uma técnica isolada é o que torna o diagnóstico
   barato. No protótipo 01, `/dev/catalogo.html?check=1` resolveu um bug de alinhamento que a
   página inteira escondia.
3. **`generated/` explícito** — sem essa fronteira, alguém corrige o sintoma no arquivo gerado e
   a correção some no próximo build.

Como o template já traz o esqueleto e o molde (`src/sections/exemplo/`), a tarefa de cada dev é
**copiar o molde e renomear**, nunca decidir onde o arquivo vai. Ao distribuir as tarefas, dê a
fronteira como caminho literal: *"você é dono de `src/sections/manifesto/**` e
`src/content/manifesto.ts`; qualquer coisa fora disso é `pendencias`"*. É o que o portão
`check-structure.ts` cobra na fase 5.

## O briefing

Cada briefing de `visual-dev` carrega, sem exceção:

1. os arquivos que ele é o **único** dono, com o aviso de concorrência — para uma seção, isso é
   `src/sections/<nome>/**` + `src/content/<nome>.ts` + `dev/<nome>.{html,ts}`, e nada mais;
2. o `VisualBrief` inteiro;
3. a direção vencedora e os sobreviventes que essa tarefa realiza;
4. as técnicas designadas a ela (da fase 3), com o problema que cada uma resolve;
5. `hates.md` literal, o `freeForm` do brief **literal** (sem resumo), e a skill
   `visual-guardrails`;
6. critério de aceite Given/When/Then, com **número** (contraste, FPS, dimensão, tempo);
7. as skills a consultar — **1 ou 2, nomeadas**. Sem isso o subagente carrega várias por
   precaução e o contexto dele enche sem melhorar o código;
8. quando a tarefa usa um anexo do brief: o `BriefAsset` inteiro, o comando de ingestão em **build
   time** e — se `attribution` não for `null` — o crédito exato a renderizar como `<a>`. Tarefa que
   mexe na região dos créditos recebe a lista de créditos completa, porque **nenhum crédito pode
   morrer no corte de uma seção**.

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
- **Movimento por scroll/cursor é contínuo, nunca por evento.** Progresso lido a cada quadro pelo
  ticker, nunca quadro escrito dentro do handler — um quadro por evento de scroll lê como engasgo.
  `prefers-reduced-motion` **não é lido** (decisão do dono, PLUGIN-SPEC §5.1): os sites animam para
  todos, e isso não é lacuna a fechar.
- **Escale por dispositivo com um número, não com um caminho de código** (contagem de pontos,
  amostras, densidade) — nunca uma cena alternativa.
- **Toda constante mágica carrega o comentário com a medição que a justifica**, incluindo método e
  data. Sem isso ninguém consegue mexer depois com segurança — e um comentário que envelheceu
  mentindo já custou uma decisão de densidade errada neste projeto.
- **Texto de conteúdo é DOM real, nunca dentro de `<canvas>`** — e vem de `src/content/<nome>.ts`,
  tipado, nunca escrito no markup da seção. `check-structure.ts` reprova a frase hardcoded.
- **Ninguém edita fora da própria pasta.** `src/engine/` é do template; `src/styles/` é o global;
  `src/generated/` é do script. Faltou algo do motor? `pendencias`, não um `patch` no `engine/`.

---

# Fase 5 — Medição

**Não é relatório: é build vermelho.** Os portões rodam pelos scripts do plugin, contra a raiz do
projeto, mais o `build`/`typecheck`/`lint`/`test` do próprio site:

```bash
cd <raiz do site>
pnpm exec tsx "${CLAUDE_PLUGIN_ROOT}/scripts/measure-bundle.ts"   --project=. --brief=.forge-visual/brief.json
pnpm exec tsx "${CLAUDE_PLUGIN_ROOT}/scripts/measure-contrast.ts" --project=. --min=7
pnpm exec tsx "${CLAUDE_PLUGIN_ROOT}/scripts/measure-fps.ts"      --project=. --min=60
pnpm exec tsx "${CLAUDE_PLUGIN_ROOT}/scripts/check-structure.ts"  --project=.
```

**`check-structure.ts` é o portão da estrutura da fase 4** — o único que não mede nada: ele lê a
árvore de arquivos e reprova (1) arquivo de seção fora de `src/sections/<nome>/`, (2) texto
visível hardcoded no markup de uma seção em vez de vir de `content/`, (3) arquivo em
`src/generated/` sem procedência — ou com `sha256` diferente do que a ingestão gravou, que é
edição à mão depois de gerado —, e (4) `src/engine/` alterado, comparado byte a byte com o
template. Roda em menos de um segundo, sem navegador e sem build: pode rodar **durante** a fase 4,
a cada entrega de dev, e não só no fim. Regra sem verificação é conselho, e conselho é ignorado
quando aperta.

**Quando `brief.assets` tem algum item com `attribution`, um sexto portão roda junto:**
`check-attribution.ts` — reprova se o crédito de licença sumiu do HTML construído, ou se o link
do crédito ficou dentro de uma `<section>`/`<article>` (não sobrevive ao corte da seção). Sem
`assets` com `attribution` no brief, não há crédito a exigir, e ele não é rodado.

```bash
pnpm exec tsx "${CLAUDE_PLUGIN_ROOT}/scripts/check-attribution.ts" --project=. --build
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
| Estrutura | `check-structure.ts` — arquivo no lugar, texto em `content/`, `generated/` com procedência, `engine/` intocado | **reprova** |
| Crédito de licença | `check-attribution.ts` — só quando o brief tem `assets` com `attribution` | **reprova** |
| Bytes | contra o `budget` do brief | **informa** |
| Build / typecheck / lint / test | verde | **reprova** |

Quatro armadilhas medidas neste projeto, que você tem que carregar:

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
- **Contraste é propriedade de toda a faixa de animação, não de um instante.** Uma seção mediu
  1,13:1 e passou porque a medição caiu numa pose congelada, não no percurso inteiro. Como os sites
  animam sempre e para todos — `prefers-reduced-motion` não é lido, decisão do dono em PLUGIN-SPEC
  §5.1 — não existe mais um modo reduzido que "protege" a pior pose de aparecer para alguém.

**Quando um portão reprova:** re-briefe o `visual-dev` dono do arquivo com a falha descrita em
número. Mesmo erro na 3ª tentativa → reformule por outro ângulo técnico; persistiu → pare e
pergunte ao dono. Nunca fique re-briefando a mesma coisa.

**Fechamento:** re-derive o `budget` com os números medidos, atualize o `rationale`, e reporte ao
usuário: o que passou, o número de cada portão, e o que ficou de fora com o motivo.

---

## Checklist antes de dizer que terminou

- [ ] Todo eixo do questionário preenchido no `brief.json` — as únicas respostas vazias legítimas
      são `assets: []` e `freeForm: ''`, e as duas foram de fato perguntadas.
- [ ] Todo item de `hates` tem check verificável em `hates.md`, e `hates.md` foi anexado aos
      briefings das fases 2 e 4.
- [ ] `variantCount` foi **perguntado** (não assumido em silêncio), está entre 2 e o teto de
      âncoras, e o custo N× foi dito antes da escolha.
- [ ] Cada `BriefAsset` tem `path`, `kind`, `origin`, `license` e `attribution`; `estimatedKb` é
      número justificado ou `null` declarado — nenhum chute.
- [ ] Todo `attribution` não-nulo está renderizado como `<a>` real, numa região que sobrevive ao
      corte de seção; nenhum arquivo fonte de anexo entrou no repositório do site.
- [ ] `freeForm` chegou **literal** aos briefings das fases 2 e 4, e as rejeições contidas nele
      viraram check em `hates.md`.
- [ ] `budget` derivado das respostas — incluindo o peso dos anexos —, com `rationale` citando
      quais respostas, e **re-derivado** após a fase 2 com números medidos.
- [ ] As `variantCount` variantes foram **construídas e rodadas**, medidas antes de mostrar, e
      passaram nos seis checks de colisão.
- [ ] A escolha do usuário foi registrada nos **dois níveis**, com os sobreviventes destinados a
      seções.
- [ ] Cada técnica em `tecnicas.md` tem problema concreto, mecanismo e custo.
- [ ] Contraste, FPS, build/typecheck/lint/test verdes; bytes medidos e relatados.
- [ ] `check-structure.ts --project=.` saiu com `0`: cada seção na própria pasta, texto em
      `src/content/`, `src/generated/` com procedência e `src/engine/` idêntico ao template.
- [ ] Nenhum briefing que você escreveu contém adjetivo motivacional.
