# Parte II — Mundo e atmosfera

As três desta parte **não foram implementadas no protótipo 01** — e a recusa foi deliberada, com
motivo que vale mais que o mecanismo: cobrir o catálogo por cobrir é P4 ao contrário. Técnica se
escolhe porque a direção visual pede, nunca para marcar item de lista.

Consequência prática: os custos abaixo são do mecanismo, não de medição própria. Ao escolher uma
delas, meça antes de fixar o orçamento.

---

## II.1 — Chunking: infinito com três segmentos

**Problema.** Um corredor ou mundo "infinito" não cabe na memória, e modelar quilômetros em
ferramenta 3D não é viável nem de longe.

**Mecanismo.** Só **três segmentos** ficam montados: o que contém a câmera, um à frente e um atrás.
Um gerenciador cria e destrói conforme a câmera avança no eixo de percurso. Segunda camada de corte,
mais fina: cada segmento checa visibilidade quadro a quadro e some **por inteiro** ao passar de uma
distância — zero draw calls para geometria que a câmera nem olha.

**Variante grade 3x3.** Para um mundo navegável em duas dimensões, um único chunk repetido numa
grade 3x3 centrada na câmera; ao cruzar a fronteira de um tile, os chunks reposicionam.
**Nove chunks em memória, independente do tamanho do mundo.**

**A sacada que costuma valer mais que o chunking.** O corredor de origem é feito de **planos chatos
com textura desenhada à mão** — nenhum modelo 3D. Troca realismo geométrico por performance e por
controle artístico, e é o caminho quando não existe pipeline de modelagem no projeto (compare com
IV.1, que resolve o mesmo problema partindo de uma foto).

**Custo.** Memória constante por construção. O custo real é de autoria (as texturas/segmentos) e de
CPU no gerenciador de ciclo de vida. Bytes: proporcional ao número de texturas distintas, não ao
tamanho do mundo.

**Quando NÃO usar.** Site de página única com uma cena parada — que é a maioria. Sem percurso
contínuo, chunking é complexidade sem retorno. Também não use se as costuras não puderem ser
resolvidas: veja abaixo.

**Não foi provado no protótipo 01.** Avaliada e recusada: o site é de página única, sem percurso
contínuo — não havia problema para a técnica resolver. Custos acima são do mecanismo.

**Armadilhas.** As costuras entre chunks têm de fechar perfeitamente — qualquer desalinhamento de UV
ou de geometria salta aos olhos e é o defeito mais caro de corrigir tarde. O wrap de posição precisa
bater exatamente com o tamanho do chunk. Entrada em ângulo causa vazamento na fronteira e pode
exigir **curvar a fronteira de clipping**.

---

## II.2 — Fog animado por injeção de shader

**Problema.** O fog nativo é linear e morto: dá distância, não dá atmosfera. Atmosfera de verdade se
move, e é o que separa uma cena com profundidade de uma cena com ar.

**Mecanismo.** Dois passos, injetados via `onBeforeCompile()` no material que já existe — sem trocar
de material e sem passe extra:
1. **Fog por posição de mundo**: acima de certo Y a cor fica intacta, abaixo vira a cor do fog, com
   `smoothstep()` na transição.
2. **Animação por textura de ruído seamless** deslocada no tempo, com *domain warping* distorcendo a
   superfície do fog. A distância até a câmera controla a profundidade do efeito.

**Por que é barato.** Reaproveita uma **textura** de ruído em vez de calcular Perlin/Simplex por
fragment (regra 5). Uma amostra por material.

**Custo.** Uma amostra de textura e algumas contas por fragment, multiplicado por **todos** os
materiais em que a injeção entrou. Bytes: o tile de ruído (tipicamente 128–256 px, dezenas de KB).

**Quando NÃO usar.** Cena com muitos materiais e muitos polígonos — a injeção entra em todos e o
custo deixa de ser marginal. Também não use quando o efeito procurado é de **imagem**, não de
espaço: vinheta, grão e curva pertencem ao passe final (I.1), onde custam uma vez, não por material.

**Não foi provado no protótipo 01.** A atmosfera do site veio do passe final de imagem (I.1), que
custa uma vez por quadro em vez de por material. Custos acima são do mecanismo.

**Armadilhas.** Frequência e velocidade precisam de equilíbrio ou a repetição do tile fica óbvia —
e, uma vez percebida, não se desvê. `onBeforeCompile` acopla seu shader à versão interna do three:
uma atualização pode mover o trecho onde a injeção ancora.

---

## II.3 — Contorno por inverted hull (backface)

**Problema.** Contorno de malha estilo desenho/cel-shading, sem depender de um passe de
post-processing baseado em normal+depth.

**Mecanismo.** Duplica a geometria com **normais invertidas** e deslocada para fora, com material
plano escuro; o culling de faces frontais faz o casco aparecer só na borda da silhueta. É trabalho
de **pré-processamento na ferramenta 3D**, não de runtime: modificador de espessura negativa,
normais invertidas, slot de material próprio, exportado com os modificadores aplicados. No JS,
apenas reatribuir o material para um `MeshBasicMaterial`.

**Por que é barato.** Nada por quadro (regra 4). Só geometria a mais, renderizada como qualquer
outra.

**Custo.** Dobra a contagem de triângulos do objeto e adiciona um draw call por malha. Bytes: o
arquivo do modelo cresce na mesma proporção.

**Quando NÃO usar.** Muitos objetos: aí a duplicação de triângulos passa a dominar e um passe de
post baseado em normal+depth sai mais barato. Também não use se a espessura do contorno precisar
variar com a distância da câmera — o casco é fixo em espaço de objeto.

**Não foi provado no protótipo 01.** Avaliada e recusada: nenhuma malha do site pedia contorno.
Custos acima são do mecanismo.

**Armadilhas.** O número do slot de material varia por malha (usar um índice alto e deixar a
ferramenta cair no último é o truque conhecido). O three não converte materiais de tipo
fisicamente-baseado para `MeshBasicMaterial` sozinho — a reatribuição é manual, e esquecê-la faz o
contorno reagir à luz, o que é exatamente o que ele não deve fazer.
