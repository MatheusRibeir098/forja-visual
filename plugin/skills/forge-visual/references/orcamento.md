# Derivação do `budget` (fase 1)

Referência da skill `forge-visual`. O orçamento é **derivado das respostas do questionário**,
nunca fixado antes delas, e **re-derivado** depois da fase 2, quando os assets reais existem.

⚠️ **Por que isso é regra dura.** No protótipo 01 o orçamento foi arbitrado no início (300 KB
crítico / 600 KB lazy). O resultado: mapa de relevo em 1280×720 quando a referência pedia
3200×1800, nuvem de pontos com 12k em vez de 45k, e pós-processamento banido por spec. O site
passava em **todas** as métricas e não impressionava ninguém. Quando o teto foi suspenso, os
mesmos assets em resolução plena entregaram a imagem — e o custo real medido foi 2.043 KB lazy,
3,4× o teto que tinha sido "prudente". O número prudente estava errado porque foi escolhido antes
de existir a pergunta que ele deveria responder.

---

## 1. Caminho crítico (`criticalKb`)

Tudo que o navegador baixa **antes do primeiro quadro pintado**. Parcelas medidas neste projeto
(gzip, Vite 8 + TS + three 0.185 tree-shaken):

| Parcela | KB gzip | Quando entra |
|---|---|---|
| Shell: bundle TS + CSS + conteúdo textual | ~50 | sempre |
| Fonte variável | ~25 por família | por família usada (2 famílias = 50) |
| `three` core tree-shaken | **124** | só se o WebGL aparece **no primeiro quadro** |
| Motor próprio (ticker, composite, sync, shaders) | 10–25 | se houver WebGL; cabe na folga |
| Folga | 20 | sempre |

```
criticalKb = 50 + 25 × famíliasDeFonte + (124 se WebGL no 1º quadro) + 20
```

**A pergunta que decide os 124 KB não é "tem 3D?", é "o 3D está no primeiro quadro?".** São coisas
diferentes, e é aqui que a tensão entre público e direção se resolve — ver §4.

## 2. Lazy (`lazyKb`)

O que carrega depois do primeiro quadro. Duas parcelas: uma base de tolerância (quem é o público)
e o custo real dos assets que a direção exige.

```
lazyKb = base(audience) × mult(effectDensity) + Σ custo dos assets previstos
```

### base(audience)

| Resposta de P7 | base (KB) | Por quê |
|---|---|---|
| Portfólio / estúdio | 1500 | a pessoa veio ver a peça; 3–4 s de carga é aceitável |
| Lançamento / campanha / evento | 900 | chega por link e anúncio, parte em celular |
| Produto / SaaS com conversão | 600 | espera custa cliente |
| Conteúdo / documentação | 350 | veio ler, não veio ver |

### mult(effectDensity)

| `effectDensity` | multiplicador |
|---|---|
| `alta` | 1,6 |
| `media` | 1,0 |
| `contida` | 0,6 |

### Custo dos assets (medido neste projeto)

| Asset | KB gzip |
|---|---|
| Nuvem de pontos 45k, quantizada Int16 (+ casco de oclusão) | ~670 |
| Par depth + albedo a 3200×1800 (16-bit R+G) | ~1440 |
| Par depth + albedo a 1280×720 | ~260 |
| Tile de grão 256×256 | ~55 |
| Shader GLSL escrito à mão | 2–8 |

**Consequência que muda decisão:** *futurista por shader é barato; futurista por asset é caro.* A
mesma resposta de temperatura pode custar 10 KB ou 1,4 MB dependendo da técnica que a realiza — e
isso é assunto da fase 3, não da fase 1. Na fase 1 você estima pela intenção declarada e marca a
estimativa como tal.

### Fora do orçamento de efeito

