# Forja Visual — Protótipo 01

Página única que **apresenta** a tese da Forja Visual (por que sites gerados por IA parecem
iguais) e **prova a tese em si mesma**: 8 técnicas do catálogo dentro de orçamentos numéricos
rígidos. Spec completa em [`prompt.md`](./prompt.md).

## Stack

Vanilla **TypeScript** + **Vite 8**, WebGL com **three.js** core tree-shaken, CSS moderno
(`@layer`, custom properties, `clamp()`, scroll-driven animations). **Sem** React, Tailwind,
GSAP, Lenis ou Motion — o teto de 300 KB gzip não paga runtime de framework.

## Como rodar

```bash
pnpm install
pnpm dev        # http://localhost:5173
```

## Scripts

| Comando          | O que faz                                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| `pnpm dev`       | servidor de desenvolvimento                                                                                |
| `pnpm build`     | build de produção em `dist/`                                                                               |
| `pnpm preview`   | serve o `dist/` em http://localhost:4173                                                                   |
| `pnpm typecheck` | `tsc --noEmit` no app e nos scripts                                                                        |
| `pnpm lint`      | ESLint flat config + typescript-eslint                                                                     |
| `pnpm test`      | testes unitários (Vitest)                                                                                  |
| `pnpm measure`   | gera `src/generated/measurements.json` a partir do `dist/` — **ainda não implementado** (Lote 1, tarefa 5) |
| `pnpm e2e`       | specs Playwright — **ainda não implementado** (usa o Chrome do sistema via `playwright-core`)              |

## Como medir

Os orçamentos da seção 6 da spec são medidos por script, nunca a olho:

```bash
pnpm build && pnpm measure     # caminho crítico gzip, fontes, assets lazy
du -cb public/fonts/*.woff2    # teto de fontes: 80 KB
```

Números do scaffold (medidos em 2026-08-24, `pnpm build`):

- caminho crítico HTML+CSS+JS: **3,0 KB gzip** (teto 300 KB)
- fontes: **49,9 KB** (teto 80 KB)

## Tipografia

Duas fontes **self-hosted**, subset latino, `font-display: swap`, sem chamada de rede em
runtime:

| Papel   | Família                                                                               | Licença     | Bytes  |
| ------- | ------------------------------------------------------------------------------------- | ----------- | ------ |
| Display | [Instrument Serif](https://fonts.google.com/specimen/Instrument+Serif) 400            | SIL OFL 1.1 | 21 032 |
| Texto   | [Instrument Sans](https://fonts.google.com/specimen/Instrument+Sans) 400–700 variável | SIL OFL 1.1 | 30 092 |

Registro canônico em `package.json` → campo `forja.fonts`.

## Estrutura

```
index.html            # 7 <section> semânticas + <canvas id="gl"> fixo atrás
public/fonts/         # os 2 woff2
src/
  main.ts             # boot
  styles/
    tokens.css        # escala tipográfica fluida, espaçamento, cores (placeholder neutro)
    base.css          # reset + @layer reset, base, sections
    typography.css    # @font-face + utilitários de tipografia
```

As pastas `src/{engine,shaders,sections,variants,content,generated}/`, `scripts/` e `e2e/`
chegam nos lotes seguintes (spec §8).

> **Cores são placeholder.** A direção visual sai da divergência (spec §3.1): três heros
> incompatíveis, o dono escolhe um. Fixar paleta agora seria a média por antecipação.
