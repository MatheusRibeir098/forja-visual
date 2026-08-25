/**
 * Transforma um `.stl` de crânio na nuvem de pontos + oclusor que a seção
 * "Campo" carrega (técnicas V.1 e V.5).
 *
 *   pnpm tsx scripts/build-points.ts [caminho/do/Skull.stl] [--points=45000] [--tris=8000]
 *
 * ## Origem do modelo — atribuição obrigatória
 *
 * `Skull_martinjario_CC-BY-4.0.stl` — "3D-Schädel eines Menschen", de
 * **martinjario**, licença **CC BY 4.0**.
 * https://commons.wikimedia.org/wiki/File:3D-Sch%C3%A4del_eines_Menschen.stl
 *
 * O `.stl` (1,48 MB, 31.016 triângulos, binário) **nunca é commitado**: vive
 * fora do repositório, por padrão em `~/Downloads/`. O que entra no git são só
 * os dois binários gerados em `public/points/`. O crédito visível ao usuário
 * está em `src/content/campo.ts` e aparece no colofão da seção — a licença
 * exige atribuição no produto, não num comentário de script.
 *
 * ## Determinismo
 *
 * Rodar duas vezes produz bytes idênticos. Todo sorteio passa por um mulberry32
 * de semente fixa (`SEED`); nenhuma iteração depende de ordem de `Set`/`Map`
 * que não seja de inserção; nenhuma aritmética depende de plataforma. Isto não
 * é preciosismo: sem ele, `git diff` acusaria 200 KB de ruído a cada build e o
 * asset deixaria de ser revisável.
 *
 * ## Saída 1 — `public/points/skull-points.bin`
 *
 * Sem cabeçalho, little-endian, **três blocos contíguos de `Int16`**, todos na
 * convenção "normalized" do OpenGL (`v / 32767`, dentro de `[-1, 1]`).
 * `N = byteLength / 14`:
 *
 * | bytes         | conteúdo    | itens | significado                        |
 * | ------------- | ----------- | ----- | ---------------------------------- |
 * | `[0, 6N)`     | `position`  | 3     | esfera de raio 1, centrada em 0    |
 * | `[6N, 12N)`   | `normal`    | 3     | normal de superfície, unitária     |
 * | `[12N, 14N)`  | `curvature` | 1     | +1 fundo de fenda … −1 crista      |
 *
 * O runtime abre três `Int16Array` sobre o **mesmo** `ArrayBuffer` e entrega ao
 * three com `normalized: true`. **Não existe passe de decode**: a GPU divide
 * por 32767 na busca de atributo, de graça, e o vertex shader multiplica a
 * posição por `uRadius`. É a técnica V.5 do catálogo.
 *
 * Precisão não é problema: com ~45k pontos numa esfera de raio 1 os vizinhos
 * ficam a ~0,026 de distância e o quantum do `Int16` é 0,00003 — quase mil
 * vezes mais fino que o espaçamento.
 *
 * ### Ordem embaralhada de propósito
 *
 * O array é embaralhado (Fisher-Yates com a mesma semente) antes de gravar, e
 * por isso **qualquer prefixo é uma amostra uniforme do todo**. Escalar a nuvem
 * por tier vira um `setDrawRange`, sem segundo arquivo e sem segundo buffer.
 *
 * ## Saída 2 — `public/points/skull-hull.bin` (o oclusor, técnica V.1)
 *
 * Sprites aditivos com `depthWrite: false` não se ocluem: o lado de trás soma
 * através do da frente e o meio da silhueta vira a região mais clara e menos
 * estruturada do quadro. A correção é uma malha decimada e **invisível** do
 * mesmo crânio, desenhada antes com `colorWrite: false` + `depthWrite: true`.
 * O `depthTest` normal da nuvem então descarta os pontos atrás dela — este
 * script mede a fração descartada e a imprime ao final.
 *
 * ### Layout — little-endian, cabeçalho de 16 bytes, depois dois blocos
 *
 * | bytes                | tipo     | conteúdo                               |
 * | -------------------- | -------- | -------------------------------------- |
 * | `[0, 4)`             | ASCII    | magic `FHUL`                           |
 * | `[4, 6)`             | `Uint16` | versão do formato (1)                  |
 * | `[6, 8)`             | `Uint16` | reservado, sempre 0                    |
 * | `[8, 12)`            | `Uint32` | `V` — número de vértices               |
 * | `[12, 16)`           | `Uint32` | `I` — número de índices (3 por triân.) |
 * | `[16, 16+6V)`        | `Int16`  | posições, mesma convenção normalizada  |
 * | `[16+6V, 16+6V+2I)`  | `Uint16` | índices dos triângulos                 |
 *
 * O cabeçalho existe aqui e não no arquivo de pontos porque lá há um bloco só e
 * o comprimento se divide sozinho; aqui há dois, e adivinhar onde o segundo
 * começa a partir de um total de bytes é o tipo de contrato que quebra em
 * silêncio. `V` é validado contra o teto de `Uint16` para o bloco de índices
 * poder ficar em 16 bits.
 *
 * ### Por que decimação por agrupamento em grade
 *
 * A malha nunca é vista. Ela precisa da **silhueta** certa e da
 * **profundidade** certa, e de mais nada — sem uv, sem normal no payload, sem
 * preservar quina. Então vale o clássico barato: encaixa cada vértice numa
 * grade grossa, troca cada célula ocupada pelo centroide do que caiu nela, e
 * mantém os triângulos cujos três cantos caíram em três células diferentes.
 *
 * ### Por que o oclusor é *encolhido*
 *
 * Uma decimação corta pelo meio das próprias reentrâncias: a célula é mais
 * larga que uma órbita ocular ou que a fenda entre os dentes, e o
 * representante assenta entre a crista e o fundo. Usada como está, essa
 * superfície ocluiria justamente a anatomia que a nuvem existe para mostrar.
 * Por isso o casco é empurrado **para dentro pelas próprias normais**, pelo
 * resíduo medido da decimação (percentil 95 do quanto um vértice de origem
 * sobra para fora do seu representante) mais uma margem fixa.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { PROJECT_ROOT } from './lib/chrome';

const DEFAULT_SOURCE = join(homedir(), 'Downloads', 'Skull_martinjario_CC-BY-4.0.stl');
const OUT_DIR = resolve(PROJECT_ROOT, 'public/points');
const POINTS_PATH = join(OUT_DIR, 'skull-points.bin');
const HULL_PATH = join(OUT_DIR, 'skull-hull.bin');

/**
 * Semente única de todo sorteio do script. Trocar este número muda **todos** os
 * bytes gerados — é o que torna a saída reproduzível, não um detalhe de estilo.
 */
const SEED = 0x5c_a1_ab_1e;

