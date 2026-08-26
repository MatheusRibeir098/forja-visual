# 🔨 Forja Visual

**Um plugin do Claude Code que constrói sites de alto impacto visual — sem cara de IA.**

Você responde algumas perguntas sobre a direção visual que quer. Ele constrói **três variantes de
verdade**, você escolhe olhando elas rodarem, e só então o site inteiro é construído — com
medição reprovando o que não atinge o nível.

```
/forge-visual
```

---

## Por que isso existe

A pesquisa que originou o projeto achou o diagnóstico em uma frase:

> *A IA prevê o design mais provável, e o mais provável é a média de tudo em que ela treinou. Não
> está copiando um site — está tirando a média de todos. E a média é, por definição, a opção menos
> distintiva possível.*

Não falta biblioteca — elas estão todas aí, de graça. O que existe é um caminho de menor
resistência que desemboca sempre no mesmo hero + gradiente roxo + grid de três colunas + Inter.

**A ironia central:** as bibliotecas de componentes prontos (React Bits, Aceternity, Magic UI) são
a principal *fonte* dessa cara genérica, não a cura. Um Aurora Background é reconhecível à primeira
vista porque está em dez mil sites.

**A consequência para o desenho da ferramenta:** o que tira da média é **restrição e rejeição**,
não incentivo. Nenhuma skill aqui pede "seja criativo" — pedir isso produz a média com adjetivos.
Toda exigência é verificável, e o build reprova quando não é atendida.

---

## Para quem vai desenvolver o plugin

Se você chegou para **mexer na ferramenta** (não para usá-la), comece por
**[`HANDOFF.md`](HANDOFF.md)** — ele diz onde o projeto está, o que não pode ser quebrado, onde
achar cada informação e as armadilhas que já custaram retrabalho.

---

## Instalação