**Conteúdo do usuário (fotos, vídeo, PDF) não entra aqui.** Conte à parte, com regra própria
(`srcset`, formatos modernos, lazy por viewport). Misturar as duas contas faz o efeito pagar pelo
conteúdo, e é assim que se corta um asset visual para caber uma galeria.

---

## 3. As três regras que acompanham o número

1. **Bytes informam, não reprovam.** Estourar o `lazyKb` **não** autoriza baixar resolução de
   asset, cortar amostras de shader ou remover efeito. Autoriza **uma pergunta ao dono**, com o
   número medido e as opções na mão. Escreva isso no briefing de todo `visual-dev` — sem isso,
   cada dev "otimiza" por conta própria e a soma das prudências individuais é o protótipo tímido.
2. **Excedente > 2× a base → pare e pergunte.** Não é reprovação; é sinal de que a direção
   escolhida custa outra ordem de grandeza e o dono precisa saber antes, não depois.
3. **Re-derive após a fase 2.** A variante vencedora revela os assets reais. Substitua as
   estimativas pelos números medidos, reescreva o `rationale` e reporte a diferença.

---

## 4. Tensão entre público e direção — resolve-se na arquitetura

Caso frequente: público "produto com conversão" (crítico baixo) + direção "3D no hero" (124 KB
antes do primeiro quadro).

**Errado:** cortar o 3D, ou reduzir o asset até caber.
**Certo:** três saídas, nesta ordem de preferência:

1. **Tirar o `three` do primeiro quadro** — o primeiro quadro é tipografia/CSS, com identidade
   própria; o WebGL entra em segundo momento, por cima, sem reflow. O crítico volta a ~95 KB.
2. **Trocar a técnica** — relevo por depth map e tinta por shader 2D custam bem menos que malha, e
   ainda são WebGL.
3. **Aceitar e declarar** — o dono decide pagar. Vai escrito no `rationale`, com o número.

Qualquer que seja a saída, ela fica registrada. Orçamento que força decisão de arquitetura é P2
funcionando; orçamento que degrada asset em silêncio é o L6 se repetindo.

---

## 5. Dois exemplos resolvidos

### Exemplo A — portfólio de fotógrafo, pé no chão, contido, sem 3D, paleta clara

```
criticalKb = 50 + 25×2 (serifada display + grotesca de texto) + 0 (sem WebGL no 1º quadro) + 20
           = 120
lazyKb     = 1500 (portfólio) × 0,6 (contida) + 55 (tile de grão) ≈ 955
```

`rationale`: *"Crítico 120 KB: shell 50 + 2 famílias variáveis 50 + folga 20; nenhum WebGL no
primeiro quadro porque a abertura é tipográfica. Lazy 955 KB: base 1500 (portfólio — o visitante
veio ver o trabalho) × 0,6 (densidade contida, a pedido) + 55 de tile de grão. As fotos do
fotógrafo são conteúdo e têm orçamento próprio, com srcset."*

### Exemplo B — lançamento de sintetizador, futurista, densidade alta, com 3D, neon, tráfego pago

```
criticalKb = 50 + 25×1 + 124 (o objeto 3D É o hero) + 20 = 219
lazyKb     = 900 (lançamento) × 1,6 (alta) + 10 (shaders à mão) ≈ 1450
```

`rationale`: *"Crítico 219 KB: shell 50 + 1 fonte variável 25 + three 124 (o objeto 3D é o
primeiro quadro, não dá para adiar) + folga 20. Tensão registrada: tráfego pago em celular pediria
≤ 150 KB; as saídas 1 e 2 foram descartadas porque o objeto é o produto anunciado, e o dono
aceitou os 219 KB. Lazy 1450 KB: base 900 (campanha) × 1,6 (densidade alta) + 10 KB de shader — a
direção é futurista por shader e luz, não por malha pesada, então não há asset de MB. Re-derivar
depois da fase 2: se a variante vencedora usar mapa de relevo em alta, somar ~1440 KB e reabrir
com o dono."*
