# Parte VI — As 9 regras transversais

Destiladas da varredura de técnicas e confirmadas no protótipo 01. Elas não substituem a escolha de
técnica: **restringem** o conjunto de técnicas que ainda faz sentido depois de uma decisão.

Cada regra traz o predicado de verificação. Legenda da coluna "máquina" do índice:

- **estático** — dá para checar lendo o código/`package.json`, sem rodar o site.
- **runtime** — precisa de um navegador real com instrumentação.
- **teste** — precisa de um teste escrito para o caso, não de um checador genérico.
- **não** — é decisão de projeto; um número pode informar, mas não decidir.

**Este arquivo é a fonte única das 9 regras no plugin.** Ninguém as reenuncia em outro lugar: a
skill `visual-guardrails` e os agentes apontam para cá. Duplicar o texto de uma regra é a forma
mais confiável de as duas cópias divergirem.

A distinção de **uso** continua valendo, e é ela que justifica dois leitores para o mesmo arquivo:

| Quem lê | Para quê | Campo que ele usa |
|---|---|---|
| `visual-techniques` (fase 3) | **escolher** a técnica — a regra restringe o conjunto que ainda faz sentido | *Enunciado*, *Por quê* |
| `visual-guardrails` + `visual-tester` (portão) | **reprovar** a entrega | *Verificação*, *Reprova quando* |

Caminho absoluto, para quem chega de outra skill sem carregar esta:
`${CLAUDE_PLUGIN_ROOT}/skills/visual-techniques/references/regras-transversais.md`.

---

## 1. Progresso normalizado 0–1 como moeda comum

**Enunciado.** Scroll, hover, áudio, tempo — tudo vira um número em 0–1, e cada camada deriva sua
faixa local dele. Fontes concorrentes se combinam por `Math.max()` (ou outro operador único e
explícito), nunca por caminhos de animação paralelos disputando a mesma propriedade.

**Por quê.** Dois caminhos que escrevem o mesmo valor não têm vencedor definido; o bug aparece como
"às vezes trava no meio" e não reproduz. Com um combinador, o estado é uma função pura das fontes.

**Verificação — teste.** Para cada fonte de progresso: assert `0 <= p <= 1` em toda a faixa de
entrada, incluindo antes de entrar e depois de sair do viewport (clamp, não extrapolação); e assert
que a saída combinada é **monotônica** em relação a cada fonte isolada. Um checador genérico não
pega isso; o teste é por seção.

**Reprova quando.** Dois caminhos de código paralelos escrevendo a mesma propriedade animada; qualquer camada lendo `scrollY`/`clientY` direto para animar; progresso fora de 0–1 nas bordas do viewport.

**Provado.** Vários beats somados alimentam uma única agulha com **zero trocas de sinal** em três
execuções.

---

## 2. Um ticker, um estado

**Enunciado.** Um único `requestAnimationFrame` no aplicativo inteiro. Múltiplos `rAF` são a causa
raiz de judder inexplicável.

**Verificação — estático + runtime.**
- Estático: `grep -R "requestAnimationFrame" src/` deve devolver **uma** chamada de agendamento (a
  do ticker) fora de código de medição. Fallbacks dentro de módulos auxiliares contam e reprovam.
- Runtime: instrumente `window.requestAnimationFrame` **antes** do bundle carregar, guarde a pilha
  de cada chamador e conte **chamadores distintos por quadro**. Mais de um = falha.

**Reprova quando.** Qualquer `requestAnimationFrame` agendado fora do ticker — inclusive fallback dentro de módulo auxiliar. Mais de um chamador distinto por quadro.

**Provado.** Site inteiro com **1 `rAF`**, incluindo o modo demand de reduced-motion e uma ficha de
medição que atualiza ~1x/s dentro do ticker existente.

---

## 3. Meça o layout uma vez por quadro, antes de escrever

**Enunciado.** Todas as leituras de layout (`getBoundingClientRect`, `offsetWidth`, `scrollTop`) num
lote, no começo do quadro; só depois as escritas.

**Verificação — runtime.** Instrumente `Element.prototype.getBoundingClientRect` (e os getters de
layout) contando chamadas por quadro e registrando se alguma ocorre **depois** da primeira escrita de
`style`/`transform` no mesmo quadro. Reprova em: leitura após escrita (thrashing) ou contagem por
quadro acima do número de elementos registrados.

**Reprova quando.** Leitura de layout depois da primeira escrita no mesmo quadro (thrashing); contagem de leituras por quadro acima do número de elementos registrados.

