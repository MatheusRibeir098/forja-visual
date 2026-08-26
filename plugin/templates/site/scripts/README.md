# `scripts/` — build de asset, determinístico

Programas que rodam **antes** do site, na sua máquina ou no CI, e escrevem em
`src/generated/`. Nunca em runtime, nunca dentro de `src/`.

Convenções:

- um script por artefato, nomeado pelo que produz (`build-pointcloud.ts`, `build-atlas.ts`);
- roda com `pnpm exec tsx scripts/<nome>.ts` — `tsconfig.node.json` já inclui esta pasta, então
  eles entram no `typecheck` e no `lint`;
- **determinístico**: rode duas vezes e compare o `sha256`. Semente fixa, ordem de iteração
  estável, nada de `Date.now()` na saída;
- toda saída carrega o marcador `@generated` com o comando que a produziu (ver
  `src/generated/README.md`).

⚠️ Não crie aqui um script `measure`. Os medidores do plugin são invocados por caminho, da raiz
do site — um wrapper local duplica a CLI e envelhece na primeira mudança:

```bash
pnpm exec tsx "${CLAUDE_PLUGIN_ROOT}/scripts/measure-contrast.ts" --project=. --min=7
```

⚠️ Não deixe temporário solto (`_tmp-*.ts`): um arquivo esquecido aqui já quebrou o `typecheck`
do repositório inteiro (TS5097, import com extensão `.ts`) e travou os outros agentes.
