# 🔨 Forja Visual

Ferramenta para criar sites visualmente impressionantes — **sem cara de IA**.

Formato ainda em aberto: skill do Forge, servidor MCP, framework, ou combinação. A decisão vem
depois que o material estiver maduro; escolher cedo demais congela o desenho errado.

**Estado: pesquisa consolidada + primeiro protótipo em construção.** A pesquisa está madura
(16 técnicas catalogadas); o protótipo existe para *provar* as técnicas antes de generalizá-las
numa ferramenta.

👉 **[`VISAO.md`](VISAO.md) explica o projeto por inteiro** — problema, referência, princípios,
arquitetura, roadmap, decisões em aberto e riscos. Este README é só o resumo.

---

## O problema

A pesquisa achou o diagnóstico em uma frase:

> *A IA prevê o design mais provável, e o mais provável é a média de tudo em que ela treinou. Não
> está copiando um site — está tirando a média de todos. E a média é, por definição, a opção menos
> distintiva possível.*

Não falta biblioteca. Elas estão todas aí, e de graça. O que existe é um caminho de menor
resistência que desemboca sempre no mesmo hero + gradiente + grid de três colunas + Inter.

**Ironia central:** as bibliotecas de componentes prontos (React Bits, Aceternity, Magic UI) são a
principal *fonte* dessa cara genérica, não a cura. Um Aurora Background é reconhecível à primeira
vista porque está em dez mil sites.

## A referência

Um portfólio 3D feito antes deste projeto é a prova de conceito — o site mais distinto já
produzido aqui. Vale entender **por que** ele escapou da média, porque é o núcleo do que a
ferramenta precisa reproduzir:

| Fator | Por quê |
|---|---|
| **Ideia específica, não estilo** | "Cérebro em nuvem de pontos com constelação de agentes" é decisão de conteúdo. "Site moderno com animações" é prompt de média. |
| **Restrições numéricas medidas** | Orçamento de luz somada, contraste por pixel, FPS em GPU real. Restrição dura força solução não-óbvia. |
| **Problema técnico real, resolvido** | O depth prepass não sai de tutorial nenhum — nasceu de "a nuvem não lê como cérebro". |
| **Asset próprio** | Um `.obj` processado por pipeline próprio, não preset de biblioteca. |
| **Rejeição iterada** | Fogo → poliedro → nuvem de pontos. Cada rejeição empurrou para longe da média. |

---

## O que já existe

```
research/
├── arsenal-visual.md      — ferramentas: o que existe, para que serve, quando NÃO usar
└── catalogo-tecnicas.md   — 16 técnicas com mecanismo, custo e armadilhas

prototipo-01/              — página única que apresenta a tese e a prova em si mesma
```

### Pesquisa

**[`research/arsenal-visual.md`](research/arsenal-visual.md)** — panorama de agosto/2026.
Renderização (three.js, TSL, WebGPU, curtains.js), animação (GSAP agora 100% grátis, Lenis,
Theatre.js), o que o browser já faz nativo, ferramentas de autoria (Rive, Spline, Blender),
tooling (Leva, r3f-perf) e notas de design da própria ferramenta.

**[`research/catalogo-tecnicas.md`](research/catalogo-tecnicas.md)** — o mais importante. Técnicas
em formato `Problema → Mecanismo → Custo → Quando NÃO usar`, em camadas: infraestrutura (composite
rendering, sync DOM↔WebGL, ticker único, ping-pong FBO), mundos, transições, imagem, e as 5
técnicas já provadas no portfólio. Fecha com 9 regras transversais e um backlog priorizado.

⚠️ **O catálogo guarda técnicas, não componentes.** "Depth prepass para dar volume a nuvem de pontos
aditiva" entra, porque explica *por que* funciona e se aplica a problemas que ainda não apareceram.
"Card com gradiente" não entra.

### Protótipo 01

**[`prototipo-01/`](prototipo-01/)** — uma página que **explica** por que sites de IA parecem
iguais e **desmente a tese sendo o contrário disso**. Não é demo de biblioteca: são 8 técnicas do
catálogo dentro de orçamentos numéricos rígidos.

Vanilla **TypeScript** + **Vite** + **three.js** tree-shaken. Sem React, Tailwind, GSAP, Lenis ou
Motion — o teto de 300 KB gzip no caminho crítico não paga runtime de framework.

Os orçamentos não são checados a olho; são medidos por script (`pnpm measure`):
peso do caminho crítico, contraste por pixel, e FPS em **GPU real** (uma medição em SwiftShader é
descartada). Detalhes em [`prototipo-01/README.md`](prototipo-01/README.md), spec completa em
`prototipo-01/prompt.md`.

Estado: motor, medição e as **três variantes divergentes de hero** entregues; a escolha da
vencedora (e o descarte das outras duas) é o próximo passo — o loop de rejeição é parte do método,
não acidente.

---

## Direção de desenho

Rascunho, sujeito a mudar — registrado enquanto o raciocínio está fresco.

**O que a ferramenta NÃO pode ser:** um catálogo de efeitos com um agente escolhendo. Isso
reproduz a média com passos extras.

**O que provavelmente precisa ter:**

1. **Extração de conceito antes de qualquer código.** Forçar um conceito visual *específico*
   antes de qualquer linha de código.
2. **Restrições numéricas como entrada, não validação no fim.** Exigir orçamentos — KB no caminho
   crítico, FPS alvo, razão de contraste — antes de gerar.
3. **Loop de rejeição embutido.** Gerar variantes divergentes para matar as ruins, em vez de
   entregar uma opção plausível.
4. **Catálogo de técnicas, não de componentes.**
5. **Nativo primeiro.** CSS scroll-driven e View Transitions antes de qualquer lib — uma IA importa
   GSAP por reflexo; não importar é literalmente um sinal de não-IA.
6. **Medição obrigatória no fim.**

**Caminho provável:** skill primeiro (mais barato, já integra ao fluxo de agentes), catálogo em
markdown, promover a MCP só o que precisar de estado ou medição. Framework só depois de 3–4
projetos.

---

## Próximos passos

- [ ] Fechar o protótipo 01 (escolher o hero, montar as seções, medir tudo)
- [ ] Destilar as 9 regras transversais num validador executável
- [ ] Varrer fora do Codrops: Three.js Resources, awesome-threejs, Shadertoy, Unicorn Studio
- [ ] Decidir o formato (skill / MCP / framework) — só depois do material maduro

---

*Pesquisa de agosto/2026. Licença: o código do protótipo é próprio; as fontes usadas são SIL OFL 1.1.*
