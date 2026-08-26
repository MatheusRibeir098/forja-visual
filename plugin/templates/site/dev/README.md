# `dev/` — páginas de inspeção, uma por seção

Páginas servidas pelo `vite dev` em `/dev/<nome>.html` e **fora do build**: é onde uma seção ou
uma variante de hero é olhada isolada, sem o resto do site em volta.

Por que uma por seção: inspecionar uma técnica sozinha é o que torna o diagnóstico barato. No
protótipo 01, `/dev/catalogo.html?check=1` resolveu um bug de alinhamento que a página inteira
escondia — com o site todo em volta, o sintoma se confundia com o da seção vizinha. É também por
essas URLs que o `visual-tester` mede e fotografa.

Convenção — **dois arquivos, o mesmo `<nome>` da pasta da seção**:

| Arquivo           | Conteúdo                                                                        |
| ----------------- | ------------------------------------------------------------------------------- |
| `dev/<nome>.html` | canvas `id="gl"` + o mesmo esqueleto de `<section id="<nome>">` do `index.html` |
| `dev/<nome>.ts`   | cria o engine e monta **só** aquela seção, na ordem de ticker do `src/main.ts`  |

`dev/exemplo.html` + `dev/exemplo.ts` são o molde, e acompanham `src/sections/exemplo/`. Copie os
dois junto com a pasta da seção.

Na fase de divergência cada variante ganha a sua: `dev/a.html`, `dev/b.html`, `dev/c.html`,
montando `src/variants/<id>/index.ts` → `mountHero(root, engine)`.

Estes arquivos são código de verdade: entram no `typecheck` e no `lint` (o `tsconfig.json`
inclui `dev`). Não entram no bundle porque não são entry points do build.