/**
 * Pontos gravados no arquivo.
 *
 * Escolhido pela medição, não pelo gosto — mas o gosto mudou de dono: o teto de
 * assets lazy da spec (§6) foi suspenso e 600 KB gzip virou número informativo,
 * não critério de reprovação. A 14 bytes por ponto — e `Int16` de posição é
 * praticamente incompressível, então o gzip devolve quase o tamanho cru —
 * 45.000 pontos medem **610,8 KB** e o oclusor **62,2 KB**: 673,0 KB o par.
 *
 * O que 45k compram: o depth prepass descarta ~53,7% da nuvem (medido abaixo),
 * então ~21k pontos chegam à face visível. Numa silhueta de ~530 px de altura
 * isso dá um vizinho a cada ~2,5 px — a densidade em que a órbita, o arco
 * zigomático e a linha da mandíbula deixam de ser inferidos e passam a ser
 * desenhados. A 12.000 pontos (~5,7k visíveis, ~5 px de vizinho) a nuvem lia
 * como *sugestão* de crânio; a 3,75× mais pontos ela lê como superfície.
 */
const DEFAULT_TARGET_POINTS = 45_000;

/**
 * Triângulos alvo do oclusor.
 *
 * A malha é invisível: a única coisa que ela precisa acertar é **onde a
 * superfície próxima está**. Abaixo de ~2,5k a silhueta começa a cortar o arco
 * zigomático e o queixo. A nuvem subiu de 12k para 45k pontos — a 45k, um
 * vizinho a cada ~2,5 px expõe erro de silhueta que 4.200 triângulos
 * perdoavam a 12k; a grade fica visível como faceta na borda da mandíbula e
 * do zigomático. 8.000 dobra a resolução da grade de decimação (medido
 * abaixo: reduz o encolhimento necessário de 4,0% para 3,2% do raio, e o
 * piso de auto-oclusão real cai de 19,6% para 18,8% — a malha mais fina erra
 * menos, então precisa comer menos anatomia para compensar) e custa 62,2 KB.
 */
const DEFAULT_TARGET_TRIANGLES = 8_000;

/** Magic, versão e tamanho do cabeçalho de `skull-hull.bin`. Tabela acima. */
const HULL_MAGIC = 'FHUL';
const HULL_VERSION = 1;
const HULL_HEADER_BYTES = 16;
/** O bloco de índices é `Uint16`, então a contagem de vértices tem que caber num. */
const HULL_MAX_VERTICES = 65_535;

/**
 * Teto de células ocupadas na decimação. 2^17 porque a chave canônica de um
 * triângulo empacota três índices de célula em 51 bits, que é o que um `number`
 * representa exatamente. O crânio soldado tem ~15k vértices, então a folga é de
 * quase uma ordem de grandeza.
 */
const MAX_CELLS = 131_072;

/** Busca da resolução da grade de agrupamento, em células no eixo mais longo. */
const MIN_HULL_RESOLUTION = 4;
const MAX_HULL_RESOLUTION = 96;

/**
 * Percentil do resíduo da decimação usado como distância de encolhimento.
 *
 * Não o máximo: uns poucos vértices na borda do corte do forame magno sobram
 * várias vezes mais que qualquer coisa na calota, e encolher por *aquilo*
 * puxaria o oclusor tão para dentro que o lado de trás voltaria a aparecer
 * pela silhueta.
 */
const HULL_RESIDUAL_PERCENTILE = 0.95;

/**
 * Margem somada ao resíduo medido, em raios normalizados.
 *
 * Paga o que o resíduo não enxerga: a quantização `Int16` das duas malhas e o
 * fato de os pontos serem amostras de superfície interpoladas, não vértices do
 * mesmo conjunto que gerou os representantes.
 *
 * 0,018 é o mesmo valor do catálogo (V.1), e continua sendo o certo depois de
 * subir a nuvem para 45k pontos e o oclusor para 8k triângulos — mas isso não
 * é suposição, é nova varredura, porque a malha mais fina muda o resíduo que a
 * margem paga por cima. Re-varrido de 0,015 a 0,020 neste crânio (faixa mais
 * estreita que a original: com o dobro de resolução de grade, o mínimo já
 * estava óbvio perto do valor antigo), com `frontFacingDiscarded` como juiz:
 *
 * | margem | encolhimento | descarte total | frente engolida |
 * | ------ | ------------ | -------------- | --------------- |
 * | 0,015  | 2,7%         | 54,3%          | 18,9%           |
 * | 0,016  | 2,9%         | 54,0%          | 18,9%           |
 * | 0,017  | 3,1%         | 53,9%          | 18,8%           |
 * | 0,018  | **3,2%**     | 53,7%          | **18,8%**       |
 * | 0,019  | 3,4%         | 53,5%          | 18,8%           |
 * | 0,020  | 3,6%         | 53,4%          | 18,8%           |
 *
 * Duas leituras importantes. Primeiro, a coluna da direita continua **não se
 * mexendo** dentro da faixa varrida — mesmo diagnóstico do catálogo: o que
 * sobra de auto-oclusão real (dentes atrás do arco zigomático, fundo da órbita
 * atrás da sobrancelha, fossa temporal) não depende da margem, só a fração de
 * anatomia comida pelo casco dependeria, e ela não se move. Segundo, o piso
 * **caiu** de 19,6% (catálogo, 4.200 triângulos) para 18,8% (8.000
 * triângulos): a malha mais fina erra menos, então precisa comer menos
 * anatomia real para compensar o próprio erro — o oclusor de mais resolução é
 * estritamente melhor, não só mais preciso na silhueta. O encolhimento total
 * caiu de 4,0% para 3,2% do raio pelo mesmo motivo: menos erro de decimação
 * para o resíduo pagar.
 */
const HULL_SHRINK_MARGIN = 0.018;

/** Raio ao qual tudo é normalizado; o vertex shader escala a partir daqui. */
const NORMALISED_RADIUS = 1;

/** Maior valor de um `Int16` "normalized" — a GPU divide por ele no fetch. */
const INT16_MAX = 32_767;

/** Bytes por ponto: 3 posições + 3 normais + 1 curvatura, todos `Int16`. */
const BYTES_PER_POINT = 14;

/** Nível do gzip usado nos relatórios — o mesmo do `measure-bundle.ts`. */
const GZIP_LEVEL = 9;

/**
 * Tolerância da soldagem de vértices, como fração da maior aresta da caixa.
 * 1e-5 ≈ 2 µm na escala do crânio: junta as cópias que o STL grava por
 * triângulo sem fundir duas superfícies distintas.
 */
const WELD_EPSILON_FRACTION = 1e-5;

/**
 * Percentil usado para normalizar a curvatura.
 *
 * A curvatura crua tem cauda longa (a borda do corte da mandíbula, o interior
 * das órbitas), e dividir pelo máximo achataria a superfície inteira em torno
 * de zero. Dividir pelo percentil 95 e clampar mantém a faixa útil ocupando o
 * `Int16` inteiro.
 */
const CURVATURE_PERCENTILE = 0.95;

