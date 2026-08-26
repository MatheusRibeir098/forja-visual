# Handoff — plugin `forge-visual`

**Para quem chega agora** (pessoa ou IA) e vai desenvolver, corrigir ou dar manutenção.

Leia este arquivo inteiro antes de escrever a primeira linha. Ele é curto de propósito; o que ele
não explica, ele diz onde está.

Última atualização: **2026-08-26** · versão publicada: **0.2.0**

---

## 1. O que é, em um parágrafo

Um plugin do Claude Code que **constrói sites de alto impacto visual**. O usuário digita
`/forge-visual`, responde um questionário de direção visual, escolhe entre N variantes de hero
**construídas de verdade**, e a ferramenta constrói o site com subagentes em paralelo, com medição
reprovando o que não atinge o nível.

**O que ele NÃO é:** gerador de templates, catálogo de componentes, ou wrapper de "faça um site
bonito".

---

## 2. A regra que explica todas as outras

> **O que tira da média é restrição e rejeição, não incentivo.**

Se você se pegar escrevendo "seja criativo", "capriche" ou "faça algo impressionante" em qualquer
skill — **apague e troque por uma restrição verificável**. Adjetivo motivacional produz a média com
adjetivos, que é exatamente o problema que este projeto existe para resolver.

O raciocínio completo está em `VISAO.md` §2 e na `PLUGIN-SPEC.md` §2.

---

## 3. Estado atual

| Peça | Onde | Situação |
|---|---|---|
| Skill principal | `plugin/skills/forge-visual/` | questionário + condução das 5 fases |
| Catálogo de técnicas | `plugin/skills/visual-techniques/` | 16 técnicas por problema; 10 com número medido |
| Proibições | `plugin/skills/visual-guardrails/` | cada uma com o motivo |
| Agentes | `plugin/agents/` | `visual-dev`, `visual-tester` |
| Medidores e portões | `plugin/scripts/` | 7 scripts (ver §6) |
| Template do site | `plugin/templates/site/` | motor pronto, **40 testes**, validado em pasta limpa |

**Provado:** que o nível é alcançável — o site de exemplo existe, é medido e não parece gerado.

**Não provado:** que a ferramenta reproduz isso sozinha. O exemplo foi conduzido por um humano e um
orquestrador, com julgamento estético que ainda não está inteiramente codificado. É **N=1** e prova
**qualidade**, não **generalidade**. O teste que responde: rodar `/forge-visual` pedindo algo
deliberadamente distante do exemplo — cyberpunk, por exemplo — **sem briefings escritos à mão**.

---

## 4. Onde achar cada coisa

