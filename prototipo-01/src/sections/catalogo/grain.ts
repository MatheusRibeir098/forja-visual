import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RedFormat,
  RepeatWrapping,
  UnsignedByteType,
} from 'three';

/**
 * Grão do papel, gerado uma vez na CPU e enviado como textura.
 *
 * Nasceu na variante C do hero e foi promovido para cá quando a técnica I.2
 * virou a seção F5: `src/variants/` é a caixa de areia da divergência e some
 * quando as variantes forem podadas, mas o catálogo depende deste grão em
 * produção. O hero da variante C continua importando daqui.
 *
 * Regra VI.5 do catálogo: padrão vira textura, não ruído por fragment. Um fbm
 * de três oitavas custa ~20 instruções por pixel **por quadro**; esta textura
 * custa uma amostra e é calculada uma vez no boot. A 128² em um canal são 16 KB
 * de VRAM — menos que o custo de um único quadro do fbm equivalente.
 */

/**
 * Lado da textura, em texels. Potência de 2 para os mipmaps saírem exatos; 128
 * é o menor lado em que as três oitavas ainda cabem sem a mais fina virar
 * chuvisco de 1 texel (a oitava fina tem 43 células = ~3 texels por célula).
 */
const GRAIN_SIZE = 128;

/**
 * Oitavas do grão: células por lado e peso de cada uma. Contagens não
 * harmônicas (6/17/43, sem múltiplos comuns) para o padrão não bater consigo
 * mesmo e denunciar o ladrilho. Pesos somam 1 — o resultado já sai em 0–1.
 */
const OCTAVES: ReadonlyArray<{ cells: number; weight: number }> = [
  { cells: 6, weight: 0.5 }, // manchas largas: deformam a borda do bleed
  { cells: 17, weight: 0.32 }, // fibra média
  { cells: 43, weight: 0.18 }, // grão fino do papel
];

/** Semente fixa: a textura precisa ser a mesma em toda máquina e todo build. */
const SEED = 17.0;

/** Faixa final do grão. 0.35–1.0 evita fibra preta, que leria como sujeira. */
const GRAIN_MIN = 0.35;
const GRAIN_MAX = 1;

const BYTE_MAX = 255;

/** Hash determinístico em [0,1). Mesma família do usado na máscara do composite. */
function hash2(x: number, y: number): number {
  const value = Math.sin(x * 127.1 + y * 311.7 + SEED) * 43758.5453123;
  return value - Math.floor(value);
}

/** Curva do `smoothstep` do GLSL: derivada zero nas pontas, sem quinas na célula. */
function smoothstep01(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Value noise que ladrilha: os índices da grade fecham em `cells`, então a
 * borda direita interpola contra a coluna 0. Sem isso, `RepeatWrapping`
 * mostraria uma costura vertical a cada repetição.
 */
function tileableNoise(u: number, v: number, cells: number): number {
  const gx = u * cells;
  const gy = v * cells;
  const x0 = Math.floor(gx) % cells;
  const y0 = Math.floor(gy) % cells;
  const x1 = (x0 + 1) % cells;
  const y1 = (y0 + 1) % cells;
  const fx = smoothstep01(gx - Math.floor(gx));
  const fy = smoothstep01(gy - Math.floor(gy));

  const top = lerp(hash2(x0, y0), hash2(x1, y0), fx);
  const bottom = lerp(hash2(x0, y1), hash2(x1, y1), fx);
  return lerp(top, bottom, fy);
}

/** Textura de grão pronta para `uGrain`. Quem cria também precisa dar `dispose()`. */
export function createPaperGrain(): DataTexture {
  const data = new Uint8Array(GRAIN_SIZE * GRAIN_SIZE);
  const raw = new Float32Array(GRAIN_SIZE * GRAIN_SIZE);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (let y = 0; y < GRAIN_SIZE; y += 1) {
    for (let x = 0; x < GRAIN_SIZE; x += 1) {
      const u = x / GRAIN_SIZE;
      const v = y / GRAIN_SIZE;
      let sum = 0;
      for (const octave of OCTAVES) sum += tileableNoise(u, v, octave.cells) * octave.weight;
      raw[y * GRAIN_SIZE + x] = sum;
      if (sum < min) min = sum;
      if (sum > max) max = sum;
    }
  }

  // Normaliza para a faixa alvo: a soma das oitavas ocupa só o miolo de 0–1 e,
  // sem esticar, o grão sairia lavado demais para deformar coisa alguma.
  const span = max - min || 1;
  for (let i = 0; i < raw.length; i += 1) {
    const normalized = ((raw[i] ?? 0) - min) / span;
    data[i] = Math.round(lerp(GRAIN_MIN, GRAIN_MAX, normalized) * BYTE_MAX);
  }

  const texture = new DataTexture(data, GRAIN_SIZE, GRAIN_SIZE, RedFormat, UnsignedByteType);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  // Minificação com mipmap: o grão é amostrado bem menor que 1:1 nos planos
  // largos, e sem mipmap isso vira aliasing cintilante durante o scroll.
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/** Lado da textura em texels — o plano usa isto para calcular quantas repetições pedir. */
export const PAPER_GRAIN_SIZE = GRAIN_SIZE;
