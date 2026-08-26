# Roteiro literal do questionário (fase 1)

Referência da skill `forge-visual`. Aqui está o texto das perguntas, o que fazer com resposta
inútil, e como cada resposta vira campo do `VisualBrief`.

## Regras de condução

- **Três rodadas, no máximo.** Rodada 1 fecha a direção (4 perguntas); rodada 2 fecha o contorno
  (3 perguntas), já adaptada ao que veio na 1; rodada 3 fecha o que o usuário traz e o que ainda
  falta perguntar (3 perguntas), e termina no campo aberto do roteiro (P10).
- **Toda pergunta oferece opções nomeadas.** A opção livre existe (`outra: ___`), mas nunca é a
  primeira coisa que o usuário lê — quem não é designer responde o que consegue reconhecer, não o
  que consegue formular.
- **Mostre a consequência junto da opção** quando ela tiver custo. O usuário só decide "com 3D" de
  verdade se souber que isso soma ~124 KB no primeiro quadro e ~700 KB de asset depois.
- **Não interprete resposta ambígua — reformule a pergunta.** Ver "Respostas não utilizáveis".
- Depois de cada rodada, devolva em uma frase o que você entendeu, antes de perguntar mais.
- **A ordem não é arbitrária: o campo aberto é o último item do roteiro (P10) e nunca sobe.**
  Perguntar em aberto a quem não é designer devolve "moderno" (§5.1 do `VISAO.md`); depois de
  P1–P9 a pessoa já tem o vocabulário das escolhas que fez, e o texto dela vira precisão.

---

## Rodada 1 — a direção

### P1 · Tema (→ `subject`)
> **Do que é o site, em uma frase?** Ex.: "portfólio de um fotógrafo de arquitetura", "lançamento
> de um sintetizador", "página de um festival de cinema".

Única pergunta aberta antes de P10, e é curta de propósito. Se vier longo, reduza a uma frase e
confirme.

### P2 · Temperatura (→ `temperature`)
> **Qual das duas está mais perto do que você imagina?**
> **(a) Futurista** — a página parece uma máquina: superfície, luz, profundidade, coisas que
> reagem ao cursor.
> **(b) Pé no chão** — a página parece um impresso bem feito: papel, tinta, tipografia grande,
> silêncio.
> **(c) Uma no fundo e outra no conteúdo** — diga qual fica onde.

Não existe "meio-termo" como opção. O meio-termo **é literalmente a média** — o lugar de onde esta
ferramenta existe para escapar.

### P3 · Densidade de efeito (→ `effectDensity`)
> **Quando a pessoa abre e não mexe em nada, o que acontece na tela?**
> **(a) Alta** — algo está sempre em movimento; o site parece ligado.
> **(b) Média** — parado até a pessoa rolar ou passar o mouse; aí reage forte.
> **(c) Contida** — quase nada se mexe; o impacto vem da imagem parada e do que aparece ao rolar.

Se o usuário responder "alta" e depois marcar "odeio site que cansa" em P6, avise a contradição e
peça para escolher — não resolva por média.

### P4 · 3D (→ `use3D`)
> **O site tem objeto tridimensional, ou o impacto vem de tipografia, layout e movimento?**
> **(a) Com 3D** — um objeto/cena que gira, é iluminado, reage. Custo real: ~124 KB antes do
> primeiro quadro, mais o asset (de ~700 KB para uma nuvem de pontos a ~1,4 MB para um mapa de
> relevo em alta). Carrega mais devagar; impressiona mais parado.
> **(b) Sem 3D** — WebGL pode existir agindo sobre o texto e a imagem (tinta, relevo, distorção),
> mas não há objeto. Bem mais leve.
> **(c) 3D só numa parte** — diga qual.

Os números acima são **medidos** neste projeto (three core tree-shaken em gzip; nuvem de 45k
pontos quantizada; par depth+albedo 3200×1800). Cite-os, não arredonde para cima "por segurança" —
inflar o custo empurra o usuário para a opção pobre.

---

## Rodada 2 — o contorno

### P5 · Paleta (→ `palette`)
> **Cor:**
> **(a) Escura** — fundo quase preto, um acento.
> **(b) Clara** — fundo papel, tinta escura.
> **(c) Neon sobre escuro** — dois ou três acentos saturados.
> **(d) Monocromática** — uma cor só, em várias intensidades.
> **(e) Decido vendo as amostras** — cada uma vem numa faixa de luminosidade diferente.

