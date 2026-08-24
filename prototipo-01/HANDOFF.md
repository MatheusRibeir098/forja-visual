# Handoff — Forja Visual · Protótipo 01

**Data:** 2026-08-24 · **Sessão encerrada em:** L2 (divergência), aguardando validação do tester e a escolha do dono.

Leia nesta ordem: este arquivo → `.forge/progress.md` (estado + ciclos) → `.forge/tasks.md` (backlog) → `prompt.md` (spec, só as seções que a tarefa pedir). Contexto do projeto-mãe em `../VISAO.md`.

---

## Onde paramos

Fluxo 1 do Forge (`/forge-new`), loop do `orchestrator`. Lotes L0, L1 e L1b **fechados** (scaffold, conteúdo, engine GL, engine scroll, medição + relevo, `createEngine()`). L2 — as **3 variantes de hero** — foi **entregue pelos 3 devs**, mas:

1. **O `tester` das 3 variantes foi interrompido antes de começar** (o dono pediu para parar por hoje). Nenhum resultado dele existe. As prints em `.forge/screenshots/variant-{a,b,c}.png` são as que **os próprios devs** tiraram — servem para o dono olhar, mas não substituem a validação independente.
2. **O dono ainda não escolheu a variante.** Ele estava vendo as três localmente (`pnpm dev --port 5180`, páginas em `/dev/variant-{a,b,c}.html`). Só depois da escolha o L3 pode sair.

**Nada foi commitado ainda.** `prototipo-01/` está inteiro como untracked no git de `forja-visual/`, mais uma correção em `research/catalogo-tecnicas.md` (sinal do snippet V.4). Identidade git deste repo: pessoal (`MatheusRibeir098`), já configurada localmente — confirmar com `git config user.name` antes de commitar.

## Primeira ação da próxima sessão

1. `cd projects/forja-visual && git status --short` — confirmar o estado acima; **perguntar ao dono se quer commitar** o L0–L2 antes de seguir (commit em PT-BR; sugestão: `feat: protótipo 01 — engine, medição e 3 variantes de hero`).
2. Re-invocar o **tester** das 3 variantes com o briefing abaixo (é o mesmo que foi interrompido). Roda em paralelo com a leitura do dono — não bloqueia.
3. Apresentar ao dono: descrição textual de cada variante (do tester) + caminhos das 3 prints. **Ele mata duas.**
4. Com a vencedora: atualizar `tasks.md` (T9 promove `src/variants/<x>/` → `src/sections/hero/`) e disparar **L3 com 4 devs em paralelo** (T9–T12, arquivos disjuntos, ver `tasks.md`).

### Briefing do tester (reusar)
Validar A/B/C em `dev/variant-{a,b,c}.html` via `pnpm dev --port 5177 --strictPort`; GPU real obrigatória (`scripts/lib/chrome.ts` → `launchRealGpu()`; renderer com `SwiftShader`/`llvmpipe` = medição inválida); por variante: console limpo, FPS ≥ 58 em 1280×720 com cursor em movimento, contraste ≥ 7:1 por pixel, `prefers-reduced-motion` estático, 375×667 sem overflow, lista "cara de IA" (§6 do `prompt.md`) vazia, e o teste específico (A: threshold em progress≈0,5 tem pixels 100% A e 100% B; B: mover cursor troca o lado iluminado dos biséis; C: `?check=1` desvio ≤ 1 px). **Teto: 3 prints no total**, sobrescrevendo `variant-{a,b,c}.png`, sem `fullPage`. Retorno JSON com `descricao_visual` por variante (5–7 frases, ótica "estúdio × template"). Derrubar só o servidor da 5177 ao final.

## O que cada variante é (resumo para apresentar ao dono)

