# Parte III — Revelação e transição

Onde a maioria dos sites entrega crossfade. As três desta parte existem para não entregar.

---

## III.1 — Máscara de threshold

**Problema.** Uma transição de tela cheia que não seja um crossfade genérico — e que possa mudar de
personalidade (varredura, espiral, dissolução, listras) sem reescrever shader.

**Mecanismo.** Uma textura em tons de cinza funciona como **threshold por pixel**. Um uniform
`uProgress` anima de 0 a 1; cada fragment vira quando o progresso ultrapassa o valor daquele pixel
na máscara. É um `step()` por fragment, com uma faixa de `smoothstep` (`uSoftness`) na borda para
não serrilhar.

Trocar a textura troca a transição inteira, **sem tocar no shader**. É o padrão mais barato de
personalizar que existe — e é por isso que ele responde bem a uma direção visual: a máscara é o
lugar onde o conceito entra.

**Custo.** Uma amostra de textura e aritmética simples por fragment; passe único, em cima de I.1.
Bytes: a máscara (256x256 em 8 bits, poucos KB) — resolução alta **não** é o que resolve borda.

**Quando NÃO usar.** Quando as duas camadas precisam coexistir de forma legível durante a
transição inteira (texto sobre as duas, por exemplo): o threshold decide por pixel e não sabe onde o
conteúdo importante está. Nesse caso o mecanismo precisa de uma **área segura** explícita, ou a
transição precisa ser outra.

**Armadilhas.**
- **Máscara de baixa resolução gera banding**; mas subir resolução é o remédio errado. O que resolve
  é filtragem linear mais uma faixa de softness (`~0,05`) na borda.
- A curva (`pow(uProgress, uCurve)`) muda a *área* revelada, não só o ritmo. Se a máscara já foi
  pré-distorcida com o mesmo expoente, a área volta a crescer linearmente e `uCurve` governa só o
  ritmo da borda — sem injetar um segundo easing pelas costas.
- **A transição não sabe onde está o texto.** Um pixel sob um bloco de texto pode continuar mostrando
  a camada clara com o texto já revelado. A correção é dar às **duas** camadas a mesma área segura e
  escurecer **a cor, não o alfa** (alfa converge para a cor do fundo e destrói o contraste medido).

**Provado no protótipo 01.** A forma da máscara não foi escolhida por gosto: os pesos foram varridos
numericamente exigindo que, em `uProgress = 0,5`, sobrem **>= 30% de pixels 100% A e >= 30% 100% B**
nas telas 9:16, 1:1, 4:3, 16:9 e 21:9 **depois** do corte do `cover`. A combinação escolhida dá
**43,6% no pior caso**; a espiral radial pura caía para **27,8%**, porque numa tela larga o `cover`
come justamente a faixa de raio alto. A máscara é equalizada por histograma (1024 bins, erro < 0,1%
na CDF) para que a distribuição de threshold seja plana. Máscara de **256 px** com filtro linear e
`uSoftness` 0,05: sem banding.

---

## III.2 — X-ray reveal com fluido

**Problema.** Revelar uma segunda camada — esqueleto, wireframe, "o que há por dentro" — seguindo o
cursor, de forma orgânica, em vez de um recorte circular duro que denuncia o truque.

**Mecanismo.** Composição de I.1 com I.4:
1. **Duas cenas** compartilhando câmera e luz (o exterior e o interior), cada uma no seu render
   target;
2. a **máscara nasce do cursor**: um canvas desenha um rastro escuro sobre claro;
3. esse rastro alimenta uma **simulação ping-pong** que o difunde para fora, modula com ruído FBM e
   desbota de volta ao neutro;
4. no passe final, a máscara é o fator de `mix` entre as duas cenas.

O que dá o resultado não é o x-ray: é a máscara ter **memória e inércia próprias**, de modo que o
movimento do cursor deixa rastro que se dissipa sozinho.

**Custo.** As duas cenas renderizadas por quadro (o dobro de draw calls) mais dois FBOs da simulação.
É a técnica mais cara do catálogo em GPU, e a única que multiplica o custo de cena.

**Quando NÃO usar.** Se um gradiente radial seguindo o cursor resolve, use o gradiente: o olho não
paga a diferença em muitos casos. Também não use quando a "segunda camada" pode ser a mesma
geometria com outro material — aí não há duas cenas, há um uniform.

**Não foi provado no protótipo 01.** Custo estimado a partir do mecanismo; meça as duas cenas e a
simulação separadamente antes de fechar o orçamento.

---

## III.3 — Cena WebGL persistente entre páginas

**Problema.** Navegar entre páginas destrói o contexto WebGL: recarrega modelo, recompila shader,
pisca. É o que separa um site que parece um aplicativo de um site que parece um conjunto de páginas.

**Mecanismo.** O **canvas fica fora do container que o roteador troca**. O roteador substitui só o
conteúdo; o canvas, o renderer, a cena, as luzes e os recursos carregados nunca são desmontados.

| Persiste | É reconstruído |
|---|---|
| Canvas, instância única do motor | HTML dentro do container |
| Modelos carregados (clonados, nunca recarregados) | As animações da página |
| Cena, câmera, renderer, luzes | O identificador de rota |
| Estado de interação do ponteiro | |

**Detalhes que decidem.** O motor precisa ser **instância única**, criada no primeiro carregamento e
reusada depois. A câmera anima **em paralelo** com a troca de conteúdo — é isso que dá coesão, não a
persistência em si; um mapa `rota -> pose de câmera` dirige o movimento. Use **`ResizeObserver` no
canvas**, não `window.resize` (o canvas pode mudar de tamanho sem a janela mudar).

**Custo.** Zero por quadro. O custo é de arquitetura e de disciplina: qualquer estado que vaze entre
rotas vira bug que só aparece na terceira navegação.

**Quando NÃO usar.** Site de página única — que é o caso padrão desta ferramenta. E quando as
páginas têm cenas 3D genuinamente diferentes: aí persistir só troca o custo de recarregar pelo custo
de manter tudo vivo.

**Não foi provado no protótipo 01.** O site é de página única; a técnica foi avaliada e recusada por
não haver problema para resolver.