A opção (e) é legítima e barata: a fase 2 já obriga as `variantCount` variantes a ocuparem faixas
de luminância distintas, então o usuário decide olhando.

### P6 · Referências (→ `loves`, `hates`)

Duas perguntas, e **a segunda vale mais**.

> **(1) Manda 1–3 sites que você acha bons.** Link, ou o nome — vale "aquele do relógio que gira".

> **(2) Marca tudo que te dá preguiça quando você vê num site:**
> - [ ] hero centralizado com título, subtítulo e dois botões
> - [ ] gradiente roxo→azul / roxo→rosa, ou fundo "aurora"
> - [ ] card de vidro (glassmorphism)
> - [ ] grid de três colunas de features com ícone em círculo
> - [ ] tudo entrando com o mesmo fade-up ao aparecer na tela
> - [ ] cursor que vira bolinha e persegue o mouse
> - [ ] scroll suave que atrasa a rolagem
> - [ ] site que demora para carregar
> - [ ] animação que não para nunca
> - [ ] letra pequena, texto cinza claro
> - [ ] outro: ___
>
> **E: tem algum site que você acha feio? Manda o link.**

O menu existe porque "o que você odeia" é difícil de produzir do zero e trivial de reconhecer. Os
itens do menu são traços da média, não gosto pessoal do autor da ferramenta.

### P7 · Público e uso (→ `audience`)
> **Quem abre esse site, e vindo de onde?**
> **(a) Portfólio/estúdio** — a pessoa veio ver o trabalho; aceita esperar alguns segundos.
> **(b) Lançamento/campanha/evento** — chega por link e anúncio; parte do tráfego é celular.
> **(c) Produto/SaaS com conversão** — cada segundo de espera custa cliente.
> **(d) Conteúdo/documentação** — a pessoa vem ler.

Esta resposta é a **base do orçamento** (ver `orcamento.md`). É a única pergunta cuja resposta
vira número direto, então não a pule mesmo que pareça óbvia.

---

## Rodada 3 — o que você traz, e quantas amostras

Só existe depois que P1–P7 fecharam. **Nesta ordem: P8, P9, P10 — e P10 é o fim do roteiro.**

### P8 · Anexos (→ `assets[]`)

> **Você tem algum arquivo seu para entrar no site?** Pode marcar mais de um, e pode listar mais
> de um arquivo por tipo.
> **(a) Modelo 3D** — `.stl`, `.obj`, `.glb`
> **(b) Imagem** — `.png`, `.jpg`, `.webp` (foto, textura, mapa de relevo)
> **(c) Fonte** — `.woff2`
> **(d) Nenhum** — o site é construído só com o que a ferramenta gera.

Um arquivo trazido pelo usuário é uma das entradas mais valiosas do brief, e a que nenhum gerador
consegue inventar: **asset próprio** é um dos cinco fatores da §3.1 do `VISAO.md`. Faça a pergunta
mesmo quando `use3D === false` — textura e fonte próprias contam. Resposta (d) → `assets: []`, e
está encerrado: não insista.

**Para cada arquivo, quatro campos, nenhum opcional:**

> 1. **Caminho** do arquivo nesta máquina.
> 2. **Tipo** — modelo 3D, imagem, fonte, outro.
> 3. **De onde veio** — você mesmo fez? baixou de onde, de que autor?
> 4. **Licença** — o que ela permite, e **qual crédito ela exige**.

**Por que a licença é perguntada** — texto para o usuário, não pule:

> Não é papelada. Quando a licença exige crédito, o crédito **é renderizado como link real no
> site**, numa região que nenhuma reorganização de seção pode apagar — publicar o arquivo sem o
> crédito é publicá-lo sem o direito de usá-lo. E o arquivo original **não entra no repositório do
> site**: só o derivado processado entra, então saber a origem é o que permite usá-lo assim.

Precedente medido: a malha do crânio do protótipo 01 é CC BY 4.0 de `martinjario` — o `.stl` fonte
vive fora do repositório e o crédito é um `<a>` real no colofão.

**O que registrar, por situação:**