**Provado.** Uma única função de sincronia é a única leitura de layout do quadro (**16 rects**), e as
seções derivam scroll e faixa de recorte desses mesmos rects — zero leituras extras; zero
`getBoundingClientRect()` dentro do laço de render.

---

## 4. Pré-processe o que não muda

**Enunciado.** Contorno na ferramenta 3D, ruído como textura, quantização no build, malha decimada
no build. Runtime é para o que responde ao usuário.

**Verificação — estático/parcial.** O build de assets tem de ser **determinístico**: rode duas vezes
e compare `sha256` de cada arquivo gerado. Diferença = há entrada não fixada (tempo, aleatório sem
semente, ordem de sistema de arquivos), e nesse caso o asset não é auditável nem cacheável. O resto
da regra — "isto poderia ter sido pré-computado?" — é julgamento humano na fase 3.

**Reprova quando.** Cálculo pesado e constante feito no primeiro quadro; build de asset com `sha256` diferente entre duas execuções.

**Provado.** Os dois pipelines de asset do protótipo (nuvem de pontos e relevo) produzem sha256
idêntico entre execuções.

---

## 5. Textura em vez de procedural quando o olho não distingue

**Enunciado.** Ruído seamless amostrado costuma bater Perlin calculado por fragment. A pergunta é
sempre "o olho paga a diferença?".

**Verificação — não.** É decisão de fase 3. O que a máquina fornece é o custo dos dois lados: tempo
de GPU por quadro (procedural) contra bytes do tile (textura). Decida com os dois números na mesa, e
escreva no comentário qual foi medido (regra 9).

**Reprova quando.** Ruído procedural por fragment sem a medição dos dois lados (ms de GPU × KB do tile) no comentário.

**Nuance provada.** A regra tem exceção quando a textura resolveria mas **custa memória e repetição
visível**: o dither final do protótipo usa *Interleaved Gradient Noise* calculado por fragment
(aproximação de blue-noise) exatamente para não carregar tile nenhum. O critério é custo x
percepção, não "textura sempre".

---

## 6. Escale por dispositivo com um número, nunca com um caminho de código

**Enunciado.** `setDrawRange`, contagem de amostras, dpr, escala de FBO. Nunca uma cena alternativa,
nunca um shader alternativo, nunca um `if` que desliga um efeito.

**Por quê.** Um caminho alternativo é um segundo site para depurar — e é o que ninguém testa, então
é o que quebra em silêncio.

**Verificação — estático.** Nenhuma ramificação por `tier`/`isMobile` que altere **estrutura**:
o que o tier pode tocar é valor de uniform, contagem, resolução e dpr. Predicado prático: procure
`tier`/`isMobile`/`matchMedia` em condicionais que envolvam `new`, `import(`, criação de material,
de cena ou de render target — todos reprovam. Condicional que só escolhe **número** passa.

**Reprova quando.** Cena alternativa, material alternativo, `import(` condicional ou `if (isMobile)` que troca o **desenho**. Condicional que só escolhe número passa.

**Provado.** Passos de ray march 8/4/0 por tier: com 0 o shader sai do laço na primeira linha
(`if (uSamples <= 0)`), mas é o **mesmo shader**; densidade da nuvem por fração do buffer embaralhado;
dpr com teto por tier.

---

## 7. Não monte o que está desligado

**Enunciado.** Um `EffectComposer` aloca render targets **ao existir**. Gatear por flag interna não
economiza nada. O mesmo vale para qualquer objeto que reserve memória de GPU no construtor.

**Verificação — estático + runtime.**
- Estático: `postprocessing`, `@react-three/postprocessing` e afins ausentes do `package.json`;
  `grep` por `new EffectComposer` vazio.
- Runtime: conte `WebGLRenderTarget` construídos e compare com os efetivamente usados no quadro
  (instrumente o construtor). Alvo alocado e nunca ligado = falha.

**Reprova quando.** Objeto que reserva memória de GPU construído e gateado por flag — o render target já foi alocado. `EffectComposer`/`postprocessing` presentes no `package.json`.

**Provado.** Todo o tratamento de imagem do protótipo (curva, bloom, vinheta, grão, dither) é escrito
à mão num passe só, sem `EffectComposer` — e o bloom deixou de ser mip-chain para ser inline
justamente para não alocar alvos intermediários.

---

## 8. Movimento por scroll/cursor é contínuo, nunca por evento — `prefers-reduced-motion` não é lido

