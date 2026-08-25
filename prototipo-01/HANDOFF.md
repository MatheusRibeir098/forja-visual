# Handoff — Forja Visual · Protótipo 01

**Data:** 2026-08-24 · **Sessão encerrada em:** L4/T13 (amarração) — subagente **interrompido no meio** a pedido do dono.

Leia nesta ordem: este arquivo → `.forge/progress.md` (os 6 últimos ciclos têm os números medidos e as pendências) → `.forge/tasks.md` (backlog) → `prompt.md` (spec, só as seções que a tarefa pedir). Contexto do projeto-mãe em `../VISAO.md`.

---

## Onde paramos

O **L3 fechou por completo**: os cinco devs entregaram e todas as seções existem. O **L2 foi decidido** — o dono escolheu a **variante A ("A Média")** como hero, depois do tester aprovar as três em GPU real. As perdedoras não morreram: a técnica da B (relighting por depth map) virou a F4, a da C (sincronia DOM↔WebGL) virou a F5, e o layout editorial da C virou `content/editorial.ts`.

Uma **9ª técnica entrou fora da spec original**: `V.1 — depth prepass para nuvem de pontos`. O dono comparou o protótipo com o portfólio 3D de referência e apontou que as 8 técnicas eram todas 2D. A seção `campo` (crânio em nuvem de pontos) é a resposta. Detalhes medidos no ciclo T16 do `progress.md`.

**O T13 foi morto no meio da escrita.** Ele já tinha escrito `src/main.ts` (as 7 chamadas de `mountSection` na ordem correta) e `src/sections/medicao/{markup.ts,sheet.ts}` — mas **não chegou a escrever `src/sections/medicao/index.ts`**. O sintoma é um erro único e localizado:

```
src/main.ts(18,46): error TS2307: Cannot find module '@/sections/medicao'
```

Ou seja: `pnpm typecheck` está vermelho por **uma** causa conhecida, não por caos. Retomar é escrever esse `index.ts` e seguir o briefing do T13 a partir dali.

## Primeira ação da próxima sessão

1. `git log --oneline -3` e `git status --short` — o estado abaixo foi commitado como checkpoint; confirme.
2. **Re-briefar o T13** (o briefing continua válido; está resumido em "Briefing do T13" abaixo). Ele retoma escrevendo `src/sections/medicao/index.ts`.
3. Depois do T13 verde, **T14** (responsivo 375×667 + a11y) e então o **tester final (T15)**.

## Duas decisões abertas do dono

1. **Ordem da transição na F2 (pendente — perguntei, não respondeu).** O dev do T9 fez a F2 rolar do **específico → a média**: a página desaba na direção da média e termina em cima do parágrafo que diz que é para lá que tudo tende sozinho. A spec §3 sugeria o inverso. O argumento dele: o hero entrega a tela no específico, então esta ordem faz a transição na mesma cena, sem corte; a ordem inversa abriria com emenda e repetiria o gesto do hero. **Mudar depois do T14 fica caro.**
2. **Ordem das seções (decidida por mim, o dono ainda não viu rodando):** `hero → tese → referencia → campo (3D) → relevo → catalogo → principios → medicao`. O `campo` vem logo após a `referencia` porque F3 é a seção que explica por que o portfólio escapou da média, e o campo é a técnica-assinatura daquele portfólio funcionando — argumento e prova colados.

## O risco que pode derrubar o T13

**Orçamento lazy em 507,8 / 600 KB gzip** (relevo 312,2 + campo 195,6). Isso **só se sustenta com o `three` no caminho crítico** (import estático → `modulepreload`). Se o T13 carregar three com `import()` dinâmico, os ~125 KB migram para o balde lazy e estoura em ~633 KB. O caminho crítico tem teto próprio de 300 KB e hoje está muito abaixo, então three cabe lá com folga.

Se ainda assim estourar, o botão é `pnpm tsx scripts/build-points.ts --points=8000` (−55 KB) — **não** trocar de técnica nem cortar seção.

## Briefing do T13 (reusar)

Amarração: `src/main.ts` + `index.html` montando as 8 seções na ordem acima; `src/sections/medicao/` (F7) lendo `src/generated/measurements.json` + FPS/renderer em runtime (nada hardcoded); tiers como **números** (dpr, amostras, FBO, contagem de pontos), nunca caminho de código; `prefers-reduced-motion` mudando o frameloop para `demand`.

**A regra central, que três devs convergiram sozinhos** — escrever explicitamente em comentário no `main.ts`:

- Não existe clear global do canvas. Medido: região que ninguém desenha compõe como fundo da página.
- Toda seção que desenha usa `scissor` no próprio retângulo e devolve o estado do renderer (`clearColor`, `autoClear`, `scissorTest`).
- Sem isso: dois renders por quadro, ou "quem desenha por último vence".

