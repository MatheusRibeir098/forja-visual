# `dev/` — páginas de inspeção

Páginas servidas pelo `vite dev` em `/dev/<id>.html` e **fora do build**: é onde uma técnica
ou uma variante de hero é olhada isolada, sem o resto do site em volta.

Convenção: um `dev/<id>.html` mínimo (canvas + um `<div id="root">`) mais um `dev/<id>.ts` que
cria o engine e monta só aquilo. Na fase de divergência, cada variante ganha a sua:
`dev/variant-a.html`, `dev/variant-b.html`, `dev/variant-c.html`, montando
`src/variants/<id>/index.ts` → `mountHero(root, engine)`.

Estes arquivos são código de verdade: entram no `typecheck` e no `lint` (o `tsconfig.json`
inclui `dev`). Não entram no bundle porque não são entry points do build.
