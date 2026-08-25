# Parte V — Matéria e movimento

As cinco que nasceram em produção. Todas foram implementadas e medidas duas vezes: no projeto que
as originou e de novo no protótipo 01, com números diferentes — o que é o melhor sinal de que são
técnica e não receita.

---

## V.1 — Depth prepass para nuvem de pontos aditiva

**Problema.** Sprites aditivos com `depthWrite: false` não se ocluem. Numa nuvem densa, o lado de
trás soma **através** do da frente e o meio da silhueta vira a região mais clara e menos estruturada
do quadro — o objeto lê como névoa, não como corpo. Atenuar os pontos de trás por orientação só
escurece: todos continuam sendo desenhados, e o fill continua pago.

**Mecanismo.** Uma malha decimada e **invisível** do mesmo objeto, desenhada **antes** da nuvem:

```
colorWrite: false   // nenhum pixel muda de cor
depthWrite: true    // a superfície próxima entra no depth buffer
depthTest:  true
side: DoubleSide
```

O `depthTest` normal da nuvem então **descarta** os pontos que estão atrás da casca. Um draw call,
zero fill, e o descarte acontece antes do fragment shader.

Dois detalhes que decidem se funciona:
- **`DoubleSide` é obrigatório**, porque o winding de uma malha decimada é consistente mas de
  direção desconhecida; com culling, um casco invertido oclui nada e o bug é silencioso.
- **O casco precisa ser encolhido** ao longo das próprias normais, ou ele engole as reentrâncias que
  deveria revelar. O encolhimento certo é função do erro da decimação, não um número mágico:
  percentil alto do resíduo entre casco e superfície original, mais uma margem pequena.

**Mecanismo irmão — tamanho de sprite proporcional ao raio.** O que decide se a nuvem lê como
superfície ou como poeira é a razão entre o disco do sprite e o **espaçamento entre vizinhos na
tela** — e esse espaçamento encolhe junto com o objeto quando a faixa livre é estreita. Portanto o
tamanho tem de ser derivado do raio do objeto em cena (`uSize = fator x raio`), recalculado a cada
resize, com piso (abaixo de 1 px o ponto pisca entre quadros) e teto (acima do teto os discos da
face próxima somam para branco, que é justo o borrão que o prepass existe para eliminar).

**Custo.** Um draw call e a memória da malha decimada (milhares de triângulos, não centenas de
milhares). Em troca, some a maior parte do fill aditivo. É das poucas técnicas do catálogo que
**devolve** orçamento.

**Quando NÃO usar.** Nuvem esparsa, em que os pontos de trás não se sobrepõem aos da frente — não há
o que descartar. Objetos côncavos e finos, em que a malha decimada não representa uma casca
confiável. E quando a estética procurada **é** a névoa: aí a soma através do corpo é o efeito, não o
defeito.

**Provado no protótipo 01** (crânio, dados abertos CC BY):
- Descarte medido: **52,8%** com 12k pontos e casco de 4,2k triângulos (24 poses); **53,7%** com
  45k pontos e casco de 8k (faixa 51,0–56,5% ao longo da coreografia).
- O catálogo de origem citava ~70%, num córtex. **A diferença é de forma, não de implementação**:
  um crânio é bem mais convexo, então fica perto do piso teórico de 50% (metade dos pontos de uma
  casca convexa está do lado de lá). Use ~50% como piso e ~70% como caso de objeto reentrante.
- **18,8% dos pontos virados para a câmera também somem** — e esse número não se move quando o
  encolhimento varia entre 2,8% e 5,2% do raio. Isso prova que é **auto-oclusão real** (dentes atrás
  do zigomático, fundo da órbita), não anatomia comida pelo casco. É o teste a repetir sempre que
  alguém suspeitar que o prepass está comendo detalhe: varra o encolhimento e veja se o número anda.
- Encolhimento: margem mínima de 0,018 do raio; com casco de 8k (que erra menos) o valor caiu de
  4,0% para **3,2%** do raio.
- Tamanho de sprite, por varredura de **saturação de pixel** (fração de pixels com canal >= 250/255,
  a mesma técnica do medidor de contraste), no desktop 1280x720 dpr 2 e no celular 375x667 dpr 1:

  | fator | desktop | celular |
  |---|---|---|
  | 11,4 (12k pontos) | 1,128% | 1,699% |
  | 8,0 | 0,434% | 0,520% |
  | 6,0 | 0,138% | 0,165% |
  | **5,7 (45k pontos)** | **0,113%** | **0,128%** |
  | 5,0 | 0,063% | 0,072% |

  O alvo é ~0,12%. E o ponto que interessa é a **propriedade**, não a linha: proporcional ao raio
  **iguala** a saturação entre desktop e celular (0,113% vs 0,128%, ~13% de diferença); um tamanho
  fixo deixava o celular saturar **~9x mais** que o desktop (0,9% contra 0,1%).
