# `src/sections/` — uma seção, uma pasta

Cada seção do site vive em **`src/sections/<nome>/`** e em mais lugar nenhum. Não é preferência
estética: é o que torna o paralelismo possível. A fase 4 dispara três ou quatro `visual-dev` ao
mesmo tempo e a regra que os mantém vivos é **arquivos disjuntos** — dois devs no mesmo arquivo
significa que o segundo sobrescreve o primeiro. Uma pasta por seção dá interseção vazia sem que
o orquestrador precise negociar caso a caso.

`<nome>` é o mesmo `id` da `<section id="...">` no `index.html` e a mesma chave do `MOUNTS` em
`src/main.ts`. Três nomes iguais, um conceito.

## O que vai dentro

| Arquivo                        | Papel                                                                              | Obrigatório                                 |
| ------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------- |
| `index.ts`                     | exporta `mountSection(root: HTMLElement, engine: Engine)` — a única porta da seção | **sim**                                     |
| `style.css`                    | o CSS **desta** seção, importado pelo `index.ts`                                   | quando há estilo próprio                    |
| `markup.ts`                    | monta o DOM a partir de `@/content/<nome>`                                         | quando o markup passa de umas poucas linhas |
| `scene.ts`                     | a cena WebGL (three) da seção                                                      | só quando ela desenha                       |
| `<algo>.ts` + `<algo>.test.ts` | matemática pura da seção, testável sem navegador                                   | quando existe conta                         |

Tudo isso é **da seção**: um arquivo `.ts` ou `.css` de seção solto em `src/`, em `src/sections/`
ou em `src/styles/` está fora do lugar, e o portão `check-structure.ts` reprova.

## O que **não** vai dentro

- **Texto.** A cópia visível mora em `src/content/<nome>.ts`, tipada. String de conteúdo no
  markup da seção reprova no portão — e o motivo é prático: o texto passa a ser revisável sem
  tocar em código, e a seção pode ser remontada sem reescrever a cópia.
- **Shader reaproveitável.** Se o mecanismo serve a mais de uma seção, ele é `src/shaders/`, um
  arquivo por técnica, nomeado pelo mecanismo. Shader que só existe por causa desta seção pode
  ficar aqui (`shaders.ts` ou `shaders/<algo>.ts`).
- **Token, reset, tipografia.** Isso é `src/styles/`, e é global.
- **Qualquer mudança em `src/engine/`.** O motor vem do template e não se edita: um ajuste ali
  atinge todas as seções ao mesmo tempo. Precisa de algo que o motor não dá? Reporte em
  `pendencias`; a correção pertence ao template do plugin, não a este site.

## O contrato

```ts
import type { Engine } from '@/engine';
import './style.css';

export function mountSection(root: HTMLElement, engine: Engine): void {
  // root é a <section id="<nome>"> que já existe no index.html
}
```

`src/sections/exemplo/` é o molde completo — copie a pasta, renomeie e apague o exemplo. Ele não
está em `MOUNTS`, então não entra no bundle e some do site sem quebrar nada.

Antes da primeira cena, leia **`ENGINE.md`** na raiz e A REGRA DO CANVAS no topo de
`src/main.ts`. Desenhar sem apagar a seção vizinha é a parte que não se adivinha.