// ---------------------------------------------------------------------------
// Medição de oclusão — um z-buffer em software, igual ao que a GPU faz
// ---------------------------------------------------------------------------

/** Lado do buffer de profundidade da medição, em pixels. */
const OCCLUSION_RASTER_SIZE = 512;

/** Mesmo fov da câmera do protótipo inteiro. */
const CAMERA_FOV_DEG = 50;

/**
 * Distância da câmera na medição, em raios. 3,2 enquadra a esfera unitária com
 * folga num fov de 50°, que é o enquadramento da seção.
 */
const CAMERA_DISTANCE = 3.2;

/**
 * Poses varridas na medição: a coreografia da seção gira o crânio em torno do
 * eixo vertical, com uma inclinação fixa. 24 passos = um a cada 15°.
 */
const OCCLUSION_YAW_STEPS = 24;
const OCCLUSION_PITCH_RAD = -0.12;

// ---------------------------------------------------------------------------
// Sorteio determinístico
// ---------------------------------------------------------------------------

/**
 * mulberry32 — 32 bits de estado, período 2³², distribuição plana o bastante
 * para amostragem de superfície. `Math.random()` sem semente está proibido aqui
 * pelo motivo do cabeçalho: a saída tem que ser byte a byte reproduzível.
 */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

// ---------------------------------------------------------------------------
// Leitura do STL
// ---------------------------------------------------------------------------

const STL_HEADER_BYTES = 80;
const STL_TRIANGLE_BYTES = 50;
/** Offset do primeiro vértice dentro do registro: pula a normal gravada. */
const STL_VERTEX_OFFSET = 12;

/** Nove floats por triângulo, na ordem em que o arquivo os guarda. */
function readBinaryStl(path: string): Float32Array {
  const file = readFileSync(path);
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  if (file.byteLength < STL_HEADER_BYTES + 4) {
    throw new Error(`${path}: pequeno demais para ser um STL binário`);
  }
  const triangleCount = view.getUint32(STL_HEADER_BYTES, true);
  const expected = STL_HEADER_BYTES + 4 + triangleCount * STL_TRIANGLE_BYTES;
  if (expected !== file.byteLength) {
    // STL ASCII e STL binário truncado caem os dois aqui, e é bom que caiam: o
    // parser abaixo leria lixo como geometria e o erro só apareceria na tela.
    throw new Error(
      `${path}: não é um STL binário íntegro (cabeçalho diz ${triangleCount} triângulos, ` +
        `o que exigiria ${expected} bytes; o arquivo tem ${file.byteLength})`,
    );
  }

  const vertices = new Float32Array(triangleCount * 9);
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const base = STL_HEADER_BYTES + 4 + triangle * STL_TRIANGLE_BYTES + STL_VERTEX_OFFSET;
    for (let component = 0; component < 9; component += 1) {
      vertices[triangle * 9 + component] = view.getFloat32(base + component * 4, true);
    }
  }
  return vertices;
}

// ---------------------------------------------------------------------------
// Malha soldada
// ---------------------------------------------------------------------------

interface IndexedMesh {
  /** 3 floats por vértice. */
  positions: Float32Array;
  /** 3 índices por triângulo. */
  indices: Uint32Array;
}

/**
 * Junta os vértices que o STL repete por triângulo.
 *
 * Sem isto não existe normal suave nem adjacência: o formato grava cada canto
 * três vezes e a nuvem herdaria a facetagem da malha de origem — que é
 * exatamente o que a amostragem por área existe para evitar.
 */
function weldVertices(triangleVertices: Float32Array, epsilon: number): IndexedMesh {
  const cornerCount = triangleVertices.length / 3;
  const lookup = new Map<string, number>();
  const positions: number[] = [];
  const indices = new Uint32Array(cornerCount);
  const inverseEpsilon = 1 / epsilon;

  for (let corner = 0; corner < cornerCount; corner += 1) {
    const x = triangleVertices[corner * 3] ?? 0;
    const y = triangleVertices[corner * 3 + 1] ?? 0;
    const z = triangleVertices[corner * 3 + 2] ?? 0;
    const key = `${Math.round(x * inverseEpsilon)},${Math.round(y * inverseEpsilon)},${Math.round(
      z * inverseEpsilon,
    )}`;
    let index = lookup.get(key);
    if (index === undefined) {
      index = positions.length / 3;
      lookup.set(key, index);
      positions.push(x, y, z);
    }
    indices[corner] = index;
  }

  return { positions: Float32Array.from(positions), indices };
}

/**
 * Volume com sinal da malha fechada. Negativo significa winding para dentro —
 * e um modelo invertido produziria normais apontando para o miolo do crânio,
 * o que apagaria a leitura de superfície da nuvem inteira.
 */
function signedVolume(mesh: IndexedMesh): number {
  const { positions, indices } = mesh;
  let total = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = (indices[i] ?? 0) * 3;
    const b = (indices[i + 1] ?? 0) * 3;
    const c = (indices[i + 2] ?? 0) * 3;
    const ax = positions[a] ?? 0;
    const ay = positions[a + 1] ?? 0;
    const az = positions[a + 2] ?? 0;
    const bx = positions[b] ?? 0;
    const by = positions[b + 1] ?? 0;
    const bz = positions[b + 2] ?? 0;
    const cx = positions[c] ?? 0;
    const cy = positions[c + 1] ?? 0;
    const cz = positions[c + 2] ?? 0;
    total +=
      (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
  }
  return total;
}

/** Inverte a orientação de todos os triângulos, no lugar. */
function flipWinding(mesh: IndexedMesh): void {
  const { indices } = mesh;
  for (let i = 0; i < indices.length; i += 3) {
    const swap = indices[i + 1] ?? 0;
    indices[i + 1] = indices[i + 2] ?? 0;
    indices[i + 2] = swap;
  }
}

/**
 * Normais por vértice, ponderadas por área.
 *
 * A ponderação sai de graça: o produto vetorial de duas arestas já tem
 * comprimento igual ao dobro da área do triângulo, então acumular o vetor cru
 * (sem normalizar antes) é a média ponderada correta.
 */
