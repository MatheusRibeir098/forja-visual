# Instruções — repositório `forja-visual`

Este repositório contém o plugin **`forge-visual`**, que constrói sites de alto impacto visual.

## 👉 Leia `HANDOFF.md` antes de mexer em qualquer coisa

Ele responde onde o projeto está, o que não pode ser quebrado, onde achar cada informação, e as
armadilhas que já custaram retrabalho. É curto.

## As quatro que valem repetir aqui

1. **O que tira da média é restrição e rejeição, não incentivo.** Se você escrever "seja criativo"
   ou "capriche" numa skill, apague e troque por uma restrição verificável.

2. **O `VisualBrief` (`PLUGIN-SPEC.md` §5) é contrato congelado.** Todas as fases o consomem.
   Mudar a forma dele quebra tudo de uma vez — mude a spec primeiro, conscientemente.

3. **Subir a versão em `plugin/.claude-plugin/plugin.json` é parte de publicar.** Sem isso, a
   mudança fica no ar e inalcançável: o `/plugin update` não oferece atualização quando o número é
   o mesmo. Já aconteceu duas vezes.

4. **Toda regra nova precisa de portão.** Regra sem verificação é conselho, e conselho é ignorado
   quando aperta o prazo.

## Antes de dar por pronto

```bash
cp -R plugin/templates/site/. /tmp/check/ && cd /tmp/check
pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm build   # 40 testes
```

O template é o que **todo site gerado herda** — se ele quebra, quebra para todo mundo.

## Comandos git proibidos

**Nunca** `git reset`, `git checkout -- <arquivo>`, `git stash` ou `git clean`. O hook de permissão
bloqueia escrita por caminho, mas não vê comando git destrutivo — e um `git stash` já apagou
trabalho não commitado de outro dev neste projeto.

## Idioma

Português do Brasil em documentação, comentários e mensagens de commit. Código em inglês.
