# Spec — plugin `forge-visual`

Contrato de construção. Escrito pelo orquestrador em 2026-08-25, depois do protótipo 01 fechar.
Decisões e justificativas em `VISAO.md` §5.1, §5.2 e §6.1 — **leia as três antes de implementar**.

Este arquivo existe para que quatro devs em paralelo construam **uma** ferramenta, e não quatro.

---

## 0. O que esta ferramenta é

Um plugin do Claude Code que constrói sites de alto impacto visual. O usuário digita
`/forge-visual`, responde um questionário de direção visual, **escolhe entre três amostras reais**,
e a ferramenta constrói o site com subagentes em paralelo, com medição reprovando o que não atinge
o nível.

**O que ela NÃO é:** um gerador de templates, um catálogo de componentes, ou um wrapper de "faça
um site bonito". A diferença está na §2.

---

## 1. Estrutura de arquivos

Tudo abaixo de `projects/forja-visual/plugin/`. Vira repositório próprio depois; não é agora.

```
plugin/
├── .claude-plugin/
│   └── plugin.json              # manifesto
├── skills/
│   ├── forge-visual/SKILL.md    # /forge-visual — questionário + condução (DEV A)
│   ├── visual-techniques/SKILL.md + references/  # catálogo consultável (DEV B)
│   └── visual-guardrails/SKILL.md               # proibições + 9 regras (DEV C)
├── agents/
│   ├── visual-dev.md            # (DEV C)
│   └── visual-tester.md         # (DEV C)
└── scripts/                     # medidores portáteis (DEV D)
    ├── measure-contrast.ts
    ├── measure-fps.ts
    ├── measure-bundle.ts
    └── lib/chrome.ts
```

---

## 2. Por que o protótipo 01 ficou bom — o que precisa sobreviver à generalização

Quatro coisas, e **nenhuma delas é instrução motivacional**:

1. **Conhecimento** — catálogo com o *mecanismo* de cada técnica, nunca a receita pronta
2. **Proibições** — a lista de reprovação: sem `postprocessing`/`EffectComposer`, GSAP, Lenis,
   cursor custom, biblioteca de componentes
3. **Rejeição** — três variantes **construídas de verdade**, com o dono matando duas
4. **Portões** — medição reprovando o build

⚠️ **A regra que resume tudo: o que tira da média é restrição e rejeição, não incentivo.**
Qualquer skill que tente resolver isso com "seja criativo", "capriche" ou "faça algo impressionante"
produz a média com adjetivos. Se você se pegar escrevendo um adjetivo motivacional numa skill,
troque por uma restrição verificável.

---

## 3. O fluxo do `/forge-visual`

### Fase 1 — Questionário

Perguntas de **escolha entre opções concretas**, não abertas. Motivo (VISAO §5.1): perguntar
"que estética você quer?" a quem não é designer devolve "moderno". Perguntar "futurista ou pé no
chão?" devolve resposta utilizável.

Eixos obrigatórios:

| Eixo | Forma |
|---|---|
| Tema/assunto | aberta, curta |
| Temperatura | futurista ↔ pé no chão |
| Densidade de efeito | muito efeito ↔ contido |
| 3D | com objetos 3D / sem (impacto por tipografia, layout, movimento) |
| Paleta | escura / clara / neon / monocromática / a definir pela amostra |
| Referências | o que admira, e **o que odeia** (a segunda vale mais) |
| Público e uso | portfólio, produto, evento… — define se o site pode ser lento para carregar |

Saída: **um brief estruturado** (formato na §5), que é o contrato com todas as fases seguintes.

### Fase 2 — Divergência (o ponto crítico)

Constrói **três amostras reais** — hero funcional, rodando, medido. **Nunca mockup descrito em
texto:** no protótipo 01 o dono escolheu olhando as três rodarem em GPU real, e teria escolhido
diferente lendo descrições.

**A divergência precisa ser mecânica.** No protótipo 01 ela falhou em silêncio: as três variantes
saíram da mesma família editorial, e isso só apareceu quando o dono viu o site pronto e disse
*"achei que seria futurista"*. Um agente instruído a "gerar 3 direções diferentes" converge sozinho.

Mecanismo obrigatório:

1. Cada variante nasce em **contexto limpo** (subagente próprio, sem ver as irmãs)
2. Cada uma recebe um **ancoradouro distinto e obrigatório** — o eixo pelo qual ela ataca o
   problema. Ex.: **luz**, **material**, **tipografia**, **movimento**, **espaço**
3. Cada uma é **proibida de usar as técnicas escolhidas pelas outras** (o orquestrador cruza as
   listas e re-briefa quem colidir)
4. As três são **medidas** antes de irem ao usuário (contraste, FPS)