function computeVertexNormals(mesh: IndexedMesh): Float32Array {
  const { positions, indices } = mesh;
  const normals = new Float32Array(positions.length);

  for (let i = 0; i < indices.length; i += 3) {
    const a = (indices[i] ?? 0) * 3;
    const b = (indices[i + 1] ?? 0) * 3;
    const c = (indices[i + 2] ?? 0) * 3;
    const e1x = (positions[b] ?? 0) - (positions[a] ?? 0);
    const e1y = (positions[b + 1] ?? 0) - (positions[a + 1] ?? 0);
    const e1z = (positions[b + 2] ?? 0) - (positions[a + 2] ?? 0);
    const e2x = (positions[c] ?? 0) - (positions[a] ?? 0);
    const e2y = (positions[c + 1] ?? 0) - (positions[a + 1] ?? 0);
    const e2z = (positions[c + 2] ?? 0) - (positions[a + 2] ?? 0);
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    for (const offset of [a, b, c]) {
      normals[offset] = (normals[offset] ?? 0) + nx;
      normals[offset + 1] = (normals[offset + 1] ?? 0) + ny;
      normals[offset + 2] = (normals[offset + 2] ?? 0) + nz;
    }
  }

  for (let i = 0; i < normals.length; i += 3) {
    const x = normals[i] ?? 0;
    const y = normals[i + 1] ?? 0;
    const z = normals[i + 2] ?? 0;
    const length = Math.hypot(x, y, z);
    if (length > 0) {
      normals[i] = x / length;
      normals[i + 1] = y / length;
      normals[i + 2] = z / length;
    } else {
      // Vértice isolado: qualquer direção serve, e (0,1,0) não explode nada
      // no shader. Não normalizar deixaria um NaN entrar no buffer.
      normals[i + 1] = 1;
    }
  }
  return normals;
}

/** Lista de adjacência em CSR — dois arrays, zero objetos por vértice. */
interface Adjacency {
  offsets: Uint32Array;
  neighbours: Uint32Array;
}

function buildAdjacency(mesh: IndexedMesh): Adjacency {
  const vertexCount = mesh.positions.length / 3;
  const { indices } = mesh;
  const degrees = new Uint32Array(vertexCount);

  const edges: Array<[number, number]> = [];
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] ?? 0;
    const b = indices[i + 1] ?? 0;
    const c = indices[i + 2] ?? 0;
    edges.push([a, b], [b, c], [c, a], [b, a], [c, b], [a, c]);
  }
  for (const [from] of edges) degrees[from] = (degrees[from] ?? 0) + 1;

  const offsets = new Uint32Array(vertexCount + 1);
  let running = 0;
  for (let v = 0; v < vertexCount; v += 1) {
    offsets[v] = running;
    running += degrees[v] ?? 0;
  }
  offsets[vertexCount] = running;

  const cursor = Uint32Array.from(offsets.subarray(0, vertexCount));
  const neighbours = new Uint32Array(running);
  for (const [from, to] of edges) {
    const slot = cursor[from] ?? 0;
    neighbours[slot] = to;
    cursor[from] = slot + 1;
  }

  return { offsets, neighbours };
}

/**
 * Curvatura com sinal por vértice: **+1 no fundo de uma fenda, −1 numa crista**.
 *
 * A conta é a média, sobre os vizinhos, de `dot(n, normalize(vizinho − v))`.
 * Se os vizinhos estão à frente do plano tangente, a superfície fecha em torno
 * do vértice (côncavo: sutura, órbita, fenda entre dentes); se estão atrás, ela
 * abre (convexo: calota, zigomático, arcada). É esse sinal que dá à nuvem a
 * informação que separa um crânio de um ovoide de pontos.
 */
function computeCurvature(mesh: IndexedMesh, normals: Float32Array): Float32Array {
  const { positions } = mesh;
  const adjacency = buildAdjacency(mesh);
  const vertexCount = positions.length / 3;
  const raw = new Float32Array(vertexCount);

  for (let v = 0; v < vertexCount; v += 1) {
    const start = adjacency.offsets[v] ?? 0;
    const end = adjacency.offsets[v + 1] ?? 0;
    if (end === start) continue;
    const px = positions[v * 3] ?? 0;
    const py = positions[v * 3 + 1] ?? 0;
    const pz = positions[v * 3 + 2] ?? 0;
    const nx = normals[v * 3] ?? 0;
    const ny = normals[v * 3 + 1] ?? 0;
    const nz = normals[v * 3 + 2] ?? 0;

    let sum = 0;
    for (let slot = start; slot < end; slot += 1) {
      const other = (adjacency.neighbours[slot] ?? 0) * 3;
      const dx = (positions[other] ?? 0) - px;
      const dy = (positions[other + 1] ?? 0) - py;
      const dz = (positions[other + 2] ?? 0) - pz;
      const length = Math.hypot(dx, dy, dz);
      if (length === 0) continue;
      sum += (dx * nx + dy * ny + dz * nz) / length;
    }
    raw[v] = sum / (end - start);
  }

  const scale = 1 / Math.max(percentile(absolute(raw), CURVATURE_PERCENTILE), 1e-6);
  const curvature = new Float32Array(vertexCount);
  for (let v = 0; v < vertexCount; v += 1) {
    curvature[v] = clamp((raw[v] ?? 0) * scale, -1, 1);
  }
  return curvature;
}

function absolute(values: Float32Array): Float32Array {
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i += 1) out[i] = Math.abs(values[i] ?? 0);
  return out;
}

/** Percentil de uma cópia ordenada. `ratio` em 0–1. */
function percentile(values: Float32Array, ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = Float32Array.from(values).sort();
  const index = Math.min(sorted.length - 1, Math.floor(ratio * (sorted.length - 1)));
  return sorted[index] ?? 0;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Centra na caixa e escala para a esfera de raio 1. O runtime multiplica por
 * `uRadius`, então a escala real da cena não vive no arquivo.
 */
function normaliseToUnitSphere(mesh: IndexedMesh): void {
  const { positions } = mesh;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] ?? 0;
    const y = positions[i + 1] ?? 0;
    const z = positions[i + 2] ?? 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const centreX = (minX + maxX) / 2;
  const centreY = (minY + maxY) / 2;
  const centreZ = (minZ + maxZ) / 2;

  let maxRadius = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const radius = Math.hypot(
      (positions[i] ?? 0) - centreX,
      (positions[i + 1] ?? 0) - centreY,
      (positions[i + 2] ?? 0) - centreZ,
    );
    if (radius > maxRadius) maxRadius = radius;
  }
  const scale = maxRadius > 0 ? NORMALISED_RADIUS / maxRadius : 1;

  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = ((positions[i] ?? 0) - centreX) * scale;
    positions[i + 1] = ((positions[i + 1] ?? 0) - centreY) * scale;
    positions[i + 2] = ((positions[i + 2] ?? 0) - centreZ) * scale;
  }
}

// ---------------------------------------------------------------------------
// Amostragem por área
// ---------------------------------------------------------------------------

interface PointCloud {
  positions: Float32Array;
  normals: Float32Array;
  curvature: Float32Array;
  count: number;
}

/** Áreas acumuladas por triângulo — a tabela do sorteio proporcional. */
function cumulativeAreas(mesh: IndexedMesh): Float64Array {
  const { positions, indices } = mesh;
  const triangleCount = indices.length / 3;
  const cumulative = new Float64Array(triangleCount);
  let running = 0;
  for (let t = 0; t < triangleCount; t += 1) {
    const a = (indices[t * 3] ?? 0) * 3;
    const b = (indices[t * 3 + 1] ?? 0) * 3;
    const c = (indices[t * 3 + 2] ?? 0) * 3;
    const e1x = (positions[b] ?? 0) - (positions[a] ?? 0);
    const e1y = (positions[b + 1] ?? 0) - (positions[a + 1] ?? 0);
    const e1z = (positions[b + 2] ?? 0) - (positions[a + 2] ?? 0);
    const e2x = (positions[c] ?? 0) - (positions[a] ?? 0);
    const e2y = (positions[c + 1] ?? 0) - (positions[a + 1] ?? 0);
    const e2z = (positions[c + 2] ?? 0) - (positions[a + 2] ?? 0);
    const area =
      Math.hypot(e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x) / 2;
    running += area;
    cumulative[t] = running;
  }
  return cumulative;
}