Risco irmão: `engine/domSync` chama `pointer.setCamera` no resize. `relevo` e `campo` são imunes (calculam o próprio NDC→raio); as que usam `pointer.ray` global não são. Resolver de forma que a ordem de montagem não altere o comportamento.

Pendências concretas que caem no T13 (cada uma reportada pelo dev que a criou):

- `<section id="campo" class="section">` no `index.html` e `{ id: 'campo', label: … }` em `site.sections`.
- `relevo` recria o próprio `<h2 id="relevo-title">` para o `aria-labelledby` — não duplicar.
- `src/content/index.ts` não re-exporta `@/content/campo` (mesmo caso do `createDomSync`).
- **F6 só é 100% JS-off com o markup inlinado no `index.html`** — `renderPrincipios()` já devolve a string pronta. É o aceite da seção.
- `e2e/validate-l2.ts` tem `MIN_CONTRAST`/`MIN_FPS` declarados e não usados: **quatro devs** reportaram que isso deixa lint/typecheck vermelhos no repo inteiro. Arquivo descartável do tester do L2 — remover o arquivo ou as constantes.

Aceite: `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm measure` verdes **no repositório inteiro**. Relatar os dois números de orçamento medidos (crítico e lazy).

## Obrigação de licença (não é decoração)

A malha do crânio é **CC BY 4.0, autor `martinjario`** — [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:3D-Sch%C3%A4del_eines_Menschen.stl). O `.stl` fonte vive **fora do repositório** em `~/Downloads/Skull_martinjario_CC-BY-4.0.stl` e nunca deve ser commitado; só os `.bin` gerados entram. O crédito está em `src/content/campo.ts` e é renderizado como `<a>` real no colofão da seção. **Se alguém recortar aquela coluna de texto, o crédito precisa sobreviver ao corte.**

## Processos deixados de pé

Dois servidores Vite continuam ouvindo — **não os matei** porque um deles provavelmente é do dono:

| Porta | PID | Provável dono |
|---|---|---|
| 5180 | 49241 | o dono (foi a porta que sugeri para ele ver as variantes) |
| 5181 | 51445 | órfão de subagente |

Cheque com `ss -ltnp \| grep 51` antes de subir qualquer coisa (skill `safe-operations`).

## Ambiente

Linux, Chrome do sistema via `playwright-core`. **GPU real só com `--use-gl=angle --use-angle=gl`** — a tabela das combinações testadas está no cabeçalho de `scripts/lib/chrome.ts`. Renderer com `SwiftShader`/`llvmpipe` = medição inválida, o `measure-fps` aborta. Sem `xvfb`. TS fixado em 6.0.3 (TS 7 incompatível com typescript-eslint 8.67).

Permissões do harness foram afrouxadas nesta sessão a pedido do dono (`/home/math3us/forge-claude/.claude/settings.json`): `ask` agora tem só `git push`, `killall` e os `rm` recursivos. `kill`, `pkill` e `rm -f` não interrompem mais.

## Comandos

```bash
cd ~/forge-claude/projects/forja-visual/prototipo-01
pnpm typecheck && pnpm lint && pnpm test && pnpm build   # hoje: 1 erro, o do medicao/index.ts
pnpm dev --port 5177 --strictPort                        # páginas isoladas em /dev/*.html
pnpm measure                                             # bundle → contraste → fps
pnpm tsx scripts/build-relief.ts                         # regenera public/relief/* (determinístico)
pnpm tsx scripts/build-points.ts                         # regenera public/points/* (determinístico, sha256 estável)
```

Páginas de dev por seção: `/dev/{hero,tese,relevo,catalogo,campo}.html` (aceitam `?stats=1`; catálogo aceita `?check=1&hud=1`).

## Skills sugeridas

- `orchestrator` — **obrigatória**; é o loop. O checkpoint de paralelismo antes de cada invocação.
- `safe-operations` — antes de subir/derrubar servidor: há dois de pé (tabela acima).
- `clean-code` + `frontend-typescript` — nomear no briefing de cada dev, senão ele carrega várias por precaução.
- `e2e-playwright` — só no briefing do tester (ele carrega).
- `no-deploy-no-push` + `git-profiles` — o repo já existe e tem remote; identidade pessoal (`MatheusRibeir098`) já configurada localmente. **Nada de push sem ordem explícita.**
- `search-before-code` — se three 0.185 / TS 6 surpreenderem um dev.

## Fora do escopo (não iniciar sem o dono pedir)

Skills `visual-concept`/`visual-techniques`, MCP de medição, protótipo 02. O dono cogitou rascunhar a skill em paralelo mas não voltou ao assunto.
