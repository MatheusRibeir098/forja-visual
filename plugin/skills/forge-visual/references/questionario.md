# Roteiro literal do questionário (fase 1)

Referência da skill `forge-visual`. Aqui está o texto das perguntas, o que fazer com resposta
inútil, e como cada resposta vira campo do `VisualBrief`.

## Regras de condução

- **Duas rodadas, no máximo.** Rodada 1 fecha a direção (4 perguntas); rodada 2 fecha o contorno
  (3 perguntas), já adaptada ao que veio na 1.
- **Toda pergunta oferece opções nomeadas.** A opção livre existe (`outra: ___`), mas nunca é a
  primeira coisa que o usuário lê — quem não é designer responde o que consegue reconhecer, não o
  que consegue formular.
- **Mostre a consequência junto da opção** quando ela tiver custo. O usuário só decide "com 3D" de
  verdade se souber que isso soma ~124 KB no primeiro quadro e ~700 KB de asset depois.
- **Não interprete resposta ambígua — reformule a pergunta.** Ver "Respostas não utilizáveis".
- Depois de cada rodada, devolva em uma frase o que você entendeu, antes de perguntar mais.

---

## Rodada 1 — a direção

### P1 · Tema (→ `subject`)
> **Do que é o site, em uma frase?** Ex.: "portfólio de um fotógrafo de arquitetura", "lançamento
> de um sintetizador", "página de um festival de cinema".

Única pergunta aberta do roteiro, e é curta de propósito. Se vier longo, reduza a uma frase e
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
> **(e) Decido vendo as amostras** — as três vêm em faixas de luminosidade diferentes.

A opção (e) é legítima e barata: a fase 2 já obriga as três variantes a ocuparem faixas de
luminância distintas, então o usuário decide olhando.

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

## Respostas não utilizáveis — e o que fazer

Não registre nenhuma destas no brief. Reformule.

| O usuário respondeu | O que fazer |
|---|---|
| "moderno", "clean", "bonito", "profissional", "premium" | Devolva duas opções concretas do eixo em questão e peça uma. Ex.: *"'moderno' pode ser as duas coisas: fundo quase preto com luz reagindo ao cursor, ou papel branco com tipografia enorme. Qual das duas?"* |
| "sei lá", "você que sabe", "tanto faz" | **Não escolha o meio.** Escolha o extremo **mais distante do `hates`** e declare: *"então assumi (a), porque você marcou que odeia X e (b) tende a X. Se estiver errado, me diga agora."* |
| "quero que impressione" | É critério, não direção. Registre como critério e reformule o eixo. |
| "igual ao site X" | Pergunte **o que** no site X — a cor, o movimento, a letra ou o objeto. Copiar o conjunto é média com um passo a mais. |
| Silêncio / resposta vazia | Ofereça o padrão do eixo **explicitando que é assunção** e siga; nunca deixe o campo vazio no brief. |

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
