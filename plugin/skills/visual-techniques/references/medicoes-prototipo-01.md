# Medições do protótipo 01 — o que cada número prova

O protótipo 01 (`projects/forja-visual/prototipo-01/`) implementou **10 das 16 técnicas** e mediu
todas elas em GPU real. Este arquivo existe para que a escolha de técnica na fase 3 seja feita com
números, e para que ninguém refaça uma descoberta que já custou horas.

Regra de leitura: **um número sem o método que o produziu não é evidência.** Todos abaixo trazem o
método junto.

---

## Por técnica

| Técnica | Número medido | O que ele prova |
|---|---|---|
| I.1 composite | FBO em RGBA16F: mediana **13,72 ms** de GPU (teto ~13,5). Em RGBA8: **9,8–12,05 ms** | Precisão de buffer não é o que mata banding — o dither é. Se a cadeia já termina em sRGB de 8 bits, half-float é custo sem imagem |
| I.1 composite | Bloom inline (taps no próprio FBO): mediana **11,2–11,3 ms**, p95 14,8–16,5 ms | Consolidar num passe bate uma cadeia de mips; o custo do post está nas trocas de alvo, não nas contas |
| I.1 composite | `renderer.setScissor()` **ignorado** ao trocar de render target | O three reaplica o scissor do alvo ligado; recorte tem de morar em `target.scissor` (px de device) quando há troca de alvo por baixo |
| I.2 DOM<->WebGL | Desvio **2,3e-13 px** em 140 amostras / 40 quadros (e ~1e-14 px noutra seção) | O alinhamento vira número quando se verifica por projeção inversa do mesh para a tela — "parece alinhado" deixa de ser aceite |
| I.2 DOM<->WebGL | **16 rects** lidos por quadro, numa chamada só | A regra 3 é cumprível sem perder responsividade: as seções derivam scroll e recorte dos mesmos rects |
| I.3 ticker | **1 `rAF`** no site inteiro, incluindo demand mode | Um ticker só é viável mesmo com 8 seções, 3D, medição ao vivo e reduced-motion |
| III.1 threshold | **43,6%** de pixels 100% puros no pior aspecto (alvo >= 30%), contra **27,8%** da espiral radial pura | A forma da máscara é decidida por varredura numérica sobre 5 proporções de tela depois do corte do `cover`, não por gosto |
| III.1 threshold | Máscara **256 px** + filtro linear + softness 0,05: sem banding | Resolução alta não é o remédio para borda serrilhada |
| IV.1 relight | **8 passos** de ray march; os 48 iniciais custavam **6x o laço pela mesma imagem** | O passo se deriva da geometria da sombra (29 px de sombra máxima, penumbra de 4,3 px); acima disso a marcha reamostra platô |
| IV.1 relight | Gradiente do albedo em chapa lisa: depth **exatamente 0**, albedo mediana **0,030** / p95 **0,080** (~2,5 e ~7 graus) | O truque do segundo gradiente injeta sinal real (na ordem do grão) e não domina o bisel — medido decodificando o asset e replicando a conta do shader em 20 mil pontos |
| IV.1 relight | Asset 1280x720 -> **3200x1800**, com raios de blur escalados 2,5x junto | Resolução do asset paga mais que ajuste de shader, desde que a largura física do bisel seja preservada |
| V.1 prepass | Descarte **53,7%** (45k pontos, casco de 8k; faixa 51,0–56,5%); **52,8%** na versão de 12k | Objeto convexo fica perto do piso teórico de 50%; os ~70% do catálogo são de um objeto reentrante — a diferença é de forma, não de implementação |
| V.1 prepass | **18,8%** dos pontos virados para a câmera somem, e o número não anda quando o encolhimento varia de 2,8% a 5,2% | É auto-oclusão real, não detalhe comido pelo casco. É o teste para separar as duas hipóteses |
| V.1 prepass | Encolhimento do casco **3,2%** do raio (era 4,0% com casco de 4,2k), margem mínima 0,018 | Casco melhor erra menos e permite encolher menos, revelando mais reentrância |
| V.1 sprite | Saturação de pixel **0,113%** (desktop) x **0,128%** (celular) com tamanho proporcional ao raio; tamanho fixo dava 0,9% x 0,1% | Proporcional ao raio **iguala** a saturação entre dispositivos; fixo satura ~9x mais no celular |
| V.2 beats | Beat imune a `prepend` de **800 px** acima da seção; 0 `getBoundingClientRect()` no laço | A âncora no DOM elimina a classe inteira de quebra silenciosa por mudança de conteúdo |
| V.3 damp | `settle 4 / reach 14 / reachDistance 0,25`: troca de lado de **0,90 s -> 0,27 s**; em produção, 10% do gap em **234–248 ms** (teto 350), 0 trocas de sinal | A assimetria entrega perseguição rápida e assentamento macio ao mesmo tempo; e o critério tem de ser 10% do gap, porque 1% levaria 800 ms numa assíntota |
| V.4 cursor-raio | Chapa de 620x349 -> 556x295 px com o cursor **parado**, e a poça de luz acompanhou; inversão de lado medida em 59,6/31,8 -> 24,6/33,1 | A influência é um cilindro em torno do raio: imune a scroll, resize e transform do grupo |
| V.5 Int16 | 45.000 pontos em **673 KB** a 14 B/ponto; referência de 48k: **659 KB** contra **1,3 MB** em Float32; quantum ~1000x menor que o espaçamento | Metade dos bytes, zero passe de decode, precisão irrelevante para o caso — e o teste de precisão é a razão quantum/espaçamento |

