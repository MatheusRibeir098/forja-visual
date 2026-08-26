# `src/content/` — o texto, tipado, fora do markup

Um arquivo por seção: `src/content/<nome>.ts`, com o mesmo `<nome>` da pasta em
`src/sections/<nome>/`. A seção **importa** a cópia e monta o DOM com ela; nunca escreve a frase
dentro do markup.

```ts
// src/content/manifesto.ts
export interface ManifestoCopy {
  readonly title: string;
  readonly paragraphs: readonly string[];
}

export const manifesto: ManifestoCopy = {
  title: '…',
  paragraphs: ['…'],
};
```

Duas coisas caem de graça dessa separação, e são o motivo dela existir:

1. **O texto é revisado sem tocar em código.** Quem escreve a cópia não precisa entender o
   shader que está atrás dela.
2. **A seção pode ser remontada sem reescrever a cópia** — trocar a apresentação deixa de custar
   um copiar-e-colar de parágrafos.

O portão `check-structure.ts` reprova texto visível hardcoded no markup de uma seção
(`textContent = 'frase'`, HTML em template literal com prosa dentro, `aria-label`/`alt`/`title`
literais). Se a string é conteúdo, ela é daqui.

## `index.ts` não é barrel

`src/content/index.ts` guarda o texto que **não pertence a nenhuma seção**: título e descrição do
site, navegação, rodapé, colofão de créditos. Ele não re-exporta os arquivos de seção de
propósito — um barrel obrigaria todos os `visual-dev` em paralelo a editar o mesmo arquivo, que é
exatamente o que esta estrutura existe para evitar. A seção importa `@/content/<nome>` direto.

O colofão fica aqui, e não numa seção, porque **crédito de licença não pode morrer no corte de
uma seção** — é isso que `check-attribution.ts` cobra.

## O que não vai aqui

Marcação (`<p>`, `<strong>`), classe de CSS, caminho de asset e número usado em cálculo. Texto é
texto; se o campo vira `innerHTML`, ele virou markup e voltou ao problema.