/** Menor índice cujo acumulado é >= alvo. */
function pickTriangle(cumulative: Float64Array, target: number): number {
  let low = 0;
  let high = cumulative.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((cumulative[middle] ?? 0) < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * Amostra `count` pontos **proporcionalmente à área das faces**, com posição
 * uniforme dentro de cada uma via coordenadas baricêntricas.
 *
 * Iterar sobre vértices seria mais simples e estaria errado: a malha do crânio
 * tem faces enormes na calota e minúsculas nos dentes, então a nuvem herdaria a
 * densidade irregular do modelo e ficaria visivelmente facetada — lisa onde a
 * anatomia é lisa e empelotada onde ela é detalhada, que é o inverso do que se
 * quer.
 */
function sampleSurface(
  mesh: IndexedMesh,
  normals: Float32Array,
  curvature: Float32Array,
  cumulative: Float64Array,
  count: number,
  random: () => number,
): PointCloud {
  const { positions, indices } = mesh;
  const totalArea = cumulative[cumulative.length - 1] ?? 0;
  const outPositions = new Float32Array(count * 3);
  const outNormals = new Float32Array(count * 3);
  const outCurvature = new Float32Array(count);

  for (let i = 0; i < count; i += 1) {
    const triangle = pickTriangle(cumulative, random() * totalArea);
    const ia = indices[triangle * 3] ?? 0;
    const ib = indices[triangle * 3 + 1] ?? 0;
    const ic = indices[triangle * 3 + 2] ?? 0;

    // Dobrar o quadrado unitário sobre a diagonal é o que torna (u, v)
    // uniforme dentro do triângulo em vez de concentrado num canto.
    let u = random();
    let v = random();
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v;
    }
    const w = 1 - u - v;

    for (let axis = 0; axis < 3; axis += 1) {
      outPositions[i * 3 + axis] =
        (positions[ia * 3 + axis] ?? 0) * w +
        (positions[ib * 3 + axis] ?? 0) * u +
        (positions[ic * 3 + axis] ?? 0) * v;
      outNormals[i * 3 + axis] =
        (normals[ia * 3 + axis] ?? 0) * w +
        (normals[ib * 3 + axis] ?? 0) * u +
        (normals[ic * 3 + axis] ?? 0) * v;
    }
    const nx = outNormals[i * 3] ?? 0;
    const ny = outNormals[i * 3 + 1] ?? 0;
    const nz = outNormals[i * 3 + 2] ?? 0;
    const length = Math.hypot(nx, ny, nz) || 1;
    outNormals[i * 3] = nx / length;
    outNormals[i * 3 + 1] = ny / length;
    outNormals[i * 3 + 2] = nz / length;

    outCurvature[i] =
      (curvature[ia] ?? 0) * w + (curvature[ib] ?? 0) * u + (curvature[ic] ?? 0) * v;
  }

  return { positions: outPositions, normals: outNormals, curvature: outCurvature, count };
}

/**
 * Fisher-Yates com a semente do script. Depois disto qualquer prefixo do array
 * é uma amostra uniforme do crânio inteiro, e escalar por tier vira um
 * `setDrawRange` — sem segundo arquivo, sem segundo buffer.
 */
function shuffleCloud(cloud: PointCloud, random: () => number): void {
  for (let i = cloud.count - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    for (let axis = 0; axis < 3; axis += 1) {
      swapFloat(cloud.positions, i * 3 + axis, j * 3 + axis);
      swapFloat(cloud.normals, i * 3 + axis, j * 3 + axis);
    }
    swapFloat(cloud.curvature, i, j);
  }
}

function swapFloat(array: Float32Array, a: number, b: number): void {
  const temp = array[a] ?? 0;
  array[a] = array[b] ?? 0;
  array[b] = temp;
}

// ---------------------------------------------------------------------------
// Oclusor
// ---------------------------------------------------------------------------

interface Hull {
  positions: Float32Array;
  indices: Uint32Array;
  resolution: number;
  shrink: number;
}

/** Agrupa por célula e devolve o índice da célula de cada vértice de origem. */
function assignCells(positions: Float32Array, resolution: number): Int32Array {
  const cellSize = (2 * NORMALISED_RADIUS) / resolution;
  const vertexCount = positions.length / 3;
  const cells = new Int32Array(vertexCount);
  const lookup = new Map<number, number>();
  // Chave inteira em vez de string: são dezenas de milhares de vértices e a
  // busca acontece de novo a cada resolução testada.
  const stride = resolution + 2;
  for (let v = 0; v < vertexCount; v += 1) {
    const ix = Math.floor(((positions[v * 3] ?? 0) + NORMALISED_RADIUS) / cellSize);
    const iy = Math.floor(((positions[v * 3 + 1] ?? 0) + NORMALISED_RADIUS) / cellSize);
    const iz = Math.floor(((positions[v * 3 + 2] ?? 0) + NORMALISED_RADIUS) / cellSize);
    const key = (ix * stride + iy) * stride + iz;
    let cell = lookup.get(key);
    if (cell === undefined) {
      cell = lookup.size;
      lookup.set(key, cell);
    }
    cells[v] = cell;
  }
  return cells;
}

interface Decimation {
  representatives: Float32Array;
  indices: Uint32Array;
  cells: Int32Array;
}

/** Uma passada de decimação numa dada resolução de grade. */
function decimate(mesh: IndexedMesh, resolution: number): Decimation {
  const cells = assignCells(mesh.positions, resolution);
  let cellCount = 0;
  for (let v = 0; v < cells.length; v += 1)
    cellCount = Math.max(cellCount, (cells[v] ?? 0) + 1);

  const sums = new Float64Array(cellCount * 3);
  const counts = new Uint32Array(cellCount);
  for (let v = 0; v < cells.length; v += 1) {
    const cell = cells[v] ?? 0;
    sums[cell * 3] = (sums[cell * 3] ?? 0) + (mesh.positions[v * 3] ?? 0);
    sums[cell * 3 + 1] = (sums[cell * 3 + 1] ?? 0) + (mesh.positions[v * 3 + 1] ?? 0);
    sums[cell * 3 + 2] = (sums[cell * 3 + 2] ?? 0) + (mesh.positions[v * 3 + 2] ?? 0);
    counts[cell] = (counts[cell] ?? 0) + 1;
  }

  const representatives = new Float32Array(cellCount * 3);
  for (let cell = 0; cell < cellCount; cell += 1) {
    const n = counts[cell] ?? 1;
    representatives[cell * 3] = (sums[cell * 3] ?? 0) / n;
    representatives[cell * 3 + 1] = (sums[cell * 3 + 1] ?? 0) / n;
    representatives[cell * 3 + 2] = (sums[cell * 3 + 2] ?? 0) / n;
  }

  if (cellCount > MAX_CELLS) {
    throw new Error(`decimação gerou ${cellCount} células: a chave canônica não comporta`);
  }

  // Um `Set` de chaves canônicas mata as faces que colapsaram uma sobre a
  // outra: sem isso a mesma superfície é desenhada várias vezes e a contagem de
  // triângulos deixa de descrever o custo. A chave é numérica (três índices de
  // 17 bits empacotados em 51) porque esta varredura roda uma vez por
  // resolução testada, e concatenar strings aqui dominaria o tempo do script.
  const seen = new Set<number>();
  const kept: number[] = [];
  const source = mesh.indices;
  const triple = [0, 0, 0];
  for (let i = 0; i < source.length; i += 3) {
    const a = cells[source[i] ?? 0] ?? 0;
    const b = cells[source[i + 1] ?? 0] ?? 0;
    const c = cells[source[i + 2] ?? 0] ?? 0;
    if (a === b || b === c || a === c) continue;
    triple[0] = a;
    triple[1] = b;
    triple[2] = c;
    triple.sort((x, y) => x - y);
    const canonical =
      (triple[0] ?? 0) * MAX_CELLS * MAX_CELLS +
      (triple[1] ?? 0) * MAX_CELLS +
      (triple[2] ?? 0);
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    kept.push(a, b, c);
  }

  return { representatives, indices: Uint32Array.from(kept), cells };
}

interface Compacted {
  mesh: IndexedMesh;
  /** Célula da grade -> índice do vértice no casco. Usado para medir o resíduo. */
  cellToVertex: Map<number, number>;
}

/** Remove as células que nenhum triângulo sobrevivente usa e reindexa. */
function compact(decimation: Decimation): Compacted {
  const cellToVertex = new Map<number, number>();
  const positions: number[] = [];
  const indices = new Uint32Array(decimation.indices.length);
  for (let i = 0; i < decimation.indices.length; i += 1) {
    const cell = decimation.indices[i] ?? 0;
    let index = cellToVertex.get(cell);
    if (index === undefined) {
      index = positions.length / 3;
      cellToVertex.set(cell, index);
      positions.push(
        decimation.representatives[cell * 3] ?? 0,
        decimation.representatives[cell * 3 + 1] ?? 0,
        decimation.representatives[cell * 3 + 2] ?? 0,
      );
    }
    indices[i] = index;
  }
  return { mesh: { positions: Float32Array.from(positions), indices }, cellToVertex };
}

/**
 * Constrói o oclusor: escolhe a resolução da grade que chega mais perto do alvo
 * de triângulos, encolhe pelas normais e devolve a malha pronta para gravar.
 */
function buildHull(mesh: IndexedMesh, targetTriangles: number): Hull {
  let chosenResolution = MIN_HULL_RESOLUTION;
  let chosen: Decimation | null = null;
  for (
    let resolution = MIN_HULL_RESOLUTION;
    resolution <= MAX_HULL_RESOLUTION;
    resolution += 1
  ) {
    const candidate = decimate(mesh, resolution);
    chosen = candidate;
    chosenResolution = resolution;
    // A contagem cresce monotonicamente com a resolução: a primeira que atinge
    // o alvo é a mais barata que o atinge.
    if (candidate.indices.length / 3 >= targetTriangles) break;
  }
  if (chosen === null) throw new Error('decimação não produziu nenhum triângulo');

  const { mesh: hullMesh, cellToVertex } = compact(chosen);
  const hullVertexCount = hullMesh.positions.length / 3;
  if (hullVertexCount > HULL_MAX_VERTICES) {
    throw new Error(`oclusor com ${hullVertexCount} vértices: não cabe no índice Uint16`);
  }
  const hullNormals = computeVertexNormals(hullMesh);

  // Resíduo: quanto cada vértice de origem sobra para fora do seu
  // representante, medido ao longo da normal do casco. É a distância que o
  // oclusor precisa recuar para não engolir as reentrâncias.
  const residuals: number[] = [];
  for (let v = 0; v < chosen.cells.length; v += 1) {
    const hullIndex = cellToVertex.get(chosen.cells[v] ?? 0);
    if (hullIndex === undefined) continue;
    const dx = (mesh.positions[v * 3] ?? 0) - (hullMesh.positions[hullIndex * 3] ?? 0);
    const dy = (mesh.positions[v * 3 + 1] ?? 0) - (hullMesh.positions[hullIndex * 3 + 1] ?? 0);
    const dz = (mesh.positions[v * 3 + 2] ?? 0) - (hullMesh.positions[hullIndex * 3 + 2] ?? 0);
    const outward =
      dx * (hullNormals[hullIndex * 3] ?? 0) +
      dy * (hullNormals[hullIndex * 3 + 1] ?? 0) +
      dz * (hullNormals[hullIndex * 3 + 2] ?? 0);
    if (outward > 0) residuals.push(outward);
  }
  const residual = percentile(Float32Array.from(residuals), HULL_RESIDUAL_PERCENTILE);
  const shrink = residual + HULL_SHRINK_MARGIN;

  const shrunk = new Float32Array(hullMesh.positions.length);
  for (let i = 0; i < shrunk.length; i += 3) {
    const index = i / 3;
    shrunk[i] = (hullMesh.positions[i] ?? 0) - (hullNormals[index * 3] ?? 0) * shrink;
    shrunk[i + 1] =
      (hullMesh.positions[i + 1] ?? 0) - (hullNormals[index * 3 + 1] ?? 0) * shrink;
    shrunk[i + 2] =
      (hullMesh.positions[i + 2] ?? 0) - (hullNormals[index * 3 + 2] ?? 0) * shrink;
  }

  return { positions: shrunk, indices: hullMesh.indices, resolution: chosenResolution, shrink };
}

// ---------------------------------------------------------------------------
// Z-buffer em software — a mesma decisão que a GPU toma no `depthTest`
// ---------------------------------------------------------------------------

interface View {
  /** Base da câmera em coluna: direita, cima, frente. */
  right: [number, number, number];
  up: [number, number, number];
  forward: [number, number, number];
  eye: [number, number, number];
}

function makeView(yaw: number, pitch: number): View {
  // A câmera orbita o objeto: a direção do olho é a mesma que girar o objeto
  // em torno do eixo vertical, que é o que a seção faz.
  const dx = Math.cos(pitch) * Math.sin(yaw);
  const dy = Math.sin(pitch);
  const dz = Math.cos(pitch) * Math.cos(yaw);
  const eye: [number, number, number] = [
    dx * CAMERA_DISTANCE,
    dy * CAMERA_DISTANCE,
    dz * CAMERA_DISTANCE,
  ];
  const forward: [number, number, number] = [-dx, -dy, -dz];
  const worldUp: [number, number, number] = [0, 1, 0];
  const right = normalise(cross(forward, worldUp));
  const up = normalise(cross(right, forward));
  return { right, up, forward, eye };
}

function cross(
  a: [number, number, number],
  b: [number, number, number],
): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalise(v: [number, number, number]): [number, number, number] {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

/** Pixel + `1/z` de view space. `1/z` interpola linearmente em espaço de tela. */
interface Projected {
  x: number;
  y: number;
  invDepth: number;
  visible: boolean;
}

const HALF_FOV_TAN = Math.tan((CAMERA_FOV_DEG * Math.PI) / 360);

function project(view: View, px: number, py: number, pz: number, size: number): Projected {
  const rx = px - view.eye[0];
  const ry = py - view.eye[1];
  const rz = pz - view.eye[2];
  const depth = rx * view.forward[0] + ry * view.forward[1] + rz * view.forward[2];
  if (depth <= 1e-4) return { x: 0, y: 0, invDepth: 0, visible: false };
  const viewX = rx * view.right[0] + ry * view.right[1] + rz * view.right[2];
  const viewY = rx * view.up[0] + ry * view.up[1] + rz * view.up[2];
  const ndcX = viewX / (depth * HALF_FOV_TAN);
  const ndcY = viewY / (depth * HALF_FOV_TAN);
  return {
    x: (ndcX * 0.5 + 0.5) * size,
    y: (0.5 - ndcY * 0.5) * size,
    invDepth: 1 / depth,
    visible: true,
  };
}

/**
 * Rasteriza só a profundidade do casco, guardando o **maior** `1/z` por pixel —
 * ou seja, a superfície mais próxima, que é exatamente o que
 * `depthWrite: true` + `colorWrite: false` deixam no depth buffer da GPU.
 * Sem descarte de face traseira, porque o material usa `DoubleSide`.
 */
function rasteriseHullDepth(hull: Hull, view: View, size: number): Float32Array {
  const buffer = new Float32Array(size * size);
  const { positions, indices } = hull;

  for (let i = 0; i < indices.length; i += 3) {
    const a = project(
      view,
      positions[(indices[i] ?? 0) * 3] ?? 0,
      positions[(indices[i] ?? 0) * 3 + 1] ?? 0,
      positions[(indices[i] ?? 0) * 3 + 2] ?? 0,
      size,
    );
    const b = project(
      view,
      positions[(indices[i + 1] ?? 0) * 3] ?? 0,
      positions[(indices[i + 1] ?? 0) * 3 + 1] ?? 0,
      positions[(indices[i + 1] ?? 0) * 3 + 2] ?? 0,
      size,
    );
    const c = project(
      view,
      positions[(indices[i + 2] ?? 0) * 3] ?? 0,
      positions[(indices[i + 2] ?? 0) * 3 + 1] ?? 0,
      positions[(indices[i + 2] ?? 0) * 3 + 2] ?? 0,
      size,
    );
    if (!a.visible || !b.visible || !c.visible) continue;

    const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (area === 0) continue;
    const inverseArea = 1 / area;

    const minX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)));
    const maxX = Math.min(size - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
    const minY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
    const maxY = Math.min(size - 1, Math.ceil(Math.max(a.y, b.y, c.y)));

    for (let y = minY; y <= maxY; y += 1) {
      const sampleY = y + 0.5;
      for (let x = minX; x <= maxX; x += 1) {
        const sampleX = x + 0.5;
        const w0 =
          ((b.x - a.x) * (sampleY - a.y) - (b.y - a.y) * (sampleX - a.x)) * inverseArea;
        const w1 =
          ((sampleX - a.x) * (c.y - a.y) - (sampleY - a.y) * (c.x - a.x)) * inverseArea;
        // Sem culling: a orientação pode ser qualquer uma, e os dois lados
        // escrevem profundidade (é o que `DoubleSide` faz).
        if (w0 < 0 || w1 < 0 || w0 + w1 > 1) continue;
        const invDepth =
          a.invDepth + w1 * (b.invDepth - a.invDepth) + w0 * (c.invDepth - a.invDepth);
        const slot = y * size + x;
        if (invDepth > (buffer[slot] ?? 0)) buffer[slot] = invDepth;
      }
    }
  }
  return buffer;
}