---

## Números do sistema (contexto para orçar)

| Medida | Valor | Observação |
|---|---|---|
| FPS mediana | **59,9** nos dois tiers | Em GPU real (Intel integrada), com ANGLE sobre GL — headless puro cai em renderizador de software e mede ficção |
| GPU por quadro, tier alto (1280x720 dpr 2) | mediana **10,54 ms**, p95 **13,77 ms** | Folga de 2,90 ms sobre 16,67. É o teto real a respeitar |
| GPU por quadro, tier baixo (375x667 dpr 1) | mediana **14,21 ms**, p95 **15,38 ms** | Folga de 1,29 ms |
| Contraste mínimo por pixel | **7,93:1** (piso 7:1) | Medido pixel a pixel, não por par de cores declaradas |
| Bytes | crítico **176,5 KB**, lazy **2043 KB** | Informativo, não teto — ver "orçamento" abaixo |
| three (core) | **123,9 KB** gzip | Fica no caminho crítico; movê-lo para `import()` dinâmico migra ~125 KB para o lazy |

**A inversão que mais muda decisão de técnica:** o tier baixo tem **15x menos pixels** que o alto e
custa **mais** tempo de GPU. Logo o gargalo do celular **não é fill**, é overhead de geometria e
draw call. Consequência direta na fase 3: um passe de tela cheia (I.1, I.4, III.1) é
comparativamente **barato** no celular e caro no desktop a dpr 2; quem aperta o celular é contagem
de objetos e de draw calls.

---

## Três armadilhas de medição que já custaram tempo

**1. Ambiente não isolado vira "regressão".** Uma cauda de p5 em 30 fps foi perseguida por dois devs
(~20 min cada) e atribuída ao bloom. Com o bloom desligado, a cauda permaneceu idêntica (30,0 /
30,1 / 30,0 em três execuções) enquanto a mediana de GPU ficava em 11,2 ms — dentro do teto. A causa
era outro processo com renderização própria disputando a mesma GPU integrada.
**Regra destilada: medida nova exige validação do ambiente antes de virar critério. Se um número não
correlaciona com a variável que você mexe, o problema não é a variável.** Para orçamento de GPU, a
métrica é a **mediana** (reflete o seu quadro); o p5 reflete quem mais está na máquina.

**2. O medidor precisa saber o que é texto invisível.** Um parágrafo com `clip-path` fechado media
"2,86:1" porque o medidor lia ruído de fundo e chamava de texto — e o número mascarou por dias um
defeito real de contraste em outra seção. Todo elemento animado por revelação precisa que
`opacity` chegue a 0 de fato quando o conteúdo não está desenhado.

**3. Meça a faixa, não o instante.** Uma transição por threshold pode ter o pior contraste em
qualquer valor de `uProgress`. A verificação correta amostra a faixa inteira (quadros a cada
~25–100 ms de 0 a 1), não o estado final.

---

## Sobre orçamento (por que ele é derivado, e não fixado antes)

O protótipo começou com teto de bytes fixado no início. O resultado: relevo em meia resolução, nuvem
com 1/4 dos pontos, tratamento de imagem banido — um site que passava em todas as métricas e não
impressionava. Quando o teto foi suspenso e virou **número informativo**, as mesmas técnicas
entregaram 3200x1800, 45k pontos e um passe de grade completo, **mantendo** 59,9 fps de mediana e
7,93:1 de contraste.

Leitura para a fase 3: bytes são consequência da direção visual escolhida (por isso o `budget` do
brief é derivado das respostas da fase 1); **FPS e contraste são qualidade e continuam reprovando**.
Quando o orçamento aperta, a saída é **reduzir um número** da própria técnica (contagem de pontos,
passos, resolução) — nunca trocar a técnica por uma mais pobre, e nunca criar um caminho de código
alternativo (regra 6).

---

## O que continua sendo teoria

Seis técnicas não foram implementadas no protótipo: **I.4** (ping-pong FBO), **II.1** (chunking),
**II.2** (fog injetado), **II.3** (inverted hull), **III.2** (x-ray com fluido) e **III.3** (cena
persistente entre páginas). II.1, II.3 e III.3 foram avaliadas e **recusadas por não haver problema
para resolver** — cobrir o catálogo por cobrir é P4 ao contrário. Ao escolher qualquer uma das seis,
trate o custo da ficha como estimativa e **meça antes de fechar a fase 5**.
