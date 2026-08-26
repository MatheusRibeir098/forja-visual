# Backlog — plugin `forge-visual`

Anotações do uso real. Itens **1**, **1b** e **2** foram implementados em 2026-08-25 — ficam
registrados abaixo com o que de fato foi entregue, porque o raciocínio continua valendo para quem
for mexer neles depois.

Ordem não é prioridade — decidir junto com o dono quando for implementar.

---

## 1. ✅ FEITO — Perguntar quantas variantes construir

**Origem:** dono, 2026-08-25, testando o plugin pela primeira vez.
*"Talvez seria legal ele perguntar quantos 'modelos' o usuário quer que ele crie antes do principal
para validação — sei que deixamos como padrão 3."*

Hoje o número é fixo em **3**, decidido antes de a ferramenta existir. Vira pergunta do
questionário (fase 1), com o padrão em 3.

**Dois limites a respeitar quando for implementar:**

- **Piso de 2.** Com uma variante só não existe rejeição — e a rejeição é o coração da ferramenta.
  Uma variante seria "o agente entrega a primeira ideia plausível", exatamente o que o projeto
  existe para evitar (P3, e o risco existencial da §10 do `VISAO.md`).
- **Teto ligado às âncoras.** Cada variante precisa de um **ancoradouro distinto e obrigatório**
  (luz, material, tipografia, movimento, espaço). Mais variantes que âncoras = duas com a mesma
  âncora = convergência de volta. Se quisermos permitir mais, primeiro é preciso ampliar a lista de
  âncoras — e ela não pode crescer por conveniência, cada âncora tem de ser um eixo de ataque
  genuinamente diferente.

**Vale mostrar o custo na própria pergunta:** cada variante é um hero construído de verdade por um
subagente, então N variantes custam N× tempo e tokens. Quem escolhe precisa saber disso.

**Entregue:** pergunta P9 do questionário, padrão 3, recusando 1 com o motivo. E uma consequência
que não estava prevista: **o teto cai para 4 quando `use3D` é falso**, porque a âncora *luz* deixa
de ser elegível sem objeto tridimensional.

O `divergencia.md` foi generalizado para N: âncoras filtradas por elegibilidade, teto efetivo
calculado do menor entre âncoras/classes tipográficas/eixos de layout, bandas de luminância para
N=2..5, e os checks reescritos em termos de **pares** (P = N(N−1)/2). O veredito passou de "contar
checks falhos" para "menor conjunto de variantes que zera as colisões" — com N=3, um par que falha
em dois checks agora re-briefa **uma** variante, em vez de refazer as três.

**Recomendação registrada: não ampliar a lista de âncoras.** Elas não são o gargalo — com N=5 as
classes tipográficas e os eixos de layout já ficam esgotados, e um `hates` contra layout centrado
derruba o teto para 4. A ordem correta, se um dia quisermos N=6, é ampliar eixos de layout e
classes tipográficas, depois o catálogo, e só então discutir a sexta âncora.

**Defeito corrigido de quebra:** o check de movimento rodava **sempre**, mesmo quando a âncora
*movimento* não estava entre as escolhidas (o que acontece com `effectDensity: contida`). Ele
cobrava do conjunto algo que a pré-atribuição nunca pediu, e falharia sistematicamente. Agora só é
exigido quando movimento está em jogo.

---

## 1b. ✅ FEITO — Campo livre + anexos na última rodada de perguntas

**Origem:** dono, 2026-08-25, testando o plugin.
*"Acho que a última rodada de perguntas deveria ser um campo livre para ideias — onde o usuário
pode escrever livremente uma ideia, uma sugestão ou pedido a mais, e uma parte onde ele pode anexar
arquivos para ser usados, como modelo 3D ou imagens."*

Duas coisas, e a segunda é mais importante do que parece.

### O campo livre

Vai **no fim**, nunca no começo. A ordem importa: o questionário é de escolhas concretas justamente
porque perguntar "que estética você quer?" a quem não é designer devolve "moderno" (§5.1 do
`VISAO.md`). Abrir com campo livre reintroduz o problema que o questionário resolve. Depois das
escolhas, a pessoa já tem vocabulário — e aí o texto livre vira precisão, não vaguidão.

O conteúdo dele deve chegar **literal** aos briefings das fases 2 e 4, como já acontece com o campo
`hates`.

### Os anexos — o ponto forte

Isto ataca diretamente um dos **cinco fatores** que, segundo a §3.1 do `VISAO.md`, fizeram o
portfólio de referência escapar da média:

> **Asset próprio** — um `.obj` processado por pipeline próprio, não preset de biblioteca.

Hoje a ferramenta não tem como receber um asset do usuário. Quem trouxer o próprio modelo 3D, a
própria textura ou a própria foto está trazendo exatamente aquilo que nenhum gerador consegue
inventar — e é o caminho mais curto para um site que não parece de IA.

**O que precisa ser resolvido antes de implementar:**

