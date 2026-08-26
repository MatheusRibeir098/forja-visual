# `src/generated/` — produzido por script, nunca editado à mão

Tudo aqui é **saída de programa**: nuvem de pontos de uma malha, imagem reprocessada, tabela
medida, atlas. A fronteira existe por um defeito conhecido — sem ela alguém corrige o sintoma no
arquivo gerado, o próximo build roda e a correção some sem deixar rastro. O bug volta, e agora
sem a pista de que já foi mexido.

Regras, e as três são verificadas por `check-structure.ts`:

1. **Nenhuma edição manual.** Errado aqui? Conserte o **script** em `scripts/` e rode de novo.
2. **Todo arquivo declara a procedência.** Ou ele é um derivado registrado em
   `.forge-visual/assets.json` (gravado por `ingest-asset.ts`, que confere o `sha256`), ou as
   primeiras linhas trazem um comentário com o marcador `@generated` dizendo qual script o
   produziu e com que comando:

   ```ts
   /* @generated por scripts/build-pointcloud.ts — não edite à mão.
      comando: pnpm exec tsx scripts/build-pointcloud.ts */
   ```

3. **Determinismo.** Rodar o script duas vezes dá o mesmo `sha256`. Sem isso o "gerado" vira
   ruído no diff e ninguém consegue revisar.

O asset do usuário entra por `ingest-asset.ts`, em **build time**, e o derivado cai em
`src/generated/assets/` — nunca um loader de malha (`STLLoader`, `OBJLoader`, `GLTFLoader`)
dentro de `src/`. O arquivo **fonte** não entra no repositório do site.

`eslint.config.js` e `.prettierignore` já ignoram esta pasta: código gerado não se formata nem se
linta, formata-se o gerador.
