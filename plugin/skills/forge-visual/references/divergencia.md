# Divergência executável (fase 2)

Referência da skill `forge-visual`. Este arquivo é o mecanismo, não o conselho: a tabela de
âncoras, a pré-atribuição, a partição do catálogo, o **briefing literal** que cada `visual-dev`
recebe, o objeto que ele devolve, os checks de colisão e o procedimento de re-briefe.

## O defeito que este mecanismo existe para impedir

No protótipo 01, três variantes foram construídas por três subagentes instruídos a "gerar três
direções deliberadamente incompatíveis". **As três saíram da mesma família editorial.** O defeito
não apareceu na hora — apareceu semanas depois, com o site pronto, quando o dono disse *"achei que
seria futurista"*. Um site correto, medido e bem construído no gosto errado continua sendo o gosto
errado, e a rejeição não pôde corrigir porque as três opções eram sabores da mesma coisa.

A causa é mecânica: pedir divergência a um modelo que otimiza plausibilidade produz três pontos
próximos do centro. **Divergência precisa ser atribuída antes e conferida depois** — nunca pedida.

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

### Quais três escolher

- `use3D === false` → escolha 3 entre **{tipografia, material, movimento, espaço}**. Luz sem
  objeto tem pouco a iluminar; fica de fora.
- `use3D === true` → **pelo menos 2** entre **{luz, material, espaço}**; a terceira pode ser
  tipografia ou movimento.
- `effectDensity === 'contida'` → **movimento** só entra se o usuário tiver pedido reação forte a
  scroll/hover em P3; caso contrário troque por **espaço**.
- Nenhuma âncora repetida. Nenhuma variante "mistura duas" — mistura é o caminho de volta ao centro.

---

## 2. Pré-atribuição — antes de disparar qualquer subagente

Preencha esta tabela e cole **a linha da variante** dentro do briefing dela. Os três valores de
cada linha são **obrigatórios**, e os das colunas são **mutuamente distintos**.

| | A | B | C |
|---|---|---|---|
| Âncora | | | |
| Faixa de luminância de fundo (0–1) | | | |
| Classe tipográfica | | | |
| Eixo de layout | | | |
| Pool de técnicas | | | |

**Faixas de luminância** (mediana da luminância relativa do quadro em repouso):

- Padrão, paleta livre: `0,02–0,10` · `0,25–0,45` · `0,70–0,92`.
- Paleta travada em `escura`: `0,02–0,06` · `0,08–0,14` · `0,15–0,25`.
- Paleta travada em `clara`: `0,60–0,70` · `0,75–0,85` · `0,88–0,95`.

Paleta fechada **não** é licença para convergir: as faixas encolhem, as outras duas dimensões
continuam obrigatoriamente distintas.

**Classes tipográficas:** `serifada` · `grotesca` · `mono` · `display` · `condensada` — três valores
diferentes. Fontes proibidas em qualquer variante: Inter, Roboto, Poppins, Montserrat, Space
Grotesk, DM Sans, Manrope, Plus Jakarta.

**Eixos de layout:** `centrado` · `assimetrico-esq` · `assimetrico-dir` · `grade-editorial` ·
`tela-cheia` — três valores diferentes. `centrado` só entra se **nenhum** item de `hates` o
excluir (ele é o traço mais reconhecível da média).

---

## 3. Partição do catálogo

A skill `visual-techniques` é a fonte; os ids abaixo são os do catálogo do projeto (se a skill
renomear, case pelo nome do mecanismo).

**Camada comum a todas** — infraestrutura não diferencia imagem, então não é disputada:
composite rendering / FBO (I.1), sync DOM↔WebGL (I.2), ticker único (I.3), ping-pong FBO (I.4).

**Pools exclusivos**, por âncora:

| Âncora | Pool |
|---|---|
| Luz | reacender 2D com depth map (IV.1), cursor como raio (V.4), fog animado por injeção de shader (II.2) |
| Material | quantização Int16 sem decode (V.5), contorno por inverted hull (II.3), grão/dither e tinta com bleed |
| Tipografia | sync DOM↔WebGL aplicado à letra, máscara de threshold (III.1), SDF de texto |
| Movimento | beats ancorados no DOM (V.2), damping assimétrico (V.3), CSS scroll-driven / ViewTimeline |
| Espaço | depth prepass para nuvem aditiva (V.1), chunking infinito (II.1), x-ray reveal com fluido (III.2) |

Regra no briefing: *"você pode usar as técnicas do seu pool e a camada de infraestrutura. As
técnicas dos outros dois pools estão proibidas nesta variante — outra variante as está usando."*
Liste **nominalmente** as proibidas: proibição genérica não é verificável.

---

## 4. Briefing literal do `visual-dev` de variante

⚠️ **Pré-requisito serial:** o projeto, o `engine` (ticker único + posse do canvas) e a pasta
`dev/` já existem quando este briefing é disparado, e `tsx` + `playwright-core` já estão nas
devDependencies. Os três briefings abaixo assumem isso — se o `engine` não existir, os três
`visual-dev` devolvem `BLOQUEADO` (ou, pior, cada um escreve o seu).