| O usuário disse | `origin` | `license` | `attribution` |
|---|---|---|---|
| "eu mesmo fiz / é meu" | `próprio` | `próprio` | `null` |
| baixou, licença exige crédito | autor + URL de onde veio | a licença nomeada (ex.: `CC BY 4.0`) | o texto exato do crédito + URL |
| baixou, licença sem exigência | autor/site | ex.: `CC0`, `domínio público` | `null` |
| comprou | vendedor + URL | a licença comercial nomeada | o que ela exigir, ou `null` |
| não sabe de onde veio, ou não sabe a licença | o que ele souber, literal | `desconhecida` | `null` |

A última linha tem consequência: `license: "desconhecida"` **fica registrado e é levado ao dono
antes da fase 4**. Asset de origem desconhecida não entra em site publicado sem decisão explícita
dele. Não decida no lugar dele, e não descarte o arquivo em silêncio.

**Formato fora da lista** → `kind: 'other'`. Diga na hora que não há pipeline de ingestão para ele
nesta versão: ele fica registrado no brief e **não é processado**.

**Peso.** Cada anexo entra no `budget` com `estimatedKb` — o peso **depois do processamento**,
nunca o tamanho do arquivo em disco (o arquivo fonte de ~20 MB do protótipo virou 670 KB). Tabela por tipo
em [`orcamento.md`](orcamento.md). Quando não dá para estimar antes de processar, `estimatedKb`
é `null` e o `rationale` diz qual parcela ficou em aberto — **não invente número**.

**O anexo vale para todas as variantes da fase 2.** Dar o modelo a uma só seria vantagem
arbitrária, e a escolha do usuário deixaria de ser sobre direção visual.

### P9 · Quantas amostras (→ `variantCount`)

> **A próxima fase constrói amostras do hero — páginas que rodam de verdade, medidas antes de
> chegarem a você, não descrições de como seriam — e você mata as que não quiser. Quantas eu
> construo?**
> **(a) 2** — o mínimo.
> **(b) 3** — o padrão.
> **(c) 4**
> **(d) 5** — só aparece quando o site tem 3D.
>
> **O custo é linear e é seu:** cada amostra é um hero construído por um subagente próprio, com
> medição e correção antes de te ser mostrado. 5 amostras custam ~5× o tempo e os tokens de 1. As
> conferências de colisão entre elas crescem por par: 2 amostras → 1 par, 3 → 3 pares, 5 → 10.

Regras de condução:

- **1 não é opção, e quem pedir 1 ouve o motivo:** com uma amostra só não existe rejeição, e a
  rejeição é o mecanismo pelo qual esta ferramenta sai da média (P3, e o risco existencial da §10
  do `VISAO.md`). Uma amostra é "o agente entregou a primeira ideia plausível" — exatamente o que
  o projeto existe para evitar. Se o usuário insistir, registre **2** e diga que registrou 2.
- **Teto = número de âncoras disponíveis.** Cada variante precisa de uma âncora distinta e
  obrigatória (luz, material, tipografia, movimento, espaço); duas variantes com a mesma âncora
  convergem de volta, que é o defeito que a fase 2 existe para evitar. São **5** âncoras — e com
  `use3D === false` a âncora **luz** sai (luz sem objeto tem pouco a iluminar), então o teto cai
  para **4**. A regra de elegibilidade das âncoras está em
  [`divergencia.md`](divergencia.md) §1.
- **Ofereça só as opções até o teto** — com `use3D === false`, (d) não é listada. Pedido acima do
  teto: diga o teto e o motivo, e registre o teto.