O usuário escolhe em **dois níveis**: a direção vencedora **e quais características das perdedoras
sobrevivem**. Isso não é cortesia — no protótipo 01, duas técnicas das variantes rejeitadas viraram
seções inteiras do site final.

### Fase 3 — Técnicas

Consulta `visual-techniques` e escolhe os mecanismos que entregam a direção escolhida, **com o
porquê registrado**. Técnica, nunca componente.

### Fase 4 — Construção

Subagentes `visual-dev` em paralelo, um por tarefa, arquivos disjuntos, teto de 3–4 simultâneos.
Briefing auto-contido por tarefa. (É o loop do Forge, já provado.)

### Fase 5 — Medição

Os portões da §6 rodam e **reprovam**. Não é relatório: é build vermelho.

---

## 4. Stack fixa

**TypeScript puro + Vite + three. Sem framework, sempre projeto novo.**

Não é limitação por preguiça (VISAO §5.2): sem framework o site controla cada quadro, carrega menos
e **não herda os padrões visuais que vêm de biblioteca pronta** — que são exatamente os que fazem
tudo parecer igual. Quem já tem projeto React fica de fora por ora.

---

## 5. O brief — contrato entre as fases

A fase 1 produz este objeto; as fases 2–5 o consomem. **Nenhum dev pode mudar a forma dele sem
avisar o orquestrador** — é o único acoplamento entre as quatro tarefas.

```ts
interface VisualBrief {
  subject: string;              // do que o site trata
  temperature: 'futurista' | 'pe-no-chao' | string;
  effectDensity: 'alta' | 'media' | 'contida';
  use3D: boolean;
  palette: string;              // 'escura' | 'neon' | ... | descrição livre
  loves: string[];              // referências que admira
  hates: string[];              // o que rejeita — pesa mais que `loves`
  audience: string;
  budget: {                     // DERIVADO das respostas, não fixado antes (VISAO §5.1)
    criticalKb: number;
    lazyKb: number;
    rationale: string;          // por que estes números, dadas as respostas
  };
}
```

⚠️ **O orçamento é derivado, nunca fixado antes.** O protótipo 01 provou o custo do contrário: teto
arbitrário no início produziu relevo em meia resolução, crânio com 1/4 dos pontos e pós-processamento
banido — um site que passava em todas as métricas e não impressionava. Ver o L6 em
[`.forge/progress.md` do site](https://github.com/MatheusRibeir098/forja-visual-site/blob/master/.forge/progress.md).

---

## 6. Portões — o que reprova

| Portão | Critério | Natureza |
|---|---|---|
| Contraste | ≥ 7:1, medido **por pixel** | reprova |
| FPS | mediana ≥ 60 em GPU real | reprova |
| Bytes | contra o `budget` do brief | **informa** |
| Build/typecheck/lint/test | verde | reprova |

Dois aprendizados caros do protótipo 01, que os medidores devem carregar:

- **Medida nova exige validação do ambiente antes de virar critério.** Dois devs gastaram ~20 min
  cada perseguindo uma cauda de p5 que era o Spotify do dono disputando a GPU. Se um número não
  correlaciona com a variável que você mexe, o problema não é a variável.
- **O medidor de contraste precisa saber o que é texto invisível.** Um parágrafo com `clip-path`
  fechado media "2,86:1" porque o medidor lia ruído de fundo e chamava de texto.

---

## 7. Divisão do trabalho (quatro devs, arquivos disjuntos)

| Dev | Dono de | Entrega |
|---|---|---|
| **A** | `skills/forge-visual/` | o questionário e a condução das 5 fases |
| **B** | `skills/visual-techniques/` | as 16 técnicas consultáveis por mecanismo |
| **C** | `skills/visual-guardrails/`, `agents/`, `.claude-plugin/` | proibições, 9 regras, os dois agentes, manifesto |
| **D** | `scripts/` | medidores portáteis, independentes de projeto |

Interseção vazia. O único acoplamento é o `VisualBrief` da §5, congelado aqui.

---

## 8. Fonte do material

Não invente conteúdo que já existe:

- `research/catalogo-tecnicas.md` — as 16 técnicas com mecanismo, e as 9 regras transversais
- `research/arsenal-visual.md` — panorama de ferramentas, com a coluna "quando NÃO usar"
- `VISAO.md` — princípios P1–P7, os 5 fatores, a lista de reprovação
- [`forja-visual-site`](https://github.com/MatheusRibeir098/forja-visual-site) — a prova de que
  funciona, em repositório próprio e no ar em
  [forja-visual.vercel.app](https://forja-visual.vercel.app): `.forge/progress.md` tem os números
  medidos e as armadilhas encontradas; `src/` tem as 11 técnicas implementadas