interface OcclusionReport {
  /** Fração média de pontos descartados pelo depth test, sobre todas as poses. */
  meanDiscarded: number;
  minDiscarded: number;
  maxDiscarded: number;
  /** Fração de pontos que nenhuma pose da coreografia chega a desenhar. */
  neverVisible: number;
  /**
   * Fração dos pontos **virados para a câmera** que o casco engole.
   *
   * É o número que julga o encolhimento. Um ponto de frente para o olho só
   * deveria ser descartado se estiver num bolso real (o fundo de uma órbita
   * vista de lado). Se este valor sobe, o casco parou de ser um oclusor e
   * virou uma máscara: está apagando a anatomia que a nuvem existe para
   * mostrar, e `HULL_SHRINK_MARGIN` é o que precisa subir.
   */
  frontFacingDiscarded: number;
}

/** `dot(normal, direção da câmera)` acima do qual o ponto conta como "de frente". */
const FRONT_FACING_THRESHOLD = 0.35;

/**
 * Mede o que o `depthTest` da nuvem faria, pose a pose. Não é estimativa: é o
 * mesmo teste da GPU, rodado num z-buffer de software sobre o casco real.
 */
function measureOcclusion(cloud: PointCloud, hull: Hull): OcclusionReport {
  const size = OCCLUSION_RASTER_SIZE;
  const everVisible = new Uint8Array(cloud.count);
  let minDiscarded = 1;
  let maxDiscarded = 0;
  let totalDiscarded = 0;
  let frontFacing = 0;
  let frontFacingDiscarded = 0;

  for (let step = 0; step < OCCLUSION_YAW_STEPS; step += 1) {
    const view = makeView((step / OCCLUSION_YAW_STEPS) * Math.PI * 2, OCCLUSION_PITCH_RAD);
    const depth = rasteriseHullDepth(hull, view, size);
    let discarded = 0;
    for (let i = 0; i < cloud.count; i += 1) {
      const point = project(
        view,
        cloud.positions[i * 3] ?? 0,
        cloud.positions[i * 3 + 1] ?? 0,
        cloud.positions[i * 3 + 2] ?? 0,
        size,
      );
      if (!point.visible) continue;
      const x = Math.floor(point.x);
      const y = Math.floor(point.y);
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const stored = depth[y * size + x] ?? 0;
      const isDiscarded = point.invDepth < stored;
      if (isDiscarded) discarded += 1;
      else everVisible[i] = 1;

      const facing = -(
        (cloud.normals[i * 3] ?? 0) * view.forward[0] +
        (cloud.normals[i * 3 + 1] ?? 0) * view.forward[1] +
        (cloud.normals[i * 3 + 2] ?? 0) * view.forward[2]
      );
      if (facing > FRONT_FACING_THRESHOLD) {
        frontFacing += 1;
        if (isDiscarded) frontFacingDiscarded += 1;
      }
    }
    const fraction = discarded / cloud.count;
    totalDiscarded += fraction;
    if (fraction < minDiscarded) minDiscarded = fraction;
    if (fraction > maxDiscarded) maxDiscarded = fraction;
  }

  let hidden = 0;
  for (let i = 0; i < cloud.count; i += 1) if ((everVisible[i] ?? 0) === 0) hidden += 1;

  return {
    meanDiscarded: totalDiscarded / OCCLUSION_YAW_STEPS,
    minDiscarded,
    maxDiscarded,
    neverVisible: hidden / cloud.count,
    frontFacingDiscarded: frontFacing > 0 ? frontFacingDiscarded / frontFacing : 0,
  };
}

