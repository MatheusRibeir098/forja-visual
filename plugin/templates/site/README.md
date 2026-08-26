# Template de site — `forge-visual`

Ponto de partida de **todo** site gerado pelo plugin: o motor provado do protótipo 01
([código](https://github.com/MatheusRibeir098/forja-visual-site), [no
ar](https://forja-visual.vercel.app)), sem nenhuma decisão de imagem dentro. Copie a pasta inteira
para o diretório do site novo e comece pela primeira seção — não por `pnpm create vite`.

```bash
cp -R "${CLAUDE_PLUGIN_ROOT}/templates/site/." ./meu-site/
cd meu-site
pnpm install
pnpm dev
```

Depois de copiar, ajuste em cinco minutos: `name`/`description` do `package.json`, `<title>` e
`<meta name="description">` do `index.html`, e a paleta em `src/styles/tokens.css`.

## Leia isto antes da primeira cena

**[`ENGINE.md`](./ENGINE.md)** — a interface `Engine` inteira: como inscrever no ticker, ler
progresso de beat, receber o tier como número, lidar com `prefers-reduced-motion` e — o mais
importante — **desenhar sem apagar as seções vizinhas**. Quem pula esse documento reescreve o
motor por engano.

O comentário de topo de `src/main.ts` traz A REGRA DO CANVAS na versão longa.

## O que vem pronto

|                        |                                                                                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/engine/`          | `gl`, `ticker`, `tier`, `beats`, `damp`, `pointer`, `composite`, `domSync`, `frame` e o `createEngine()` de `index.ts`                        |
| `src/engine/*.test.ts` | os testes de `beats`, `damp`, `pointer` e `domSync` — parte do valor, não enfeite                                                             |
| `src/shaders/`         | `glsl.ts` (triângulo de tela cheia, `coverUv`, `linearToSrgb`), `thresholdMask.ts`, `grade.ts`, `domPlane.ts`                                 |
| `src/styles/`          | reset, camadas CSS, posicionamento do canvas e tokens **sem cor decidida**                                                                    |
| `src/main.ts`          | boot com `MOUNTS` vazio e a regra do canvas escrita por extenso                                                                               |
| config                 | `package.json`, `tsconfig` (strict), `vite.config.ts`, `vitest.config.ts`, `eslint.config.js`, `.prettierrc`, `.npmrc`, `pnpm-workspace.yaml` |

## O que **não** vem — e é você quem decide

Seções, conteúdo, variantes de hero, assets, fontes, paleta e tipografia. O template não impõe
estética: se removê-lo faria um site deixar de ser _aquele_ site, não está aqui.

⚠️ **A paleta em `src/styles/tokens.css` é placeholder gritante de propósito** (magenta e
ciano). Enquanto ela não for trocada pela paleta do brief, o portão de contraste
(`measure-contrast`, mínimo 7:1) reprova a entrega — que é o comportamento certo. As famílias
tipográficas também são placeholder (stacks do sistema): o site auto-hospeda as fontes do
brief em `public/fonts/`, com `@font-face` próprio e subset latin. Nenhuma chamada de rede a
fonte em runtime.

## Estrutura esperada do site

```
src/engine/     motor (já vem)      src/sections/<id>/index.ts   uma pasta por seção
src/shaders/    shaders genéricos   src/variants/{a,b,c}/        variantes de hero da fase 2
src/styles/     base + tokens       src/content/                 texto, separado do markup
dev/            páginas de inspeção src/generated/               saída de script, não editar à mão
scripts/        build de asset      e2e/                         runner de aceite
```

Convenções que valem mesmo quando o briefing esquece:

- seção exporta `mountSection(root: HTMLElement, engine: Engine)`; variante de hero exporta
  `mountHero(root: HTMLElement, engine: Engine)`;
- **um ticker só** — o do engine. Nenhum `requestAnimationFrame` novo em lugar nenhum;
- shaders vivem em `.ts` exportando strings, para o bundler tratá-los como código;
- alias `@/` → `src/`, nos três configs (vite, vitest, tsconfig).

## Scripts

```bash
pnpm dev         # vite, com dev/*.html servidas
pnpm build       # bundle de produção (three sai em chunk próprio)
pnpm preview     # serve o dist na 4173 — é o que os medidores sobem
pnpm typecheck   # tsc --noEmit nos dois tsconfig
pnpm lint        # eslint
pnpm test        # vitest (os testes do motor rodam aqui)
```

Falta de propósito um `e2e`: o runner é por site. Quando ele existir, acrescente
`"e2e": "tsx e2e/run.ts"` — `tsconfig.node.json` já inclui a pasta `e2e/`. Também **não**
crie um script `measure`: os medidores moram no plugin e são invocados por caminho, da raiz do
site:

```bash
pnpm exec tsx "${CLAUDE_PLUGIN_ROOT}/scripts/measure-bundle.ts"   --project=. --brief=.forge-visual/brief.json
pnpm exec tsx "${CLAUDE_PLUGIN_ROOT}/scripts/measure-contrast.ts" --project=. --min=7
pnpm exec tsx "${CLAUDE_PLUGIN_ROOT}/scripts/measure-fps.ts"      --project=. --min=60
```

É por isso que `tsx` e `playwright-core` já estão nas devDependencies: os medidores resolvem o
`playwright-core` **do projeto medido**. Sem eles, os dois portões que reprovam ficam sem
número. Não os remova ao "limpar" o `package.json`.
