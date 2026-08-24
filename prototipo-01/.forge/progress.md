# Progresso — Forja Visual · Protótipo 01

## Estado
- Rodada 1 iniciada em 2026-08-24. Spec aprovada pelo dono (prompt.md).
- Decisões: vanilla TS + three core (OGL plano B), sem GSAP/Lenis/Tailwind, relevo tipográfico "FORJA" como asset.
- Divergência L2: 3 variantes A/B/C → dono escolhe por 1 print cada.
- Tentativas: — (nenhuma tarefa repetida até aqui)
- ⏸ 2026-08-24: sessão encerrada em L2 com os 3 devs OK e o tester INTERROMPIDO antes de rodar. Dono ainda não escolheu. Ver `HANDOFF.md`.

## Ciclos
- **T4 (1ª)** OK — 8 arquivos em `src/content/` (16 técnicas, 5 fatores, P1–P7, 9 regras, roadmap, site). Typecheck strict verde. Nota p/ UI: `Technique.source` é opcional e nas V.x é caminho, não URL.
- **T1 (1ª)** OK — Vite 8 + TS 6.0.3 (TS7 incompatível c/ typescript-eslint) + three 0.185 em chunk próprio. Fontes: Instrument Serif + Instrument Sans var (49,9 KB). dist 3 KB gzip. Pendências: happy-dom p/ Vitest (T3 instala); CLI playwright ausente → e2e via `tsx e2e/run.ts`.
- **T3 (1ª)** OK — beats/damp/pointer + 21 testes (happy-dom). ⚠️ GLSL cursor-raio correto é `mv.xy + ray * mv.z` (soma; catálogo V.4 tem o sinal errado). Damp: critério ajustado p/ 10% do gap em ≤0,35 s (250 ms medido; 1% seria 800 ms). Pendência: `vitest.config.ts` fora do include do tsconfig.node.
- **T5 (1ª)** OK — measure-{bundle,contrast,fps} + build-relief. GPU real: Intel RPL-U via `--use-gl=angle --use-angle=gl` (headless puro = SwiftShader). Relevo: depth 250 KB @1280×720 (16-bit R+G), albedo 5,6 KB, grão em tile separado `forja-grain.png` (contrato em public/relief/README.md). Contraste placeholders 17:1; FPS 59,88 (tolerância vsync 1 frame).
- **T2 (1ª)** OK — ticker/tier/gl/composite + thresholdMask; máscara equalizada por histograma, ≥30% A/B puro em 5 aspects; three 123,9 KB gzip. Pendências → T2b: beats.ts fallback rAF viola "1 rAF"; field.ts 2 erros lint.
- **T2b (1ª)** OK — `createEngine()` em src/engine/index.ts; beats sem fallback rAF (+`onDirty` p/ reduced-motion demand); `dev` no include do tsconfig. field.ts já estava limpo. Demo check pass em GPU real.
- **T6 (1ª)** dev OK — variante A: caricatura da média em SDF → máscara 1,5 s → campo de ~11k limalhas magnéticas (cursor-raio). Contraste 11,35:1 (atenuar cor, não alpha — alpha converge p/ cor da fonte). 59,9 FPS. Pendência p/ L3: área escurecida atrás do texto precisa re-medir por scroll (beats). Aguarda tester.
- **T8 (1ª)** dev OK — variante C: editorial claro 12 col, domSync.ts (I.2, 8 testes, desvio ~1e-14 px), tinta com bleed/fora-de-registro atrás do título. Contraste 15,05:1, 59,88 FPS. Pendência: re-export de createDomSync em engine/index.ts; strings de mobília em markup.ts → content se vencer. Aguarda tester.
- **T7 (1ª)** dev OK — variante B: relight.ts (IV.1: 16-bit R+G nearest, normais por diferença central, ray march 8) + cursor-raio + damp na luz + órbita 9 s sem cursor. 59,9 FPS. ⚠️ tier.ts entrega rayMarchSamples 48/24/12 (não 8/4/0); B limita em 8 localmente — decidir em L3. Aguarda tester.
