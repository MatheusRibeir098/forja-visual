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

## L2 — divergência (paralelo, após L1) → dono escolhe por print
- [ ] T6 — Variante A "A Média" (I.1 + III.1) — depende de: T2,T3,T4 — lote: L2 — arquivos: src/variants/a/*
- [ ] T7 — Variante B "Bigorna" (IV.1 + V.4) — depende de: T2,T3,T4,T5 — lote: L2 — arquivos: src/variants/b/*, src/shaders/relight.ts
- [ ] T8 — Variante C "Revista Técnica" (I.2 + V.2) — depende de: T2,T3,T4 — lote: L2 — arquivos: src/variants/c/*, src/engine/domSync.ts, src/shaders/domPlane.ts

## L3 — seções (paralelo, após escolha)
- [ ] T9 — Hero (vencedora) + Tese F2 — depende de: L2 — lote: L3 — arquivos: src/sections/{hero,tese}/*
- [ ] T10 — Referência F3 + Princípios F6 (só CSS) — depende de: L2 — lote: L3 — arquivos: src/sections/{referencia,principios}/*
- [ ] T11 — Relevo F4 — depende de: L2 — lote: L3 — arquivos: src/sections/relevo/*, src/shaders/relight.ts
- [ ] T12 — Catálogo F5 — depende de: L2 — lote: L3 — arquivos: src/sections/catalogo/*, src/engine/domSync.ts, src/shaders/domPlane.ts

## L4 — amarração (paralelo)
- [ ] T13 — Medição F7 + main.ts + tiers + reduced-motion — depende de: L3 — lote: L4 — arquivos: src/sections/medicao/*, src/main.ts
- [ ] T14 — Responsivo 375×667 + a11y — depende de: L3 — lote: L4 — arquivos: src/sections/*/style.css, src/styles/*

## L5 — validação final
- [ ] T15 — Tester final: build + measure + e2e, orçamentos §6, lista §7, máx. 3 prints — depende de: L4
