# Parte IV — Imagem e superfície

---

## IV.1 — Reacender uma foto 2D com depth map

**Problema.** Fazer uma imagem comum — foto do cliente, chapa gravada, textura de material — reagir
à luz e ao cursor como se tivesse relevo, sem modelar nada em 3D e sem pipeline de modelagem.
É a técnica de maior alcance do catálogo: transforma qualquer imagem em superfície interativa, com
custo de autoria próximo de zero, e o resultado não se parece com template nenhum porque a
geometria vem do conteúdo do cliente.

**Mecanismo.** Três peças, todas sobre **um plano chato**:

1. **Depth map** — gerado por modelo de estimativa de profundidade. Claro = perto, escuro = longe.
   Não é geometria: é uma textura que o shader lê como campo de altura.
2. **Normais calculadas a partir do depth**, não de geometria. O shader amostra a profundidade em
   volta do pixel (diferença central: `+x/-x`, `+y/-y`) e monta a inclinação da superfície.
   *Essa única manipulação já faz um plano chato responder à luz como se tivesse volume* — e é a
   parte barata: quatro fetches por pixel, sem laço.
3. **Sombra por ray march** — cada pixel caminha em direção à luz atravessando o depth map; se
   encontrar uma elevação no caminho, está na sombra. Amostrar vários pontos acumula oclusão e dá
   penumbra. É a parte cara: **o custo é linear no número de passos**, por pixel.

**Refinamento que muda a imagem.** Um depth map de 8 bits tem só 256 níveis — vira degrau granulado
quando a luz lê a inclinação, porque a derivada amplifica a quantização. Duas saídas: converter para
float e **borrar antes de derivar** (guardando em half-float), ou empacotar 16 bits em dois canais
(R + G) e amostrar com filtro `nearest` — a segunda evita interpolação entre os dois bytes, que
produziria valores de altura que não existem.

**Truque extra que quase ninguém aplica.** Extrair um segundo gradiente do **brilho da própria
imagem** (luminância Rec.709) e fundi-lo com o gradiente da profundidade. O depth map traz a forma
grande; o albedo traz o detalhe pintado — desgaste, arranhão, poro — que lê como sulco sob luz em
movimento e que nenhum modelo de profundidade captura.

**Custo.**
- GPU: 4 fetches (normais) + N fetches (ray march) por pixel do plano. Com N=8 e dpr 2, é fetch que
  decide o FPS.
- Bytes: o depth map domina o payload — muito maior que o albedo, porque não comprime como foto.
- Autoria: quase zero (o depth é gerado por modelo).

**Quando NÃO usar.**
- Quando a cena precisa de **oclusão entre objetos**: a técnica só faz auto-oclusão. Um elemento não
  projeta sombra em outro que esteja em profundidade diferente.
- Quando o depth estimado é ruim para aquele conteúdo (imagens planas, muito contraste de textura
  sem forma). O realismo é limitado pela qualidade da estimativa, e nenhum ajuste de shader salva.
- Quando o plano ocupa pouca área da tela: o ray march custa por pixel do plano, e ninguém vai ver
  a penumbra num elemento de 200 px.

**Provado no protótipo 01.**
- **O número de passos do ray march é derivado, não escolhido.** A sombra mais longa que o campo de
  altura consegue projetar é `profundidade / tan(elevação)` = (0,35 x 0,05) / tan(24 graus) ~= 0,04
  unidades, ou ~29 px sobre uma chapa de 720 px. A marcha varre 0,06, então **8 passos** amostram a
  cada 0,0075 (~5 px) — a mesma ordem da penumbra de 0,006 (~4,3 px), que é o que impede a escada na
  borda. **Acima de 8, os passos reamostram o mesmo platô: os 48 iniciais custavam 6x o laço pela
  mesma imagem.** Esse é o padrão a seguir — derive o passo da geometria da sombra, não do gosto.
- **Escalar por tier é um número, não um caminho de código** (regra 6): 8 / 4 / 0 passos. Com 0, o
  shader sai do laço na primeira linha e o relevo continua reagindo à luz, porque quem faz isso é a
  **normal**, não a marcha.
- **Resolução do asset paga mais que ajuste de shader**: 1280x720 -> 3200x1800 nativo, com os raios
  de blur do bisel escalados 2,5x junto (8 -> 20 px e 1 -> 3 px) para manter a **mesma largura
  física** do bisel. O ganho vem de amostrar a mesma geometria com mais texels, sem tocar no ângulo
  de luz já calibrado.
- **O gradiente de albedo foi medido, não presumido.** Amostrado a **8 texels** de distância (não
  +-1, porque a variação de desgaste é lenta demais e a +-1 leria só ruído de quantização de 8 bits).
  Em 20 mil pontos de chapa lisa, fora da forma gravada, o gradiente do depth é **exatamente zero** e
  o do albedo tem **mediana 0,030 / p95 0,080** — ~2,5 graus de inclinação média e ~7 graus no p95,
  mesma ordem do grão, sinal real sem dominar o bisel. Força de fusão 1,5.
- **Bytes medidos** (informativos, não teto): depth 1365,6 KB, albedo 19,1 KB, grão 54,7 KB. O tile
  de grão fica em 256x256 de propósito: o tamanho dele na tela é função do número de repetições, não
  da resolução do asset.
- O build dos assets é determinístico (mesmo sha256 em execuções repetidas) — pré-processamento
  auditável, regra 4.

**Combina com.** V.4 (a luz segue o raio do cursor, e não um ponto fixo do mundo — sem isso a poça
de luz escorrega quando a página rola) e I.1 (o plano escreve no FBO de página e recebe o tratamento
final junto com o resto).
