# Tarefas — Forja Visual · Protótipo 01

Spec: `../prompt.md`. Lotes paralelos = arquivos disjuntos.

## L0 — setup + conteúdo (paralelo)
- [x] T1 — Scaffold Vite 8 + TS strict + lint + playwright-core + fontes + tokens/base/typography.css + index.html — depende de: nenhuma — lote: L0 — arquivos: package.json, configs, index.html, src/main.ts, src/styles/*, public/fonts/*
- [x] T4 — Conteúdo tipado (tese, 16 técnicas, 5 fatores, 7 princípios, roadmap) — depende de: nenhuma — lote: L0 — arquivos: src/content/*

## L1 — motor + medição (paralelo, após T1)
- [x] T2 — Engine-GL: gl, ticker, tier, composite + shader thresholdMask + demo /dev/composite.html — depende de: T1 — lote: L1 — arquivos: src/engine/{gl,ticker,tier,composite}.ts, src/shaders/thresholdMask.ts, dev/composite.html
- [x] T3 — Engine-Scroll: beats, damp, pointer (puro TS) + testes Vitest — depende de: T1 — lote: L1 — arquivos: src/engine/{beats,damp,pointer}.ts, src/engine/*.test.ts
- [x] T5 — Medição: measure-{bundle,contrast,fps}.ts + build-relief.ts + public/relief/* — depende de: T1 — lote: L1 — arquivos: scripts/*, public/relief/*, src/generated/measurements.json

## L1b — contrato Engine (serial)
- [x] T2b — engine/index.ts createEngine() + remove fallback rAF de beats + lint field.ts + vitest.config no tsconfig.node — depende de: T2,T3,T5 — arquivos: src/engine/index.ts, src/engine/beats.ts, scripts/lib/field.ts, tsconfig.node.json

## L2 — divergência (paralelo, após L1) → **FECHADO: A vence** (dono, 2026-08-24; tester PASSOU nas 3)
- [x] T6 — Variante A "A Média" (I.1 + III.1) — depende de: T2,T3,T4 — lote: L2 — arquivos: src/variants/a/*
- [x] T7 — Variante B "Bigorna" (IV.1 + V.4) — depende de: T2,T3,T4,T5 — lote: L2 — arquivos: src/variants/b/*, src/shaders/relight.ts
- [x] T8 — Variante C "Revista Técnica" (I.2 + V.2) — depende de: T2,T3,T4 — lote: L2 — arquivos: src/variants/c/*, src/engine/domSync.ts, src/shaders/domPlane.ts

## L3 — seções (paralelo, após escolha) → **FECHADO**
<!-- B e C rejeitadas como hero; técnicas preservadas: IV.1 (B) → T11, I.2 (C) → T12, grade editorial (C) → sistema de layout -->
- [x] T9 — Hero (**A "A Média"**) + Tese F2 — depende de: L2 — lote: L3 — arquivos: src/sections/{hero,tese}/*
- [x] T10 — Referência F3 + Princípios F6 (só CSS) — depende de: L2 — lote: L3 — arquivos: src/sections/{referencia,principios}/*
- [x] T11 — Relevo F4 — depende de: L2 — lote: L3 — arquivos: src/sections/relevo/*, src/shaders/relight.ts
- [x] T12 — Catálogo F5 — depende de: L2 — lote: L3 — arquivos: src/sections/catalogo/*, src/engine/domSync.ts, src/shaders/domPlane.ts

## L4 — amarração (paralelo) → **em execução** (T13 e T14 rodando juntos, 2026-08-25)
- [x] T13 — Medição F7 + main.ts + tiers + reduced-motion — depende de: L3 — lote: L4 — arquivos: src/sections/medicao/*, src/main.ts
- [x] T14 — Responsivo 375×667 + a11y — depende de: L3 — lote: L4 — arquivos: src/sections/*/style.css, src/styles/*

## L5 — validação final
- [ ] T15 — Tester final: build + measure + e2e, orçamentos §6, lista §7, máx. 3 prints — depende de: L4

## L3b — 3D (após conceito definido pelo dono)
- [x] T16 — Seção 3D: nuvem de pontos + depth prepass (V.1) — depende de: L2 — lote: L3b — arquivos: src/sections/campo/*, src/shaders/points.ts, scripts/build-points.ts, public/points/*
  <!-- Adicionada em 2026-08-24 a pedido do dono: as 8 técnicas do 01 eram todas 2D; V.1 é a
       técnica-assinatura do portfolio-3d e ficou de fora. Conceito e orçamento em aberto. -->

## L6 — passada de excelência (teto de bytes suspenso, 2026-08-25)
<!-- Plano da curadoria: o site lê como "documento com 5 janelinhas de WebGL" porque três
     decisões foram tomadas sob orçamento — scissor por seção, zero pós-processamento e
     assets em meia resolução. A ① é a estrutural; as outras sobem matéria-prima. -->
- [x] T17 — Fix contraste `p.hero-goal` (2,86:1 → ≥7) — depende de: nenhuma — lote: L6a — arquivos: src/sections/hero/*, src/shaders/variantA*
- [x] T18 — measure-fps com `EXT_disjoint_timer_query_webgl2` (ms de GPU/quadro) — depende de: nenhuma — lote: L6a — arquivos: scripts/measure-fps.ts, scripts/lib/*
- [x] T19 — ② Relevo 1280×720 → 3200×1800 + 2º gradiente do albedo (IV.1 completo) — depende de: nenhuma — lote: L6a — arquivos: scripts/build-relief.ts, public/relief/*, src/shaders/relight.ts, src/sections/relevo/reliefPlane.ts
- [x] T20 — ③ Crânio 12k → 45k pontos + oclusor 8k + recalibrar uSize/frações — depende de: nenhuma — lote: L6a — arquivos: scripts/build-points.ts, public/points/*, src/sections/campo/scene.ts, src/shaders/points.ts
- [x] T21 — ① **ESTRUTURAL**: FBO de página + passe de grade próprio (curva fílmica, bloom 1/4, vinheta, grão, dither blue-noise). Escrito à mão — `postprocessing`/`EffectComposer` seguem reprovados pela §7 — depende de: T17,T18 — lote: L6b — arquivos: src/engine/{composite,frame,gl}.ts, src/shaders/grade.ts, src/main.ts, src/sections/*/index.ts, src/sections/catalogo/planes.ts
- [x] T22 — ⑤ Uma atmosfera só: as 4 seções de papel claro viram grafite (grade editorial intacta) — depende de: nenhuma — lote: L6b — arquivos: src/styles/*, src/sections/{referencia,catalogo,principios,medicao}/style.css
- [ ] T23 — ⛔ **CORTADO por prazo (2026-08-25)** — ④ Cursor com memória: ping-pong I.4 + III.2 alimentando a máscara da F2 — depende de: T21 — lote: L6c — arquivos: src/engine/pingpong.ts, src/shaders/fluid.ts, src/sections/tese/index.ts
- [x] T24 — Medição conjunta: contraste **depois do grade**, FPS com ms de GPU, bytes informativos — depende de: L6b
- [x] T25 — measure-bundle: bytes informativos, não reprovam — lote: L6a
- [x] T26 — Contraste do campo pós-grafite (6,86 → 8,88:1) — lote: L6b
- [x] T27 — Margem de GPU: hipótese do bloom **refutada**, causa = contenção de ambiente; bloom religado — lote: L6c

## L7 — próxima rodada (decidida com o dono em 2026-08-25, não iniciada)
<!-- Direção: parar de polir o 01 e DESTILAR. O dono definiu que a ferramenta é um plugin (VISAO §6.1)
     e que a fase 1 é um questionário de direção visual (VISAO §5.1) — ele olhou o 01 pronto e disse
     "ficou bom, mas eu achava que seria futurista; e realmente não parece IA". O critério de sucesso
     foi atingido; a ENTRADA é que não perguntou o gosto dele. -->
- [ ] T28 — Skill `visual-concept`: questionário de direção visual (tema, paleta, efeito×minimalismo, 3D sim/não) → brief + orçamento **derivado das respostas**
- [ ] T29 — Skill `visual-techniques`: catálogo → escolha de mecanismo, com o porquê
- [ ] T30 — Validador executável das 9 regras transversais
- [ ] T31 — Empacotar como plugin do Claude Code (`.claude-plugin/`)
- [x] T28 — Mensagem de revelação no hero ("achou que era mais um") — pedido do dono
- [x] T29 — Crânio: giro completo, volta a encarar o visitante — pedido do dono
- [x] T30 — Catálogo: coluna PESO cortada (padding duplicado .cat/.section, bug antigo) — pedido do dono
- [x] T31 — Medição: tabela desalinhada (grid no th/td) + bytes como referência — pedido do dono
- [x] T32 — Medição: texto "Teto" → "Referência" — pedido do dono