- **Formatos:** 3D (`.stl`, `.obj`, `.glb`), imagem (`.png`, `.jpg`, `.webp`), fonte (`.woff2`).
- **Pipeline de build, não de runtime.** O
  [protótipo 01](https://github.com/MatheusRibeir098/forja-visual-site) provou o caminho: o `.stl`
  do crânio virou `Int16` pré-processado por `scripts/build-points.ts`, determinístico (sha256
  estável), sem decode no navegador. Um asset jogado direto no runtime é o oposto disso. O plugin
  precisaria de scripts de ingestão equivalentes.
- **Licença é obrigação real, não formalidade.** A malha do crânio é CC BY 4.0 de `martinjario`: o
  `.stl` fonte vive **fora do repositório** e o crédito é renderizado como `<a>` real no colofão.
  O questionário tem de perguntar **origem e licença** de cada anexo, e a ferramenta tem de
  garantir que o crédito sobreviva ao corte de qualquer seção.
- **Peso entra no orçamento.** O `budget` é derivado das respostas (§5 da `PLUGIN-SPEC.md`); um
  modelo 3D do usuário muda a conta e precisa entrar nela, não ser descoberto depois.
- **Efeito na divergência:** um asset trazido pelo usuário provavelmente deve estar disponível para
  **todas** as variantes, senão vira vantagem arbitrária de uma delas. Decidir.

**Arquivos que mudam:** `skills/forge-visual/references/questionario.md`, `references/orcamento.md`,
`SKILL.md` (fase 1 e fase 2), o tipo `VisualBrief` na `PLUGIN-SPEC.md` §5 — **e mexer no
`VisualBrief` é mexer no contrato congelado**, que todas as outras partes consomem.

---

## 2. ✅ FEITO — Acentuação da `description` no `plugin.json`

Está sem acentos: *"Constroi sites … questionario de direcao visual … tecnicas … medicao"*.

É o texto que aparece na lista de plugins para **quem instala** — primeira impressão da ferramenta.
O mesmo defeito já foi corrigido no `marketplace.json`; este passou.

**Arquivo:** `plugin/.claude-plugin/plugin.json`.

---

## 3. Bases do orçamento por público — números chutados

O dev que escreveu `references/orcamento.md` foi honesto: as **parcelas de custo** são medidas do
protótipo 01 (three 124 KB, fonte 25 KB, nuvem de 45k ≈ 670 KB, depth 3200×1800 ≈ 1440 KB), mas as
**bases por tipo de público** (1500/900/600/350 KB) e os multiplicadores (1,6/1,0/0,6) são
calibragem dele.

É o único lugar da ferramenta com ordem de grandeza inventada. Revisar com o dono, ou calibrar
depois do primeiro site gerado.

---

## 4. Calibragens que nunca foram testadas em projeto real

Do mesmo dev, sinalizadas como o ponto mais provável de ajuste após o primeiro uso:

- faixas de luminância por sub-banda quando a paleta é travada (ex.: escura → 0,02–0,06 /
  0,08–0,14 / 0,15–0,25)
- o critério de `motionCoverage` (razão ≥ 3×, mais o piso absoluto de 0,05 que foi adicionado
  depois)
- o `--settle` padrão de 2500 ms do `measure-variant` — convenção conservadora, não número medido

---

## 5. `measure-variant`: variação entre execuções

`motionCoverage` de objeto girando varia conforme a fase do movimento (medido: 0,169 numa sessão,
0,321 em outra). Fica abaixo do limite de "inconclusivo" e não afeta a separação
parado × movimentado, mas **duas variantes com movimento parecido podem trocar de ordem entre
execuções**. Mais pares de quadros (`--gaps`) reduz.

Decidir se vale aumentar o padrão de pares ou deixar como está.

---

## 6. Suporte a plataforma nos medidores

`findChromeBinary()` só tem caminhos de **Linux** (mais a variável `CHROME_PATH`). Em macOS e
Windows, os dois portões que reprovam (contraste e FPS) não rodam.

Decisão de escopo: ou a ferramenta é Linux-only por ora e isso fica **escrito no README**, ou
alguém adiciona os caminhos das outras plataformas. Hoje não está escrito em lugar nenhum, que é a
pior das opções.

---

## 7. Texto dentro do canvas escapa da medição

Texto desenhado **dentro** do WebGL não entra no `typeScaleRatio` nem é apagado para a foto de
fundo do medidor de contraste. É proibido pelas guardrails, mas se aparecer, **o medidor não
acusa** — a proibição não tem portão que a verifique.

---

## 8. O teste que responde à pergunta principal

Rodar `/forge-visual` pedindo algo deliberadamente distante do protótipo 01 — **cyberpunk** — e
**sem briefings escritos à mão pelo orquestrador**.

O protótipo é N=1: prova **qualidade**, não **generalidade**. Este teste é o que diz se a
ferramenta reproduz o nível sozinha ou se ele dependia de julgamento humano no meio do caminho.
