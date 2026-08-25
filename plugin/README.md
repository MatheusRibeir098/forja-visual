# forge-visual

Plugin do Claude Code que constrói sites de alto impacto visual em **TypeScript puro + Vite +
three**, sem framework, sempre projeto novo: questionário de direção visual, três amostras reais
construídas e medidas para o dono escolher, catálogo de técnicas por mecanismo, e medição que
**reprova o build** (contraste ≥ 7:1 por pixel, FPS mediana ≥ 60 em GPU real).

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
scripts/measure-*.ts           medidores portáteis (contraste, FPS, bytes)
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
com as cores reais) e a configuração inteira. Os medidores moram no plugin, mas carregam o
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

## Convenções do projeto gerado

| Convenção | Valor |
|---|---|
| Variante da fase 2 | `src/variants/{a,b,c}/index.ts` exporta `mountHero(root, engine)` |
| Página da variante | `dev/<id>.html` → `/dev/a.html`, `/dev/b.html`, `/dev/c.html` |
| Artefatos de controle | `.forge-visual/` na raiz do projeto do usuário |
| Config dos medidores | `forge-visual.config.json` na raiz do projeto |
| Interface do motor | `ENGINE.md` na raiz do projeto (copiado do template) |

As variantes perdedoras ficam no repositório, fora do bundle: são o registro de rejeição.