Precisa do [Claude Code](https://claude.com/claude-code) instalado. Dentro dele, rode:

```
/plugin marketplace add MatheusRibeir098/forja-visual
/plugin install forge-visual@forja-visual
```

Pronto. O `/forge-visual` passa a existir em **qualquer projeto seu** — inclusive numa pasta vazia,
que é o caso de uso principal: criar um site do zero.

Para conferir o que está instalado, ou desinstalar depois: `/plugin`.

<details>
<summary><b>Instalar a partir de um clone local</b> (para editar o plugin)</summary>

```bash
git clone https://github.com/MatheusRibeir098/forja-visual.git
```

E no Claude Code, apontando para a pasta clonada:

```
/plugin marketplace add /caminho/para/forja-visual
/plugin install forge-visual@forja-visual
```

Assim você edita as skills e recarrega sem passar por `git push`.
</details>

### O que o site gerado precisa

Nada além do que o plugin já traz. O projeto nasce de um template com o motor pronto, e as
dependências (`three`, `vite`, `playwright-core`, `tsx`) vêm declaradas. Você só precisa de
**Node.js** e **pnpm**.

A medição de FPS roda num Chrome de verdade, com GPU real. Em máquina sem GPU acessível, o medidor
**aborta** em vez de reportar número inválido — medição em SwiftShader não é medição.

---

## Como funciona

```
1. QUESTIONÁRIO   →  o que você quer, em escolhas concretas
2. DIVERGÊNCIA    →  N variantes construídas de verdade, você mata as outras
3. TÉCNICA        →  quais mecanismos entregam aquela direção
4. CONSTRUÇÃO     →  subagentes em paralelo, arquivos disjuntos
5. MEDIÇÃO        →  estrutura, contraste e FPS reprovam o build
```

### 1. O questionário

Perguntas de **escolha entre opções concretas**, nunca abertas — e essa é a parte menos óbvia do
projeto. Perguntar *"que estética você quer?"* a quem não é designer devolve "moderno", ou
silêncio. Perguntar *"futurista ou pé no chão?"*, *"muito efeito ou contido?"*, *"com 3D ou sem?"*
devolve resposta utilizável.

Os eixos: tema, temperatura, densidade de efeito, 3D, paleta, referências que você admira — e **o
que você odeia**, que pesa mais que o resto e vira checagem verificável nos briefings.

No fim ele pergunta mais três coisas:

- **quantas variantes construir** (2 a 5, padrão 3) — cada uma é um hero construído de verdade,
  então você decide quanto quer gastar de tempo em exploração
- **um campo livre**, deliberadamente aberto — e ele vem **por último**, nunca antes: depois de
  escolher, você já tem o vocabulário, e o texto vira precisão em vez de "moderno"
- **seus arquivos** — modelo 3D, textura, foto, fonte

### Os anexos merecem um parágrafo

Trazer o próprio arquivo é o caminho mais curto para um site que não parece de IA, e o motivo está
na pesquisa: **asset próprio** é um dos cinco fatores que fizeram o portfólio de referência escapar
da média. É o que nenhum gerador consegue inventar.

O plugin processa `.stl`, `.obj`, `.glb` e `.png` em **build time**, de forma determinística — o
mesmo arquivo produz sempre o mesmo derivado. E pergunta a **origem e a licença** de cada um, o que
não é papelada: quando a licença exige crédito, ele é renderizado como link real e um portão
reprova o build se esse crédito sumir, for escondido ou ficar dentro de uma seção que alguém possa
cortar depois.

O **orçamento de bytes é derivado das suas respostas**, nunca fixado antes. Isso não é detalhe: no
protótipo que originou a ferramenta, um teto arbitrário definido no início produziu relevo em meia
resolução e pós-processamento banido — um site que passava em todas as métricas e não impressionava
ninguém.

### 2. A divergência — o coração da coisa

As variantes de hero são **construídas e rodando**, nunca descritas em texto. Você escolhe em dois
níveis: a vencedora, **e quais características das perdedoras sobrevivem**.

Isso não é cortesia. No protótipo 01, duas técnicas de variantes rejeitadas viraram seções inteiras
do site final.

**E a divergência é mecânica, não pedida.** Um agente instruído a "gerar 3 direções diferentes"
converge sozinho — foi exatamente o que aconteceu no protótipo, onde as três variantes saíram da
mesma família visual e ninguém percebeu até o site estar pronto. Aqui:

- cada variante nasce em **contexto limpo**, sem ver as irmãs
- cada uma recebe um **ancoradouro obrigatório distinto** — luz, material, tipografia…
- cada uma é **proibida de reusar as técnicas** que as outras escolheram
- e os números que decidem se elas realmente divergiram são **medidos do pixel**, não declarados
  por quem as construiu

O teto de variantes não é arbitrário: cada uma precisa de uma âncora distinta, então o limite é
quantas âncoras existem. Pedir "sem 3D" derruba o teto para 4, porque a âncora *luz* deixa de fazer
sentido sem objeto tridimensional.

### 3–5. Técnica, construção e medição

As técnicas são escolhidas de um catálogo indexado **por problema** ("preciso que a transição não
seja um crossfade genérico"), não por nome. A construção roda em subagentes paralelos com arquivos
disjuntos. E a medição é portão, não relatório:

| Portão | Critério | |
|---|---|---|
| Contraste | ≥ 7:1, medido **por pixel**, ao longo de **toda a animação** | reprova |
| FPS | mediana ≥ 60 em GPU real | reprova |
| Estrutura | seção é pasta, texto é conteúdo, gerado é gerado | reprova |
| Crédito de licença | link real, fora de qualquer seção | reprova |
| Bytes | contra o orçamento do brief | informa |
| build · typecheck · lint · test | verde | reprova |

**"Ao longo de toda a animação" custou caro para entrar aí.** O medidor antes congelava a página e
fotografava uma pose — e aprovava com 15,77:1 uma página que ficava com 1,13:1 em outro instante do
mesmo ciclo. Contraste é propriedade da faixa inteira, não de um instante.

---

## O que tem dentro

```
plugin/
├── skills/
│   ├── forge-visual/       o questionário e a condução das 5 fases
│   ├── visual-techniques/  16 técnicas indexadas por problema
│   └── visual-guardrails/  as proibições, cada uma com o motivo
├── agents/                 visual-dev, visual-tester
├── scripts/                medidores + ingestão de assets + portões
└── templates/site/         o motor pronto: engine, shaders, 40 testes
```

E o site que ele gera **nasce organizado** — uma pasta por seção, texto separado do código,
arquivos gerados isolados:

```
src/
├── engine/            o motor (vem pronto, não se edita)
├── shaders/           um arquivo por técnica
├── styles/            o global — nada de seção aqui
├── content/           o TEXTO, separado da apresentação
├── sections/<nome>/   index · style · scene · markup
└── generated/         produzido por script, nunca à mão
dev/<nome>.html        página isolada, para inspecionar uma técnica de cada vez
```

Isso não é preferência estética: é o que **torna o paralelismo possível**. A regra da construção é
arquivos disjuntos — dois devs no mesmo arquivo e o segundo sobrescreve o primeiro. Uma seção por
pasta garante isso sem negociação. E um portão reprova quem sai do lugar, porque regra sem
verificação é conselho, e conselho é ignorado quando aperta.

O **template** é o que garante que a qualidade não dependa de sorte: todo site nasce com o mesmo
motor já provado — um único `requestAnimationFrame`, tier por números, beats de scroll, FBO de
página e passe de grade próprio. O que muda entre um site editorial e um cyberpunk são os shaders e
a paleta, não a infraestrutura.

A paleta do template é **magenta e ciano gritantes**, de propósito: enquanto o brief não entrar com
as cores reais, o medidor de contraste reprova. O template não deixa você esquecer de decidir.

---

## A prova — o projeto irmão

**[forja-visual.vercel.app](https://forja-visual.vercel.app)** — uma página única que explica por
que sites de IA parecem iguais e desmente a tese sendo o contrário disso. Foi construída com esse
método, à mão, antes da ferramenta existir.

Ela vive em **repositório próprio**,
[`forja-visual-site`](https://github.com/MatheusRibeir098/forja-visual-site), e evolui junto com o
plugin: é o exemplo vivo do nível que a ferramenta precisa alcançar, não uma pasta de demonstração
congelada.

Números medidos, não estimados:

| | |
|---|---|
| Contraste mínimo | **7,93 : 1** (piso 7) |
| FPS | **59,9** mediana, desktop e mobile |
| Técnicas do catálogo em uso | **11** |
| Testes | **72** |

Ela abre com uma caricatura deliberada do "site médio de IA" — gradiente roxo, cards de vidro, dois
botões — que é destruída por um campo de limalha magnética nos primeiros segundos. É a tese sendo
mostrada em vez de afirmada.

**[`research/`](research/)** — de onde tudo saiu: o [catálogo de 16
técnicas](research/catalogo-tecnicas.md) em formato `Problema → Mecanismo → Custo → Quando NÃO
usar`, e o [panorama de ferramentas](research/arsenal-visual.md) com a coluna que mais importa:
*quando não usar*.

**[`VISAO.md`](VISAO.md)** — o projeto por inteiro: problema, princípios, arquitetura, decisões e
riscos.

---

## Uma decisão que você precisa saber antes de instalar

**Os sites gerados ignoram `prefers-reduced-motion` e animam em qualquer máquina.**

Foi decisão de produto, tomada depois de um site aparecer estático e com o scroll travado para uma
pessoa que tinha desligado efeitos de animação no Windows. A maioria dos sites simplesmente não
implementa essa preferência; este passou a fazer o mesmo.

O custo é real e não vale esconder: quem desliga animações por distúrbio vestibular — enjoo,
tontura — verá movimento. Na prática isso significa que **o plugin não entrega conformidade WCAG
2.2 AA completa**, ainda que exija contraste de 7:1, mais rigoroso que o próprio AA pede.

Está em um lugar só, comentado, se você quiser reverter no seu site.

---

## Estado honesto

**O que está provado:** que o nível é alcançável. O protótipo 01 está
[no ar](https://forja-visual.vercel.app), é medido, e não parece gerado.

**O que não está:** que a ferramenta reproduz isso sozinha. O protótipo é N=1 e prova
**qualidade**, não **generalidade** — foi conduzido por um humano e um orquestrador, com julgamento
estético que ainda não está inteiramente codificado.

O teste que responde é rodar `/forge-visual` pedindo algo deliberadamente distante do protótipo
— um cyberpunk, por exemplo — **sem briefings escritos à mão**. Se sair no mesmo nível, a ferramenta
generaliza. Se sair genérico, descobrimos com um teste barato em vez de depois de distribuir.

Se você rodar e algo quebrar, [abra uma issue](https://github.com/MatheusRibeir098/forja-visual/issues)
dizendo em que fase parou.

---

*Pesquisa de agosto/2026. Código próprio; fontes sob SIL OFL 1.1. A malha do crânio usada no
protótipo é CC BY 4.0 de `martinjario`.*