| | A — "A Média" | B — "Bigorna" | C — "Revista Técnica" |
|---|---|---|---|
| Ideia | Abre como caricatura do site de IA (gradiente, badge, 2 botões, 3 cards) e a máscara de threshold destrói isso em 1,5 s, revelando ~11k limalhas de ferro magnetizadas pelo cursor | "FORJA" cravada em metal escuro, reacesa pela luz do cursor (depth map 16-bit, normais derivadas, sombra por ray march de 8 passos); brasa laranja única | Editorial **claro**, 12 colunas assimétricas, serifada 13,5vw, § numerado, nota de margem; tinta "sangra" a partir do cursor atrás do título via sync DOM↔WebGL |
| Técnicas | I.1 + III.1 + V.4 | IV.1 + V.4 + V.3 | I.2 + V.4 |
| Números (dev) | 59,9 FPS · 11,35:1 | 59,9 FPS · faixas sólidas p/ contraste | 59,88 FPS · 15,05:1 · desvio 1e-14 px |
| Página | `/dev/variant-a.html?stats=1` | `/dev/variant-b.html?stats=1` | `/dev/variant-c.html?hud=1` |

Independente da escolha, **todas as 8 técnicas entram no site final** (as perdedoras só perdem o hero; suas técnicas vão para as seções F2–F5). As perdedoras ficam em `src/variants/` fora do bundle — registro de rejeição.

## Decisões e pendências abertas (não repetidas em `progress.md`)

- **`tier.ts` × briefing do relevo:** `rayMarchSamples` está 48/24/12 (decisão do dev do T2); o T7 limitou em 8 localmente com justificativa medida (sombra mais longa ~29 px → 8 passos ≈ 5 px). Decidir no T11 se `tier.ts` muda para 8/4/0 ou se o shader continua limitando. Tier `low` hoje **não** desliga o ray march.
- **Damp:** critério da spec ajustado para "10% do gap em ≤ 0,35 s" (250 ms medido). 1% custaria 800 ms; era o critério original, inalcançável sem matar a técnica.
- **`createDomSync` não é re-exportado** em `src/engine/index.ts` (importar de `@/engine/domSync`). Ajustar no T12 ou T13.
- **Variante A:** a área escurecida atrás do texto é medida só no resize; no site final (hero rolando) precisa re-medir via `engine.beats`. Só importa se A vencer.
- **Variante C:** strings de mobília editorial hardcoded em `src/variants/c/markup.ts` → mover para `src/content/` se C vencer.
- **`src/main.ts` ainda não monta nada** (só importa CSS) — é o T13. Por isso `pnpm build` ainda não inclui three; o número real do caminho crítico só existe depois do L3/L4. Estimativa: three 124 KB gzip + resto.
- `measure-contrast` reportou 17:1 nos placeholders; `measure-fps` 59,88 (tolerância de 1 frame por jitter de vsync, constante comentada).
- `dev/*.html` sem favicon → 404 cosmético no console (ignorar no tester).

## Comandos

```bash
cd ~/forge-claude/projects/forja-visual/prototipo-01
pnpm typecheck && pnpm lint && pnpm test && pnpm build   # todos verdes ao encerrar a sessão
pnpm dev --port 5180                                     # ver variantes em /dev/variant-{a,b,c}.html
pnpm measure                                             # bundle → contraste → fps (sobe/derruba preview 4173)
pnpm tsx scripts/build-relief.ts                         # regenera public/relief/* (determinístico)
```

Ambiente: Linux, Chrome do sistema via `playwright-core`; GPU real só com `--use-gl=angle --use-angle=gl` (tabela das combinações testadas no cabeçalho de `scripts/lib/chrome.ts`). Sem `xvfb`. TS fixado em 6.0.3 (TS 7 incompatível com typescript-eslint 8.67).

## Skills sugeridas

- `orchestrator` — obrigatória; é o loop. Rodar o checkpoint de paralelismo antes de cada invocação (L3 são 4 devs juntos).
- `safe-operations` — antes de subir/derrubar servidores: o dono pode ter um `pnpm dev` próprio na 5180.
- `git-profiles` + `no-deploy-no-push` — no primeiro commit deste protótipo (conta pessoal; nada de push sem ordem).
- `e2e-playwright` — só no briefing do tester (ele carrega).
- `search-before-code` — se three 0.185 / TS 6 surpreenderem um dev.

## Fora do escopo desta rodada (não iniciar sem o dono pedir)

Skills `visual-concept`/`visual-techniques`, MCP de medição, remote do git. O dono perguntou se "só o protótipo" era o plano e aceitou a resposta (provar antes de generalizar) — mas cogitou disparar o rascunho da skill em paralelo. Se ele voltar nisso, o insumo é `.forge/progress.md` + este arquivo, não teoria.