- **Sem resposta, "tanto faz" ou silêncio → 3**, declarado como assunção.
- Consequência de escolher 2, dita antes: a segunda pergunta da fase 2 ("o que sobrevive das
  perdedoras?") passa a ter **uma** perdedora só. No protótipo 01, duas técnicas de variantes
  rejeitadas viraram seções inteiras do site final.

`variantCount` é inteiro, 2..5.

### P10 · Campo livre (→ `freeForm`) — **a última pergunta do roteiro, sempre**

> **Antes de eu montar o brief: tem alguma ideia, imagem na cabeça, referência ou pedido que não
> coube nas perguntas acima? Escreva do jeito que vier — vai inteiro, do jeito que você escrever,
> para quem constrói.** Se não tiver, "nada" é resposta válida.

Quatro regras:

1. **Vem por último, nunca antes.** Abrir o questionário com campo livre reintroduz exatamente o
   problema que o roteiro de escolhas resolve.
2. **Chega literal.** O texto vai inteiro, sem reescrita, sem resumo e sem tradução para "linguagem
   de designer", aos briefings das fases 2 e 4 — o mesmo tratamento que `hates.md` recebe. Se você
   resumir, perde justamente a parte que o usuário escreveu porque não cabia num menu.
3. **Rejeição escrita aqui também vira check.** "não quero nada girando" fica literal no `freeForm`
   **e** entra em `hates` com o check correspondente (tabela abaixo). Duplicar é barato; perder a
   rejeição é caro.
4. **Ele não reabre os eixos.** Se o texto contradiz uma escolha de P1–P9 ("marquei pé no chão, mas
   queria algo tipo Blade Runner"), aponte a contradição e peça para escolher **uma** — não some as
   duas nem resolva pela média.

Sem resposta → `freeForm: ''`. Nunca preencha com o seu resumo das respostas anteriores: um campo
livre escrito por você entra nos briefings da fase 4 como se fosse voz do usuário.

---

## Respostas não utilizáveis — e o que fazer

Não registre nenhuma destas no brief. Reformule.

| O usuário respondeu | O que fazer |
|---|---|
| "moderno", "clean", "bonito", "profissional", "premium" | Devolva duas opções concretas do eixo em questão e peça uma. Ex.: *"'moderno' pode ser as duas coisas: fundo quase preto com luz reagindo ao cursor, ou papel branco com tipografia enorme. Qual das duas?"* |
| "sei lá", "você que sabe", "tanto faz" | **Não escolha o meio.** Escolha o extremo **mais distante do `hates`** e declare: *"então assumi (a), porque você marcou que odeia X e (b) tende a X. Se estiver errado, me diga agora."* |
| "quero que impressione" | É critério, não direção. Registre como critério e reformule o eixo. |
| "igual ao site X" | Pergunte **o que** no site X — a cor, o movimento, a letra ou o objeto. Copiar o conjunto é média com um passo a mais. |
| Silêncio / resposta vazia | Ofereça o padrão do eixo **explicitando que é assunção** e siga; nunca deixe o campo vazio no brief. |

⚠️ **Esta tabela vale de P1 a P9.** P10 é a exceção deliberada do roteiro: o campo livre é aberto
por desenho, e vaguidão nele não é defeito — ele já não decide eixo nenhum, porque os eixos foram
fechados antes. Só a **contradição** com um eixo já fechado é reaberta (regra 4 de P10).

Duas respostas vazias são legítimas e explícitas, e não devem ser "preenchidas por segurança":
`assets: []` (o usuário não tem arquivo) e `freeForm: ''` (não tinha nada a acrescentar).

## Traduzir `hates` em check verificável

Todo item de `hates` vira uma linha de `.forge-visual/hates.md`, no formato `rejeição → check`.
Se você não consegue escrever o check, a rejeição ainda não é utilizável: pergunte de novo.

| Rejeição | Check |
|---|---|
| hero centralizado com dois botões | eixo de layout ≠ `centrado` em todas as variantes; nenhum par de botões primário+outline no hero |
| gradiente roxo / aurora | nenhum token com hue 250–300; nenhum `linear-gradient` de tela cheia no fundo do hero |
| card de vidro | nenhum `backdrop-filter: blur` |
| grid de 3 colunas de features | nenhuma seção com 3 colunas iguais + ícone em círculo |
| fade-up genérico | nenhuma animação de entrada repetida em mais de 2 tipos de elemento distintos |
| cursor bolinha | `cursor` fica no valor nativo; nenhum elemento seguindo o ponteiro por `transform` |
| scroll suave | sem Lenis/Motion/scroll-behavior por JS; a rolagem é a do navegador |
| site lento | `criticalKb` ≤ 150 e primeiro quadro pintado sem esperar WebGL |
| animação que não para | `effectDensity` ≠ `alta`; nenhuma animação infinita fora de reduced-motion |
| letra pequena / cinza | corpo ≥ 18px; contraste ≥ 7:1 (já é portão) |
| "parece template" | ⚠️ **não é check** — reabra com o menu de traços acima até virar item concreto |

Conflito `loves` × `hates`: **`hates` vence**, e a decisão fica escrita em `direcao.md`.