// ---------------------------------------------------------------------------
// Gravação
// ---------------------------------------------------------------------------

function quantise(value: number): number {
  return Math.round(clamp(value, -1, 1) * INT16_MAX);
}

function encodePoints(cloud: PointCloud): Uint8Array {
  const bytes = new Uint8Array(cloud.count * BYTES_PER_POINT);
  const view = new DataView(bytes.buffer);
  const normalBlock = cloud.count * 6;
  const curvatureBlock = cloud.count * 12;
  for (let i = 0; i < cloud.count; i += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      view.setInt16(i * 6 + axis * 2, quantise(cloud.positions[i * 3 + axis] ?? 0), true);
      view.setInt16(
        normalBlock + i * 6 + axis * 2,
        quantise(cloud.normals[i * 3 + axis] ?? 0),
        true,
      );
    }
    view.setInt16(curvatureBlock + i * 2, quantise(cloud.curvature[i] ?? 0), true);
  }
  return bytes;
}

function encodeHull(hull: Hull): Uint8Array {
  const vertexCount = hull.positions.length / 3;
  const indexCount = hull.indices.length;
  const bytes = new Uint8Array(HULL_HEADER_BYTES + vertexCount * 6 + indexCount * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < HULL_MAGIC.length; i += 1) {
    view.setUint8(i, HULL_MAGIC.charCodeAt(i));
  }
  view.setUint16(4, HULL_VERSION, true);
  view.setUint16(6, 0, true);
  view.setUint32(8, vertexCount, true);
  view.setUint32(12, indexCount, true);

  for (let i = 0; i < vertexCount * 3; i += 1) {
    view.setInt16(HULL_HEADER_BYTES + i * 2, quantise(hull.positions[i] ?? 0), true);
  }
  const indexBase = HULL_HEADER_BYTES + vertexCount * 6;
  for (let i = 0; i < indexCount; i += 1) {
    view.setUint16(indexBase + i * 2, hull.indices[i] ?? 0, true);
  }
  return bytes;
}

