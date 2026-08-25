# Relevo "FORJA" — asset próprio

Gerado por `scripts/build-relief.ts` (técnica IV.1). Não é preset de biblioteca: a palavra
é rasterizada na fonte display do projeto (Instrument Serif) e o heightfield é construído
a partir da máscara das letras.

```bash
pnpm tsx scripts/build-relief.ts
```

O script é determinístico (PRNG com semente fixa): rodar de novo produz bytes idênticos.

## Arquivos

Resolução nativa: **3200×1800** — ~1 texel por pixel de tela na faixa da seção "Relevo"
(2560 px de largura a dpr 2). Os tetos de bytes abaixo são **informativos**: o dono do
projeto suspendeu a regra que reprovava o build por tamanho — o que ainda reprova é
qualidade (60 FPS em GPU real, contraste, WCAG), não byte.

| Arquivo | Formato | Tamanho | Papel |
|---|---|---|---|
| `forja-depth.png` | PNG RGBA 8 bits, 3200×1800 | ~1,3 MB (teto informativo 2000 KB) | altura em 16 bits, empacotada em R+G |
| `forja-albedo.webp` | WebP q0.8, 3200×1800 | ~19 KB (teto informativo 200 KB) | cor base do metal (carvão + desgaste); também lida pelo shader como fonte do segundo gradiente (ver abaixo) |
| `forja-grain.png` | PNG 256×256, seamless | ~55 KB (teto 80) | grão de metal, somado à altura pelo shader. Não escala com a resolução principal — ver comentário de `GRAIN_TILE_SIZE` em `build-relief.ts` |
| `forja-depth-preview.webp` | WebP q0.7, 1280×720 | ~4,6 KB (teto 40) | só para conferência visual, **não** vai para o shader |

Os números exatos de cada geração aparecem no console de `build-relief.ts` e em
`src/generated/measurements.json` (`relief`).

## Packing da altura (`forja-depth.png`)

A altura é um inteiro de 16 bits sem sinal, quebrado em dois canais de 8 bits:
**R = byte alto, G = byte baixo**. B é 0 e A é 255 (constantes — quase de graça depois do
filtro do PNG).

```glsl
// amostre com NEAREST: LINEAR interpola o byte baixo no ponto em que ele estoura
// e produz picos. O campo já foi borrado (3 px a 3200×1800), então NEAREST é liso
// o bastante.
float height = (texel.r * 255.0 * 256.0 + texel.g * 255.0) / 65535.0;
```

Em bytes: `height = (R * 256 + G) / 65535`.

Escala do campo:

- `0.5` — superfície da chapa (altura de referência);
- `~0.15` — fundo da letra cravada;
- entre os dois — a rampa do **bisel**, ~30 px a 3200×1800, produzida borrando a máscara
  das letras (raio 20, 3 passadas de box blur) e remapeando `[0.5, 1] → [0, 1]`.

Traços finos da serifa não chegam ao fundo: o bisel é mais largo que eles. É o
comportamento físico de uma gravação biselada, não um bug.

O raio do blur escala com a resolução do asset (2,5× o raio 8 usado em 1280×720) para
manter a **mesma largura física** de bisel — a mesma fração da chapa, o mesmo ângulo de
~45° que `DEFAULT_HEIGHT_SCALE` em `src/shaders/relight.ts` assume. Subir a resolução sem
escalar o raio junto teria estreitado o bisel de verdade e invalidado essa conta; o ganho
desta geração vem de amostrar a mesma rampa com mais texels (aresta nítida na tela), não
de mudar a geometria.

## Grão (`forja-grain.png`)

Textura **seamless** de 256×256, canal R, `0.5` = neutro. O shader soma:

```glsl
height += (grainTexel.r - 0.5) * 2.0 * 0.02;   // amplitude 0.02
```

### Por que o grão é um arquivo separado

Ele estava embutido no depth. Medido, em 1280×720:

| | `forja-depth.png` |
|---|---|
| grão embutido | **1602 KB** |
| grão removido | **250 KB** |

Uma amplitude de ±0,02 ocupa ±1310 unidades da faixa de 16 bits, então o byte baixo muda
dezenas de unidades entre pixels vizinhos e o PNG não tem mais nada para comprimir. Como o
grão é de baixa frequência, ele vira um tile — continua "textura em vez de procedural em
runtime" (regra VI.5) e a amplitude passa a ser ajustável sem regerar o asset.

## Segundo gradiente (`forja-albedo.webp` como fonte de relevo)

O `forja-albedo.webp` carrega, além da cor, o desgaste (`WEAR_OCTAVES`) e o arranhado do
bisel (`BEVEL_SCRATCH_GAIN`) — variações que **não existem no depth**. O shader
(`src/shaders/relight.ts`) extrai o gradiente do brilho do albedo e funde na normal antes
de normalizar: a luz rasante acende e apaga esses sulcos pintados junto com o bisel real,
sem custo de geometria. Ver `DEFAULT_ALBEDO_RELIEF_STRENGTH` no shader para a medição que
escolheu o ganho.

## Verificação

O script decodifica o próprio PNG que acabou de gerar e compara byte a byte com o campo de
origem. O erro máximo medido é **0** — o packing sobrevive ao encoder do Chrome sem
gerenciamento de cor. O número aparece no output de `build-relief.ts`.