Uma invocação por variante, **as três na mesma mensagem**. Contexto limpo: nenhum subagente vê o
briefing, o código ou o resultado das irmãs. Substitua tudo entre `<>`.

```md
# Variante <A|B|C> do hero — amostra construída para escolha do dono

Você constrói UMA tela. Duas outras variantes estão sendo construídas em paralelo por outros
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

## Sua âncora: <LUZ|MATERIAL|TIPOGRAFIA|MOVIMENTO|ESPAÇO>
<cole a linha da tabela de âncoras: o que carrega a imagem, o que fica subordinado>
A imagem tem que ser explicável por esta âncora. Se a sua tela continuar funcionando ao remover o
que a âncora carrega, você atacou por outro eixo — refaça.

## Valores obrigatórios (não são sugestão; são conferidos por medição no retorno)
- Luminância mediana do quadro em repouso, dentro de: <faixa>
- Classe tipográfica: <classe> (proibidas: Inter, Roboto, Poppins, Montserrat, Space Grotesk,
  DM Sans, Manrope, Plus Jakarta)
- Eixo de layout: <eixo>

## Técnicas
- Permitidas: seu pool <lista> + a camada de infraestrutura <lista>.
- **Proibidas nesta variante** (outra variante as está usando): <lista nominal>.
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
  nessas quatro chaves é descartado e, se a divergência entre as três parecer real só por causa
  dele, a comparação é invalidada — é exatamente o defeito que este mecanismo existe para impedir.
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
Deixar o `visual-dev` calculá-los devolveria três métodos diferentes do mesmo número, no exato
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
ping-pong) é comum às três por desenho e **nunca** caracteriza colisão.

### 5.2 `VariantCard`

```ts
interface VariantCard {
  id: 'A' | 'B' | 'C';
  anchor: 'luz' | 'material' | 'tipografia' | 'movimento' | 'espaco';
  techniques: TecnicaUsada[];  // o MESMO array de `tecnicas_usadas` — não escreva uma segunda versão
  bgLuminance: number;       // 0–1, mediana da luminância relativa do quadro em repouso — medido, §5.3
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
| `contrast` · `fps` | portão de exibição (§7.3): variante fora do piso não vai ao usuário |
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
o destino**; o campo `out` do config é ignorado por este script de propósito, porque as três
variantes rodam contra o mesmo projeto e escreveriam por cima uma da outra no mesmo caminho
default:

```bash
cd <raiz do site>
pnpm exec tsx "${CLAUDE_PLUGIN_ROOT}/scripts/measure-contrast.ts" --project=. --url=<url da variante> --min=7
pnpm exec tsx "${CLAUDE_PLUGIN_ROOT}/scripts/measure-fps.ts"      --project=. --url=<url da variante> --min=60 --runs=3
pnpm exec tsx "${CLAUDE_PLUGIN_ROOT}/scripts/measure-variant.ts" --project=. --url=<url da variante> --id=<A|B|C> \
  --bg-min=<faixa atribuída> --bg-max=<faixa atribuída> \
  --out=.forge-visual/medicoes/variant-<id>.json
```

Quem roda os três é o `visual-tester`, uma vez por variante. `measure-variant.ts` grava
`bgLuminance`, `motionCoverage`, `typeScaleRatio` e `palette` em
`.forge-visual/medicoes/variant-<id>.json` — **um arquivo por variante** — e é dali, não de
declaração de quem construiu, que o orquestrador lê os quatro campos que faltavam no
`variant_card` (§5.2) antes de rodar os checks de colisão da §6.

Códigos de saída de `measure-variant.ts`: `0` dentro da faixa atribuída (`--bg-min`/`--bg-max`) ·
`1` fora da faixa · `2` medição inválida (caiu em SwiftShader) · `3` **inconclusivo** · `4` nada
mensurável. `measure-variant.ts` só confere a variante contra a **própria** faixa — a comparação
entre as três (checks 4, 5 e 6) continua sendo do orquestrador, com os três
`.forge-visual/medicoes/variant-*.json` na mão.

⚠️ **`3` não autoriza cortar efeito.** Ele diz *"a máquina estava disputada ou a falha não se
repetiu"* — a resposta é isolar a máquina e remedir. Cortar um efeito por causa de um `3` é
exatamente o que custou 20 minutos a dois devs no protótipo 01, e a causa era um player de música.

---

## 6. Checks de colisão — rode com os três cards na mão

| # | Check | Critério |
|---|---|---|
| 1 | Técnicas | interseção vazia entre os `techniques` filtrados por `camada === 'pool'`, comparando por `id ?? tecnica` |
| 2 | Tipografia | três `typeClass` distintas |
| 3 | Layout | três `layoutAxis` distintos |
| 4 | Luminância | três `bgLuminance` em faixas distintas, sem sobreposição, cada uma dentro da faixa atribuída |
| 5 | Movimento | `max(motionCoverage) ÷ max(min(motionCoverage), 0,001) ≥ 3` **e** `max(motionCoverage) ≥ 0,05` |
| 6 | Paleta | no máximo 1 token coincide entre qualquer par, onde "coincide" é `\|Δr\| + \|Δg\| + \|Δb\| < 24` |

**Check 5, o porquê da segunda condição:** razão sozinha mente perto de zero. `0,0050` e `0,0166`
dão razão `3,3` — passaria no critério antigo — e as duas páginas estão **praticamente paradas**:
nenhuma chega perto do que um olho chamaria de "página com movimento". Por isso a razão só conta
como divergência satisfeita quando **pelo menos uma** das variantes tem `motionCoverage ≥ 0,05`;
abaixo disso o check **falha** (não satisfeito) mesmo com razão alta — conta no "Veredito" abaixo
como qualquer outro check falho. Isso não é o código `3` (inconclusivo) do medidor: é o critério
do check dizendo que nenhuma das duas variantes tem movimento suficiente para a razão significar
alguma coisa.

**Check 6, o porquê da tolerância:** hex diferente não é cor diferente para quem olha. `#101318` e
`#111419` — tokens de duas páginas propositalmente parecidas — têm `Δ = |1| + |1| + |1| = 3`, bem
abaixo de `24`: são a mesma cor. Comparação por igualdade exata de hex leria "0 tokens coincidem"
e aprovaria a colisão. `24` é a mesma constante que `measure-variant.ts` usa para montar a própria
paleta (`PALETTE_MIN_DISTANCE`, em `scripts/measure-variant.ts`) — dois pontos que ficam a menos
de `24` de distância já contam como o mesmo token ali, e o check reusa o critério em vez de
inventar um segundo.

**Veredito:**

- 0 falhas → mostre ao usuário.
- 1 falha → re-briefe **só** a variante infratora.
- **≥ 2 falhas → as três estão na mesma família.** É o defeito do protótipo 01 acontecendo de
  novo, e desta vez você o pegou antes do site existir. Não mostre nada; re-briefe.

**Quem é re-briefado, sem ambiguidade:**

1. Se alguém violou a pré-atribuição (valor fora da faixa/classe/eixo designado) → é essa.
2. Senão, no par que colidiu, preserve a de letra menor (A antes de B antes de C) e re-briefe a
   outra. Critério determinístico de propósito: escolher "a mais bonita" reintroduz julgamento
   onde o mecanismo existe para removê-lo.

**Como re-briefar:** invocação **nova**, contexto limpo, mesmo template, com (a) o valor
específico que precisa mudar e por quê, (b) a técnica que agora está proibida porque a irmã a
tomou. Não reaproveite o subagente anterior — o histórico dele contém a solução que colidiu, e ele
volta para ela.

**Teto: 2 re-briefes por variante.** Na terceira colisão, o problema é a âncora escolhida (ela não
consegue produzir imagem distinta sob este brief): troque a âncora por outra da tabela e recomece
essa variante. Registre a troca — é informação sobre a ferramenta, não sobre o projeto.

---

## 7. Mostrar e colher a escolha

1. Suba (`pnpm dev`) e entregue **as três URLs** (`/dev/a.html`, `/dev/b.html`, `/dev/c.html`).
   O usuário abre **no navegador dele, em GPU real**.
2. `visual-tester`: **no máximo 1 print por variante** (3 no total), sem `fullPage`, e a descrição
   textual das falhas. A print é registro; a decisão é tomada com a tela rodando.
3. Nenhuma variante que reprovou em contraste, FPS ou nos checks de `hates.md` é mostrada.

Duas perguntas, nesta ordem:

> **1) Qual das três continua? A, B ou C?**

> **2) Das duas que morrem, o que sobrevive?** Marque o que você quer manter:
> — de <perdedora 1>: `features[]` dela, uma por linha
> — de <perdedora 2>: `features[]` dela, uma por linha

O segundo nível não é cortesia: no protótipo 01, duas técnicas das variantes rejeitadas viraram
**seções inteiras** do site final.

### `.forge-visual/direcao.md`

```md
# Direção escolhida
Vencedora: <id> — âncora <âncora>
Card medido: bgLuminance <x> · typeClass <x> · layoutAxis <x> · motionCoverage <x> ·
contraste <x> · fps <x>

## Sobreviventes
- de <id>: "<feature>" → vira <seção/elemento do site final>
- de <id>: "<feature>" → vira <seção/elemento do site final>

## Descartado explicitamente
- <feature/técnica> — motivo: <o dono não marcou | colide com hates.md | colide com a vencedora>

## Conflitos loves × hates resolvidos
- <traço> aparecia em <referência admirada> e viola <check de hates.md> → fora.
```

As perdedoras **permanecem no repositório** em `src/variants/{a,b,c}/`, fora do bundle (não
importadas). São o registro de rejeição — o fator que mais empurrou o resultado para longe da
média no projeto de referência.