- Enquadramento pela **esfera envolvente** com correção `asin(r/D)`, nunca por eixo: o objeto gira, e
  a extensão vertical de agora é a horizontal de meia volta depois.
- Ganho colateral confirmado: a luz que os pontos ocultos gastavam volta ao orçamento — deu para ir
  de 12k a 45k pontos mantendo o mesmo total de luz somada e 59,9 fps.

---

## V.2 — Beats ancorados no DOM

**Problema.** Coreografia ligada ao scroll com posições cravadas (`at: 0.36`) quebra **em silêncio**:
os números foram lidos numa versão do conteúdo, num viewport. Um parágrafo a mais em qualquer lugar
acima desalinha tudo, sem erro no console.

**Mecanismo.** Inverte quem sabe. A seção **entrega um elemento do DOM** ao registro, e o registro
converte a posição dele em progresso 0–1, com âncoras declaradas (`enter`/`top`/`center` na entrada,
`exit`/`bottom`/`center` na saída). Nada é cravado, então nada desalinha.

Dois detalhes que são o mecanismo, não polimento:
- O `ResizeObserver` precisa observar **também o `documentElement`** — algo crescendo *acima* move o
  beat sem redimensioná-lo.
- As medições são **coalescidas num `rAF`** e o progresso vira um **campo lido**, não um cálculo
  chamado: quem consome lê a 60 Hz dentro do laço, sem alocar e sem tocar em layout (regra 3).
- O estado mora em **módulo**, não em contexto de framework: o consumidor costuma estar dentro de um
  reconciliador próprio (o do renderer 3D) e o valor é lido 60x/s.

**Custo.** Um `ResizeObserver` e uma leitura de layout coalescida por quadro. Zero por consumidor.

**Quando NÃO usar.** Quando a animação inteira cabe em **scroll-driven animations nativas** do CSS
(`animation-timeline: view()`): aí não há JS nenhum para coordenar, e é melhor. Beats são para
quando o valor precisa alimentar um shader ou uma cena 3D.

**Provado no protótipo 01.** O beat sobrevive a um `prepend` de **800 px** acima da seção sem
mudança no progresso relativo; **zero** chamadas de `getBoundingClientRect()` dentro do laço de
render; e uma seção usa o progresso cru, sem relógio — parar de rolar congela a máscara, que é a
prova de que o valor é posição, não tempo.

---

## V.3 — Damping assimétrico

**Problema.** Uma taxa única de suavização não consegue ser as duas coisas de que a interface
precisa: rápida enquanto persegue um alvo distante e macia ao assentar. Baixa demais, "demora uma
eternidade"; alta demais, estala a cada ajuste de scroll.

**Mecanismo.** A taxa é função da **distância até o alvo**, não do tempo de quadro:

```
rate = lerp(settle, reach, smoothstep(0, 1, |gap| / reachDistance))
```

Como continua sendo um damp exponencial por `dt` (`1 - exp(-rate * dt)`), permanece **independente
de frame rate** — o que é a razão de não usar um `lerp(a, b, 0.1)` por quadro, que muda de
velocidade conforme o FPS.

**Custo.** Aritmética escalar. Nada.

**Quando NÃO usar.** Quando o movimento precisa de tempo **determinístico** (sincronizar com áudio,
com uma sequência de imagens, com um corte): damp não tem duração, tem assíntota. Aí é curva com
duração explícita.

**Provado no protótipo 01.** Par medido `settle 4 / reach 14 / reachDistance 0,25`: uma troca de
lado (gap ~= 2x `reachDistance`) caiu de **0,90 s para 0,27 s** sem overshoot. Em produção, com uma
agulha perseguindo a soma de cinco beats, três execuções em GPU real deram **10% do gap em 234–248
ms** (teto de aceite 350 ms) e **zero trocas de sinal**. O critério de aceite virou "10% do gap em
<= 0,35 s" justamente porque exigir 1% levaria 800 ms — um alvo que a assíntota nunca ia cumprir e
que teria empurrado o ajuste para o lado do estalo.

---

## V.4 — Cursor como raio, não como ponto