| Preciso de… | Vá para |
|---|---|
| por que o projeto existe, princípios P1–P7 | `VISAO.md` §2 e §4 |
| o contrato entre as fases (`VisualBrief`) | `PLUGIN-SPEC.md` §5 — **congelado**, ver §5 aqui |
| as decisões de produto e o porquê | `PLUGIN-SPEC.md` §5.1 (movimento), §5.2 (estrutura), §6.1 (distribuição) |
| o que ainda falta / o que foi chutado | `BACKLOG.md` |
| o mecanismo de uma técnica | `plugin/skills/visual-techniques/references/` |
| os números medidos que fundamentam as regras | `plugin/skills/visual-techniques/references/medicoes-prototipo-01.md` |
| como a divergência funciona por dentro | `plugin/skills/forge-visual/references/divergencia.md` |
| o texto literal das perguntas | `plugin/skills/forge-visual/references/questionario.md` |
| como o orçamento é derivado | `plugin/skills/forge-visual/references/orcamento.md` |
| o motor do site gerado | `plugin/templates/site/ENGINE.md` |
| o catálogo original da pesquisa | `research/catalogo-tecnicas.md` |
| um site real construído com o método | [forja-visual-site](https://github.com/MatheusRibeir098/forja-visual-site) · [ao vivo](https://forja-visual.vercel.app) |

---

## 5. O que NÃO pode ser quebrado

### O `VisualBrief` é contrato congelado

Está na `PLUGIN-SPEC.md` §5. Todas as fases o consomem — questionário, divergência, técnicas,
construção e medição. **Mudar a forma dele quebra tudo de uma vez.** Se precisar mudar, mude a spec
primeiro e propague conscientemente, não de lado.

### A divergência é mecânica, não pedida

Uma skill que diga "gere N direções diferentes" **falha em silêncio** — o agente converge sozinho.
Já aconteceu: no protótipo, três variantes saíram da mesma família visual e ninguém percebeu até o
site estar pronto.

O mecanismo obrigatório: contexto limpo por variante, **ancoradouro distinto e obrigatório**
(luz, material, tipografia, movimento, espaço), proibição de reusar as técnicas das irmãs, e os
números que decidem colisão **medidos do pixel** por `measure-variant.ts` — nunca declarados por
quem construiu a variante.

Dois checks têm correções que **não podem ser desfeitas**:
- **paleta**: tolerância de cor `|Δr|+|Δg|+|Δb| < 24`. Comparação exata de hex aprovava colisão —
  `#101318` e `#111419` são a mesma cor ao olho
- **movimento**: além da razão ≥ 3, exige `motionCoverage ≥ 0,05` em alguma variante. Sem o piso,
  duas páginas praticamente paradas (0,0050 e 0,0166) davam razão 3,3 e "divergiam"

### Técnica, nunca componente (P4)

Se o catálogo começar a descrever "um card com glassmorphism", virou biblioteca de componentes e o
projeto perdeu o sentido. Descreva o **mecanismo** — o que o shader faz, o que o buffer guarda, por
que a conta é essa.

### Os medidores estão validados

`measure-contrast`, `measure-fps`, `measure-bundle`, `measure-variant` foram testados contra
páginas construídas para enganá-los. **Não os "melhore" sem entender o que cada guarda protege.**
Se mexer em `scripts/lib/` compartilhado, confirme que os sete continuam funcionando.

---

## 6. Os scripts

```
measure-bundle.ts       bytes — INFORMA, não reprova (o teto é referência)
measure-contrast.ts     contraste ≥ 7:1 por pixel, ao longo de TODA a animação — reprova
measure-fps.ts          mediana ≥ 60 em GPU real + ms de GPU por quadro — reprova
measure-variant.ts      bgLuminance, motionCoverage, typeScaleRatio, paleta — alimenta a divergência
ingest-asset.ts         processa arquivo do usuário em build time, determinístico
check-attribution.ts    crédito de licença é link real fora de qualquer <section> — reprova
check-structure.ts      seção é pasta, texto é conteúdo, gerado é gerado — reprova
```

Todos: configuração por CLI > `forge-visual.config.json` > `brief.json` > padrão. Códigos de saída
`0` ok · `1` reprovou · `2` medição inválida · `3` **inconclusivo** · `4` nada mensurável.

⚠️ **O código `3` manda isolar a máquina e remedir — nunca cortar efeito.** Ver §7.

---

## 7. Armadilhas medidas — cada uma custou retrabalho real

Estas não são teoria. Cada uma queimou tempo de alguém.

1. **Atenue por cor, nunca por alpha.** Alpha faz a composição convergir para a cor do fundo e o
   contraste não melhora como se espera. Custou duas tarefas.

2. **Medida nova exige validar o ambiente antes de virar critério.** Dois devs gastaram ~20 min
   cada cortando bloom para consertar uma cauda de FPS que era o **Spotify do dono** disputando a
   GPU integrada. A mediana nunca se moveu. → *Se um número não correlaciona com a variável que
   você mexeu, o problema não é a variável.*

3. **Contraste é propriedade de toda a faixa de animação, nunca de um instante.** O medidor antigo
   congelava a página e fotografava uma pose: aprovava com **15,77:1** uma página que ficava com
   **1,13:1** em outro instante do mesmo ciclo.

4. **Texto invisível engana medidor de contraste.** Um parágrafo com `clip-path` fechado media
   "2,86:1" porque o medidor lia ruído de fundo e chamava de tinta.

5. **`display: grid` em `<th>`/`<td>`** tira a célula do layout de tabela: ela empilha como bloco
   solto e as colunas desalinham.

6. **Ray march acima de 8 passos** custa 6× pela **mesma imagem** — acima disso reamostra platô.
   Suba a resolução da textura, não o laço.

7. **O ticker precisa rearmar.** Com a cadeia de quadros interrompida, a seção segue exibindo o
   quadro anterior — de outra seção, com fundo de luminância oposta. Foi a causa real de um
   contraste de 1,13:1 num site publicado. Corrigido no template; o reagendamento em `finally`
   também impede que um inscrito que lança exceção congele o site inteiro.

8. **`git stash` apagou trabalho não commitado de outro dev.** O hook bloqueia escrita por caminho,
   mas **não vê comando git destrutivo**. Nenhum subagente deve rodar `git reset`,
   `git checkout -- <arquivo>`, `git stash` ou `git clean`. Commit é do orquestrador.

---

## 8. Como publicar uma mudança

**Subir a versão em `plugin/.claude-plugin/plugin.json` é parte do trabalho, não um detalhe.**

Isso já mordeu: duas levas de mudanças ficaram publicadas e **inalcançáveis** porque o número não
mudou — o `/plugin update` não oferece atualização quando a versão é a mesma.

```bash
# 1. valide o template em pasta limpa (ele é o que todo site herda)
cp -R plugin/templates/site/. /tmp/check/ && cd /tmp/check
pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm build   # 40 testes

# 2. suba a versão em plugin/.claude-plugin/plugin.json
#    minor para funcionalidade ou mudança de comportamento; patch para correção

# 3. commit e push

# 4. quem usa atualiza com:
#    /plugin marketplace update forja-visual
#    /plugin update forge-visual
```

Para conferir a versão instalada × publicada: `~/.claude/versao-forge-visual.sh`.

---

## 9. O que está pendente

`BACKLOG.md` tem a lista completa com o raciocínio. Os que mais importam:

- **item 8 — o teste que responde a pergunta principal:** rodar a ferramenta num tema
  deliberadamente distante do exemplo, sem briefing à mão. É o que diz se a qualidade generaliza
- **item 3 — bases de orçamento chutadas:** as parcelas de custo são medidas, mas as bases por
  público (1500/900/600/350 KB) e os multiplicadores são calibragem, não medição. É o único lugar
  da ferramenta com ordem de grandeza inventada
- **item 6 — suporte a plataforma:** `findChromeBinary()` só tem caminhos de **Linux**. Em macOS e
  Windows, os dois portões que reprovam não rodam
- **item 7 — proibição sem portão:** texto desenhado dentro do canvas escapa da medição de
  contraste e do `typeScaleRatio`. É proibido pelas guardrails, mas nada verifica

---

## 10. Convenções ao mexer aqui

- **Português do Brasil** em documentação, comentários e mensagens de commit. Código em inglês.
- **Skill é documento denso e específico.** Skill vaga é pior que nenhuma: dá falsa sensação de
  cobertura.
- **Comentário é ativo** (P7). Onde houver decisão não óbvia, escreva o porquê e o número que a
  sustenta — senão o próximo dev "otimiza" de volta.
- **Toda regra nova precisa de portão.** Regra sem verificação é conselho, e conselho é ignorado
  quando aperta o prazo.
- **Ao validar, diga o que NÃO conseguiu testar.** Vale mais que uma alegação inteira.