function gzipKb(bytes: Uint8Array): number {
  return gzipSync(bytes, { level: GZIP_LEVEL }).byteLength / 1024;
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

function readNumberFlag(flag: string, fallback: number): number {
  const raw = process.argv.find((argument) => argument.startsWith(`--${flag}=`));
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw.slice(flag.length + 3), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new RangeError(`--${flag} inválido: ${raw}`);
  }
  return parsed;
}

function main(): void {
  const source =
    process.argv.slice(2).find((argument) => !argument.startsWith('--')) ?? DEFAULT_SOURCE;
  const targetPoints = readNumberFlag('points', DEFAULT_TARGET_POINTS);
  const targetTriangles = readNumberFlag('tris', DEFAULT_TARGET_TRIANGLES);

  console.info(`lendo ${source}`);
  const rawTriangles = readBinaryStl(source);
  const sourceTriangleCount = rawTriangles.length / 9;

  let extent = 0;
  for (let i = 0; i < rawTriangles.length; i += 1) {
    extent = Math.max(extent, Math.abs(rawTriangles[i] ?? 0));
  }
  const mesh = weldVertices(rawTriangles, Math.max(extent, 1) * WELD_EPSILON_FRACTION);
  if (signedVolume(mesh) < 0) flipWinding(mesh);
  normaliseToUnitSphere(mesh);

  const normals = computeVertexNormals(mesh);
  const curvature = computeCurvature(mesh, normals);
  const cumulative = cumulativeAreas(mesh);

  const random = createRandom(SEED);
  const cloud = sampleSurface(mesh, normals, curvature, cumulative, targetPoints, random);
  shuffleCloud(cloud, random);

  const hull = buildHull(mesh, targetTriangles);
  const occlusion = measureOcclusion(cloud, hull);

  const pointBytes = encodePoints(cloud);
  const hullBytes = encodeHull(hull);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(POINTS_PATH, pointBytes);
  writeFileSync(HULL_PATH, hullBytes);

  const pointsKb = gzipKb(pointBytes);
  const hullKb = gzipKb(hullBytes);

  console.info(`\nmalha de origem: ${sourceTriangleCount} triângulos`);
  console.info(`  soldada em ${mesh.positions.length / 3} vértices`);
  console.info(`\nskull-points.bin  ${cloud.count} pontos · ${pointsKb.toFixed(1)} KB gzip`);
  console.info(
    `skull-hull.bin    ${hull.indices.length / 3} triângulos · ` +
      `${hull.positions.length / 3} vértices · ${hullKb.toFixed(1)} KB gzip`,
  );
  console.info(`  grade de decimação: ${hull.resolution} células no eixo maior`);
  console.info(
    `  encolhido ${hull.shrink.toFixed(4)} = ${(hull.shrink * 100).toFixed(1)}% do raio ` +
      `(percentil ${HULL_RESIDUAL_PERCENTILE * 100} do resíduo + margem ${HULL_SHRINK_MARGIN})`,
  );
  console.info(`\nsomados: ${(pointsKb + hullKb).toFixed(1)} KB gzip`);
  console.info(
    `\ndepth prepass (V.1), medido em ${OCCLUSION_YAW_STEPS} poses da coreografia:\n` +
      `  descarta ${(occlusion.meanDiscarded * 100).toFixed(1)}% dos pontos em média ` +
      `(${(occlusion.minDiscarded * 100).toFixed(1)}%–${(occlusion.maxDiscarded * 100).toFixed(1)}%)\n` +
      `  ${(occlusion.neverVisible * 100).toFixed(1)}% dos pontos nunca aparecem em pose nenhuma\n` +
      `  ${(occlusion.frontFacingDiscarded * 100).toFixed(1)}% dos pontos virados para a câmera ` +
      `são engolidos pelo casco (quanto menor, menos anatomia o oclusor apaga)`,
  );
}

main();