**Enunciado.** Decisão do dono, registrada em `PLUGIN-SPEC.md` §5.1: os sites gerados **ignoram
`prefers-reduced-motion`** e animam em qualquer máquina, sempre. Em troca, o movimento que resta
não pode ser um handler de evento desenhando quadro: scroll e cursor alimentam o progresso 0–1
(regra 1), lido a cada quadro pelo ticker único (regra 2) — nunca um `addEventListener('scroll', …)`
que escreve `transform` direto. Um quadro por evento de scroll não é movimento contínuo: o
navegador agrupa eventos de entrada, e o resultado lê como engasgo.

**Por quê.** Foi exatamente esse engasgo que uma usuária com "efeitos de animação" desligados no
Windows relatou como site travado — a causa não era a ausência de um `if (prefersReducedMotion)`,
era o handler de scroll sendo a única fonte de quadro. Ler a preferência não teria corrigido nada.

**Verificação — estático + runtime.**
- Runtime: dispare uma sequência de eventos `wheel`/`scroll` sintéticos espaçados de poucos
  milissegundos entre si e conte quadros pintados no intervalo entre o primeiro e o último
  evento: tem de haver **mais de um quadro por evento de entrada** — sinal de que o progresso é
  lido pelo ticker, não escrito dentro do handler.
- Estático: `check-structure.ts` reprova qualquer `@media (prefers-reduced-motion...)` em CSS e
  qualquer `matchMedia` lendo `prefers-reduced-motion` em TypeScript/JavaScript do site gerado —
  comentário descontado, com o mesmo tokenizador que já separa comentário de código na
  verificação de texto hardcoded (item 2 do portão de estrutura). É a metade da regra que ficava
  "não verificável" até esta verificação existir: pega a forma direta do defeito (leitura da API),
  não prova a ausência de todo desvio possível (um valor lido e propagado por variável com outro
  nome escaparia a um grep estático) — é complemento do runtime acima, não substituto dele.

**Reprova quando.** Quadro pintado só dentro do handler de `scroll`/`wheel`/`pointermove`; contagem
de quadros pintados igual ou menor que a contagem de eventos de entrada no mesmo intervalo; ou
`@media (prefers-reduced-motion...)`/`matchMedia('...prefers-reduced-motion...')` fora de
comentário em qualquer código do site gerado.

`prefers-reduced-motion` não é lido para decidir frameloop, callbacks ou tier — em nenhuma
variante, em nenhuma tarefa. É decisão de produto, escrita e assumida: quem desliga animação por
distúrbio vestibular (enjoo, tontura, dor de cabeça com movimento na tela) vê o site se mexer do
mesmo jeito que qualquer outra máquina.

**Nota histórica — protótipo 01.** O protótipo 01, anterior a esta decisão, respeitava a
preferência: sob `prefers-reduced-motion: reduce` o ticker entrava em modo demand e as capturas
eram byte a byte idênticas. Registro do que foi feito ali — não descreve o comportamento da
ferramenta hoje.

---

## 9. Toda constante mágica carrega a medição que a justifica

**Enunciado.** Todo número escolhido tem, no comentário imediatamente acima, **o que foi medido, com
qual método e qual foi o resultado**. Sem isso ninguém pode mexer no número depois sem refazer a
descoberta inteira — e a alternativa real não é "mexer com cuidado", é "não mexer".

**Verificação — estático.** Para cada `export const NOME_EM_MAIUSCULAS = <número>` (e uniforms com
valor literal), exigir um bloco de comentário adjacente que contenha pelo menos um número e uma
unidade/critério. Reprova quando o comentário está ausente ou é uma paráfrase do nome da constante.
É a regra mais fácil de automatizar do conjunto — e a que mais protege o trabalho já feito.

**Reprova quando.** `const K = 0.018;` sem procedência, ou com comentário que só parafraseia o nome da constante.

**Provado, inclusive pelo custo do contrário.** No projeto que originou o catálogo, um comentário
afirmando que as camadas eram "depth-less" sobreviveu a uma mudança que o tornou falso, e uma decisão
de densidade foi tomada em cima dele. No protótipo, o inverso: a tabela de saturação de pixel, a
conta da sombra de 29 px e o diagnóstico do FPS ficaram **dentro** do arquivo da constante — e foi o
que impediu que o efeito fosse cortado de novo pela mesma hipótese errada.

**Corolário (P7 — comentário como ativo).** Comentário que **afirma comportamento** precisa ser
re-verificado quando o comportamento muda. Um comentário que envelheceu mentindo é pior que
nenhum: ele é lido como medição.
