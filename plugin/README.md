# forge-visual

Plugin do Claude Code que constrói sites de alto impacto visual em **TypeScript puro + Vite +
three**, sem framework, sempre projeto novo: questionário de direção visual, três amostras reais
construídas e medidas para o dono escolher, catálogo de técnicas por mecanismo, e medição que
**reprova o build** (contraste ≥ 7:1 por pixel — medido ao longo de toda a faixa de animação, não
de um instante —, FPS mediana ≥ 60 em GPU real, foco visível, alvos de toque, semântica, texto
alternativo).

**Os sites gerados não respeitam `prefers-reduced-motion`.** Decisão de produto (PLUGIN-SPEC §5.1):
animam para todos, em qualquer máquina. Quem desliga animação por distúrbio vestibular — enjoo,
tontura, dor de cabeça com movimento na tela — vê o site se mexer do mesmo jeito. Isto não é
conformidade WCAG 2.2 AA completa; é o que a ferramenta de fato entrega, sem ressalva escondida.

## Como invocar

```
/forge-visual
```

**Sem prefixo duplicado, e sem nenhum arquivo em `commands/` para isso.** A regra é da
[documentação de skills](https://code.claude.com/docs/en/skills#how-a-skill-gets-its-command-name):

> Em uma skill de plugin, o `name` do frontmatter substitui o nome do diretório no último segmento
> do comando, então `my-plugin/skills/review/SKILL.md` com `name: fancy` vira `/my-plugin:fancy`.
> **O `/fancy` cru também invoca a skill, a menos que outro comando já use esse nome.**
> (Antes da v2.1.216 o nome do frontmatter substituía o comando inteiro.)

Como `skills/forge-visual/SKILL.md` declara `name: forge-visual`, o Claude Code registra
`/forge-visual:forge-visual` **e** o `/forge-visual` cru. Requer Claude Code **≥ 2.1.216**; em
versões anteriores só o nome cru aparecia.

**Por que não existe `commands/forge-visual.md`:** a mesma documentação diz que
["comandos personalizados foram fundidos em skills"](https://code.claude.com/docs/en/skills) — um
arquivo em `commands/` e uma skill produzem o mesmo comando e funcionam do mesmo jeito, e comandos
de plugin usam o mesmo namespace `plugin-name:command-name`. Um `commands/forge-visual.md` daria
**outro** `/forge-visual:forge-visual`, colidindo com a skill em vez de encurtar coisa alguma.

Se `/forge-visual` cru não aparecer no menu, alguma outra fonte já ocupa esse nome (skill pessoal,
de projeto, ou outro plugin). Nesse caso use `/forge-visual:forge-visual`, que nunca colide.

## O que vem dentro

```
.claude-plugin/plugin.json     manifesto
skills/forge-visual/           /forge-visual — questionário e condução das 5 fases
skills/visual-techniques/      16 técnicas indexadas por problema + as 9 regras transversais
skills/visual-guardrails/      lista de reprovação, armadilhas medidas, portões
agents/visual-dev.md           escreve todo o código do site
agents/visual-tester.md        valida por medição; emite PASSOU/FALHOU
scripts/measure-bundle.ts      bytes de dist/ contra o budget do brief (informa, não reprova)
scripts/measure-contrast.ts    contraste WCAG por pixel (reprova < 7:1)
scripts/measure-fps.ts         FPS/GPU-ms em GPU real (reprova mediana < 60)
scripts/measure-variant.ts     bgLuminance, motionCoverage, typeScaleRatio de uma variante (fase 2)
scripts/ingest-asset.ts        processa um asset do usuário em build time (derivado determinístico)
scripts/check-attribution.ts   crédito de licença e ausência de arquivo fonte no repo (reprova)
scripts/check-structure.ts     cada arquivo na pasta do seu papel; texto fora do markup; prefers-reduced-motion fora do código (reprova)
templates/site/                ponto de partida de todo site: motor, shaders, estilos e a estrutura
```

**Fonte única das 9 regras transversais:** `skills/visual-techniques/references/regras-transversais.md`.
A `visual-guardrails` aponta para lá em vez de reenunciá-las. O que muda entre as duas é o **uso**:
`visual-techniques` lê a regra para *escolher* técnica; `visual-guardrails` lê para *reprovar*.

## Como o site nasce

Todo site que a ferramenta gera começa de `templates/site/` (dentro do plugin), copiado para a
pasta do site novo — nunca de `pnpm create vite`:

```
cp -R "${CLAUDE_PLUGIN_ROOT}/templates/site/." ./meu-site/ && cd meu-site && pnpm install
```

O template já traz o motor (`src/engine/`, documentado em `ENGINE.md`), os shaders genéricos, a
base de CSS (com paleta placeholder gritante — magenta/ciano, de propósito, até o brief entrar
com as cores reais), a configuração inteira e a **estrutura de pastas** com um `README.md` em
cada uma dizendo o que vai e o que não vai ali (`src/{sections,content,generated,styles,shaders}`,
`dev/`, `scripts/`, `public/`), mais o molde completo de uma seção — `src/sections/exemplo/` +
`src/content/exemplo.ts` + `dev/exemplo.{html,ts}`, feito para ser copiado e apagado. Os medidores moram no plugin, mas carregam o
**`playwright-core` do projeto medido** — é o que os torna portáteis — e por isso `tsx` e
`playwright-core` já vêm nas devDependencies do template; não precisam ser adicionados de novo,
e não devem ser removidos numa "limpeza" de `package.json`. Sem eles, os dois portões que
reprovam ficam sem número.

## Rodando os medidores

```bash
cd /caminho/do/site
pnpm exec tsx <plugin>/scripts/measure-bundle.ts   --project=. --brief=.forge-visual/brief.json
pnpm exec tsx <plugin>/scripts/measure-contrast.ts --project=. --min=7
pnpm exec tsx <plugin>/scripts/measure-fps.ts      --project=. --min=60 --runs=3
pnpm exec tsx <plugin>/scripts/measure-variant.ts  --project=. --url=<url da variante> --id=<id> \
  --bg-min=<faixa atribuída> --bg-max=<faixa atribuída> --out=.forge-visual/medicoes/variant-<id>.json
```

Dentro de uma skill ou de um agente do plugin, `<plugin>` é `${CLAUDE_PLUGIN_ROOT}` (a substituição
vale em skill e agent content). `pnpm exec` a partir da raiz do site porque `tsx` é devDependency
do site, não do plugin.

Um `forge-visual.config.json` na raiz do site guarda `url`, `port`, `dist`, `previewCommand`,
`budget` e `out`, e dispensa os argumentos. A saída acumulada vai para
`.forge-visual/medicoes/measurements.json`.

**Códigos de saída, e o que cada um manda fazer:**

| Código | Significado | Ação |
|---|---|---|
| `0` | medido, dentro do critério | segue |
| `1` | reprovou o piso (contraste/FPS) · ou, no `bundle`, **não conseguiu medir** | corrige o valor · roda o build |
| `2` | medição inválida — caiu em SwiftShader (GPU de software) | máquina sem driver acessível; o número não descreve usuário nenhum |
| `3` | **inconclusivo** — a falha não reproduziu, ou a máquina estava disputada | ⛔ **isole a máquina e remeça.** Nunca "corte o efeito" |
| `4` | nada mensurável na página | nenhum glifo desenhado, ou revelação não terminou |

O `3` continua sendo vermelho: o portão não afrouxa. O que muda é o diagnóstico — e essa distinção
existe porque dois devs gastaram ~20 minutos cada cortando efeitos para consertar uma contenção de
GPU causada por um player de música.

O `bundle` sai com `0` quando estoura o orçamento: **bytes informam, não reprovam.**

## Asset do usuário: ingestão e crédito

Quando `brief.assets` traz um arquivo do usuário (modelo 3D, imagem, fonte…), dois scripts a mais
entram no fluxo — nenhum dos dois é medidor de FPS/contraste, e os dois processam em build time,
nunca em runtime:

```bash
pnpm exec tsx <plugin>/scripts/ingest-asset.ts --project=. --file=<caminho FORA do repo> \
  --origin="…" --license="…" --attribution="…" --attribution-url="https://…"   # ou --no-attribution

pnpm exec tsx <plugin>/scripts/check-attribution.ts --project=. --build
pnpm exec tsx <plugin>/scripts/check-attribution.ts --project=. --rendered   # + opacidade acumulada no DOM vivo
```

- **`ingest-asset.ts`** recebe o arquivo do usuário e grava o derivado determinístico (`sha256`
  estável) em `src/generated/assets/` mais o registro em `.forge-visual/assets.json`. Recusa com
  código `2` se `--file` estiver dentro do repositório do site.
- **`check-attribution.ts`** é o portão que reprova quando o crédito de licença some do HTML
  construído, ou quando o link do crédito fica dentro de uma `<section>`/`<article>` (não
  sobrevive ao corte da seção). Só é exigido quando o brief tem `assets` com `attribution`.
  Saídas: `0` ok · `1` reprovou · `4` nada mensurável (sem HTML construído a ler).

## Estrutura do site: o portão

`check-structure.ts` não mede nada — ele lê a árvore de arquivos e reprova quem saiu do lugar.
Existe porque a estrutura **é o que torna o paralelismo possível**: a fase 4 constrói com três ou
quatro `visual-dev` ao mesmo tempo, e a regra que os mantém vivos é *arquivos disjuntos*. Uma
seção por pasta garante interseção vazia sem ninguém negociar caso a caso.

```bash
pnpm exec tsx <plugin>/scripts/check-structure.ts --project=.          # 0 ok · 1 reprovou · 4 sem src/
pnpm exec tsx <plugin>/scripts/check-structure.ts --project=. --json --no-engine
```

Cinco verificações, todas estáticas e todas reprovando:

1. **lugar do arquivo** — só as pastas da estrutura sob `src/`; uma seção é uma **pasta** com
   `index.ts` exportando `mountSection`; CSS de seção na pasta da seção, e `src/styles/` sem
   seletor cravado no `id` de uma seção;
2. **texto fora do markup** — nenhuma frase visível escrita em `src/sections/` (`textContent`,
   `innerHTML`, `insertAdjacentHTML`, HTML com prosa em literal, `aria-label`/`alt`/`title`);
3. **`src/generated/` com procedência** — cada arquivo é um derivado registrado com o `sha256`
   que a ingestão gravou (hash diferente = editado depois de gerado) ou traz `@generated` no
   cabeçalho;
4. **`src/engine/` intocado** — comparado byte a byte com `templates/site/src/engine/`;
5. **`prefers-reduced-motion` fora do código** — nenhum `@media (prefers-reduced-motion...)` em
   CSS, nenhum `matchMedia` lendo essa preferência em TypeScript/JavaScript; a ferramenta ignora a
   preferência por decisão de produto (§5.1), comentário descontado — é assim que o próprio
   `src/engine/tier.ts` do template, que cita a expressão em comentário para explicar como
   reverter a decisão, passa limpo.

O que ele **não** vê, declarado: texto no `index.html` (ali o markup é o esqueleto legível sem
JavaScript), nome de shader que descreve efeito em vez de mecanismo, arquivo gerado editado e
regerado em seguida, e `src/variants/` na regra de texto (variante é protótipo de direção).

## Convenções do projeto gerado

| Convenção | Valor |
|---|---|
| Seção | uma pasta: `src/sections/<nome>/index.ts` exporta `mountSection(root, engine)` — `<nome>` = `id` da `<section>` no `index.html` = chave do `MOUNTS` |
| Texto da seção | `src/content/<nome>.ts`, tipado — nunca escrito no markup |
| Estilo da seção | `src/sections/<nome>/style.css`, importado pelo `index.ts`; `src/styles/` é só o global |
| Shader | `src/shaders/`, um arquivo por técnica, nomeado pelo mecanismo |
| Saída de script | `src/generated/`, nunca editada à mão (`@generated` no cabeçalho ou registro em `.forge-visual/assets.json`) |
| Motor | `src/engine/`, vem do template e **não se edita** |
| Página de inspeção | `dev/<nome>.html` + `dev/<nome>.ts` — uma por seção |
| Variante da fase 2 | `src/variants/<id>/index.ts` exporta `mountHero(root, engine)` — `<id>` é `a`, `b`, `c`… até `variantCount` (2 a 5) |
| Página da variante | `dev/<id>.html` → `/dev/a.html`, `/dev/b.html`… uma por variante |
| Artefatos de controle | `.forge-visual/` na raiz do projeto do usuário |
| Config dos medidores | `forge-visual.config.json` na raiz do projeto |
| Interface do motor | `ENGINE.md` na raiz do projeto (copiado do template) |

As variantes perdedoras ficam no repositório, fora do bundle: são o registro de rejeição.