**Problema.** Repulsão (ou luz, ou foco) medida como distância 3D até um **ponto** — o cursor
projetado num plano — só afeta a fatia do objeto perto daquele plano. O sintoma que aparece no
relatório é *"só funciona em algumas partes"*.

**Mecanismo.** Guarde a direção do cursor em **view space, dividida pela própria profundidade**.
Multiplicada pelo `z` do ponto, ela diz por onde o raio passa **naquela profundidade** — e a
profundidade se cancela:

```glsl
vec2 pointerOffset(vec3 mv, vec2 ray) { return mv.xy + ray * mv.z; }
```

A influência vira um **cilindro em torno do raio** em vez de esfera em torno de um ponto dele.
Bônus: como está em view space, é imune a qualquer transform aplicado ao grupo.

**Atenção ao sinal — este é o erro clássico.** Em view space do three a câmera olha para **-z**:
um ponto sobre o raio na profundidade `d` tem `mv.xy = ray * d` e `mv.z = -d`. O que cancela a
profundidade é a **soma** (`ray*d + ray*(-d) = 0`); com subtração o termo **dobra** em vez de sumir.
Anotações que trazem `-` estão assumindo o `ray` já negado no uniform. Escolha uma convenção,
escreva-a no módulo, e mantenha uma **fonte única** do trecho GLSL para que o espelho em JS (testes)
e o shader não divirjam.

**Custo.** Um `vec2` de uniform e duas multiplicações no vertex shader.

**Quando NÃO usar.** Quando o efeito é genuinamente sobre um ponto no espaço (um objeto que o cursor
"pega" numa profundidade conhecida). E em toque, onde não há cursor: o mecanismo precisa de um estado
`active` e de um comportamento de repouso — no protótipo, uma órbita lenta assume quando o ponteiro
some.

**Provado no protótipo 01.** Aplicado em três materiais diferentes (nuvem de pontos, plano de
relevo, planos sincronizados com o DOM) a partir do mesmo trecho compartilhado. A verificação que
vale copiar: com o **cursor parado** e só o scroll rolando, a chapa mudou de 620x349 para 556x295 px
e a poça de luz **acompanhou o elemento** — uma luz fixa no mundo teria escorregado. A inversão de
lado da luz foi medida por brilho em dois pontos opostos da chapa: **59,6 / 31,8 -> 24,6 / 33,1**.

---

## V.5 — Quantização Int16 normalizada (payload sem decode)

**Problema.** Buffers de geometria em `Float32` são o download da página. E o remédio usual —
comprimir e decodificar no cliente — troca bytes por tempo de CPU na hora pior, o carregamento.

**Mecanismo.** Grave `Int16` e entregue com `normalized: true`
(`new THREE.BufferAttribute(data, 3, true)`). **A GPU divide por 32767 no fetch do atributo, de
graça.** Não existe passe de decode, nem worker, nem biblioteca.

Precisão não costuma ser o problema, e isso se verifica com uma conta: compare o **quantum**
(1/32767 do alcance) com o **espaçamento entre vizinhos**. Se o quantum for ordens de grandeza
menor, a quantização é invisível.

**Combine com um shuffle determinístico no build**: se a ordem dos elementos é aleatória mas fixa,
**qualquer prefixo do array é uma amostra uniforme do todo** — então escalar por dispositivo vira um
`setDrawRange`, sem segundo arquivo e sem caminho de código alternativo (regra 6).

**Custo.** Zero em runtime. Metade dos bytes de `Float32`. O custo é no build: um script que precisa
ser determinístico e auditável.

**Quando NÃO usar.** Atributos que precisam de alcance dinâmico (posições em escala de mundo muito
grande, valores que passam de 1 depois de normalizar) ou de precisão absoluta (índices, IDs). Para
malhas indexadas comuns, com poucos milhares de vértices, o ganho é irrelevante — a técnica é para
dezenas de milhares de elementos para cima.

**Provado no protótipo 01.** Formato sem cabeçalho, três blocos contíguos de `Int16` sobre o mesmo
`ArrayBuffer` (posição, normal, curvatura) = **14 bytes por ponto**. 45.000 pontos couberam em
**673 KB**; a referência de origem, 48k pontos, media **659 KB em `Int16` contra 1,3 MB em
`Float32`**. Quantum de 0,00003 contra espaçamento de ~0,026 entre vizinhos — quase mil vezes menor,
logo invisível. Build determinístico (mesmo sha256 em execuções repetidas), e a válvula de escape
para orçamento apertado foi **reduzir a contagem** (-55 KB por passo), nunca trocar de técnica.
