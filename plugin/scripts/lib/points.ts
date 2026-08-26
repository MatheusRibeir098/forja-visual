/**
 * Malha do usuário -> nuvem de pontos `Int16`, no build, determinística.
 *
 * É o pipeline que o protótipo 01 provou (`scripts/build-points.ts` em `forja-visual-site`):
 * um `.obj` de 20 MB virou um binário que o navegador lê com um `fetch` e um
 * `new Int16Array(...)` — **zero decodificador embarcado**, zero trabalho no primeiro quadro.
 * É a regra transversal 4 ("pré-processe o que não muda") na forma mais cara e mais rentável.
 *
 * Cinco etapas, e cada uma existe por um motivo medido:
 *
 * 1. **Solda de vértices.** STL não tem vértice compartilhado: cada triângulo repete os três.
 *    Sem soldar, "vértice vizinho" não existe e a curvatura da etapa 4 sairia zero em todo
 *    lugar.
 * 2. **Centro e escala unitários.** Sem isso a quantização da etapa 5 não teria intervalo
 *    conhecido para normalizar, e o site teria de carregar um fator de escala junto.
 * 3. **Normais por área.** A normal gravada no STL vem errada com frequência (zero, invertida,
 *    não normalizada). Recalcular por soma ponderada de área custa uma passada e sempre bate.
 * 4. **Curvatura por discordância de normal.** É o canal que permite ao shader distinguir
 *    aresta de superfície lisa sem carregar uma segunda malha.
 * 5. **Superamostragem -> peneira por voxel -> embaralhamento com semente -> `Int16`.**
 *
 * As duas propriedades que caem de graça da última etapa, e que valem mais do que parecem:
 *
 * - **Qualquer prefixo é uma amostra uniforme do objeto inteiro.** O embaralhamento é
 *   uniforme, então `draw(0, n)` com um `n` menor é a mesma silhueta com menos pontos. É a
 *   regra transversal 6 — escalar por dispositivo com **um número**, nunca com um caminho de
 *   código — servida pelo formato do arquivo.
 * - **`sha256` estável.** Toda fonte de aleatoriedade é a mesma `mulberry32(seed)`, e toda
 *   iteração sobre agrupamento é ordenada por índice numérico, nunca por ordem de `Map`.
 *   Rodar a ingestão duas vezes tem de produzir bytes idênticos; se não produzir, é defeito.
 */
import type { Mesh } from './mesh';

/** 3 posições + 3 normais + 1 curvatura, todos `Int16` little-endian. */
export const POINT_STRIDE_COMPONENTS = 7;
export const POINT_STRIDE_BYTES = POINT_STRIDE_COMPONENTS * 2;
export const POINT_CLOUD_FORMAT = 'p3n3c1-int16-le';

/** `32767` é o maior `Int16`: o shader divide por ele e recupera `[-1, 1]`. */
const INT16_MAX = 32767;

/** Semente do protótipo 01, mantida para que dois projetos com o mesmo `.stl` batam. */
export const DEFAULT_SEED = 0x5ca1ab1e;

export const DEFAULT_TARGET_POINTS = 45_000;

/**
 * Quantos pontos de superfície são gerados por ponto pedido, antes da peneira por voxel.
 * 3× medido como o menor fator em que a peneira ainda encontra célula ocupada suficiente
 * para atingir o alvo em malha com área muito desigual (medido em 2026-08 sobre esfera,
 * cubo e um crânio de 129k triângulos).
 */
const OVERSAMPLE_FACTOR = 3;

/** Tolerância de solda, como fração da maior aresta da caixa envolvente. Valor do protótipo. */
const WELD_EPSILON_FRACTION = 1e-5;

/** Busca binária da resolução do voxel: 24 passos resolvem qualquer malha até 2^24 células. */
const VOXEL_SEARCH_STEPS = 24;
const VOXEL_MIN_RESOLUTION = 4;
const VOXEL_MAX_RESOLUTION = 2048;

export interface PointCloudOptions {
  readonly targetPoints: number;
  readonly seed: number;
}

export interface PointCloudStats {
  readonly requestedPoints: number;
  readonly points: number;
  readonly sourceTriangles: number;
  readonly weldedVertices: number;
  readonly surfaceSamples: number;
  readonly voxelResolution: number;
  /** Raio da menor esfera que continha a malha, em unidades do arquivo original. */
  readonly sourceRadius: number;
  /** Erro máximo introduzido pela quantização, em unidades de raio. */
  readonly quantizationErrorRadius: number;
  readonly seed: number;
}

export interface PointCloud {
  readonly data: Int16Array;
  readonly stats: PointCloudStats;
}

/** PRNG de 32 bits com estado explícito — a mesma semente devolve a mesma sequência. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface WeldedMesh {
  readonly positions: Float64Array;
  readonly indices: Uint32Array;
  readonly vertexCount: number;
}

function weld(mesh: Mesh): WeldedMesh {
  const source = mesh.positions;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let index = 0; index + 2 < source.length; index += 3) {
    const x = source[index] ?? 0;
    const y = source[index + 1] ?? 0;
    const z = source[index + 2] ?? 0;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      throw new Error('malha com coordenada NaN/Infinity — o arquivo está corrompido.');
    }
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  if (!(extent > 0)) throw new Error('malha degenerada: a caixa envolvente tem volume zero.');
  const epsilon = extent * WELD_EPSILON_FRACTION;

  const bucket = new Map<string, number>();
  const welded: number[] = [];
  const remap = new Uint32Array(source.length / 3);

  for (let vertex = 0; vertex < source.length / 3; vertex += 1) {
    const x = source[vertex * 3] ?? 0;
    const y = source[vertex * 3 + 1] ?? 0;
    const z = source[vertex * 3 + 2] ?? 0;
    const key = `${Math.round(x / epsilon)},${Math.round(y / epsilon)},${Math.round(z / epsilon)}`;
    const existing = bucket.get(key);
    if (existing === undefined) {
      const id = welded.length / 3;
      welded.push(x, y, z);
      bucket.set(key, id);
      remap[vertex] = id;
    } else {
      remap[vertex] = existing;
    }
  }

  const indices = new Uint32Array(mesh.indices.length);
  for (let index = 0; index < mesh.indices.length; index += 1) {
    indices[index] = remap[mesh.indices[index] ?? 0] ?? 0;
  }

  return { positions: Float64Array.from(welded), indices, vertexCount: welded.length / 3 };
}

/** Centraliza na caixa envolvente e escala para caber na esfera de raio 1. */
function normalizeScale(positions: Float64Array): number {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let index = 0; index + 2 < positions.length; index += 3) {
    minX = Math.min(minX, positions[index] ?? 0);
    minY = Math.min(minY, positions[index + 1] ?? 0);
    minZ = Math.min(minZ, positions[index + 2] ?? 0);
    maxX = Math.max(maxX, positions[index] ?? 0);
    maxY = Math.max(maxY, positions[index + 1] ?? 0);
    maxZ = Math.max(maxZ, positions[index + 2] ?? 0);
  }

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const centerZ = (minZ + maxZ) / 2;

  let radius = 0;
  for (let index = 0; index + 2 < positions.length; index += 3) {
    const dx = (positions[index] ?? 0) - centerX;
    const dy = (positions[index + 1] ?? 0) - centerY;
    const dz = (positions[index + 2] ?? 0) - centerZ;
    radius = Math.max(radius, Math.hypot(dx, dy, dz));
  }
  if (!(radius > 0)) throw new Error('malha degenerada: todos os vértices no mesmo ponto.');

  for (let index = 0; index + 2 < positions.length; index += 3) {
    positions[index] = ((positions[index] ?? 0) - centerX) / radius;
    positions[index + 1] = ((positions[index + 1] ?? 0) - centerY) / radius;
    positions[index + 2] = ((positions[index + 2] ?? 0) - centerZ) / radius;
  }

  return radius;
}

/** Normal por vértice = soma das normais de face **não normalizadas** (peso = 2× a área). */
function vertexNormals(mesh: WeldedMesh): Float64Array {
  const normals = new Float64Array(mesh.vertexCount * 3);
  const { positions, indices } = mesh;

  for (let triangle = 0; triangle + 2 < indices.length; triangle += 3) {
    const a = (indices[triangle] ?? 0) * 3;
    const b = (indices[triangle + 1] ?? 0) * 3;
    const c = (indices[triangle + 2] ?? 0) * 3;

    const ux = (positions[b] ?? 0) - (positions[a] ?? 0);
    const uy = (positions[b + 1] ?? 0) - (positions[a + 1] ?? 0);
    const uz = (positions[b + 2] ?? 0) - (positions[a + 2] ?? 0);
    const vx = (positions[c] ?? 0) - (positions[a] ?? 0);
    const vy = (positions[c + 1] ?? 0) - (positions[a + 1] ?? 0);
    const vz = (positions[c + 2] ?? 0) - (positions[a + 2] ?? 0);

    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;

    for (const corner of [a, b, c]) {
      normals[corner] = (normals[corner] ?? 0) + nx;
      normals[corner + 1] = (normals[corner + 1] ?? 0) + ny;
      normals[corner + 2] = (normals[corner + 2] ?? 0) + nz;
    }
  }

  for (let vertex = 0; vertex < mesh.vertexCount; vertex += 1) {
    const at = vertex * 3;
    const length = Math.hypot(normals[at] ?? 0, normals[at + 1] ?? 0, normals[at + 2] ?? 0);
    if (length > 0) {
      normals[at] = (normals[at] ?? 0) / length;
      normals[at + 1] = (normals[at + 1] ?? 0) / length;
      normals[at + 2] = (normals[at + 2] ?? 0) / length;
    } else {
      // Vértice órfão (só em triângulo degenerado): direção arbitrária mas fixa, para não
      // introduzir NaN no canal e não depender da ordem de leitura.
      normals[at + 1] = 1;
    }
  }

  return normals;
}

/**
 * Curvatura em `[0, 1]`: média de `1 - dot(n_v, n_vizinho)` sobre as arestas incidentes,
 * dividida por 2 (a discordância máxima entre duas normais unitárias). Superfície lisa dá 0,
 * quina viva dá perto de 1 — e é isso que o shader usa para decidir onde há aresta.
 */
function vertexCurvature(mesh: WeldedMesh, normals: Float64Array): Float64Array {
  const sum = new Float64Array(mesh.vertexCount);
  const degree = new Uint32Array(mesh.vertexCount);
  const { indices } = mesh;

  const accumulate = (from: number, to: number): void => {
    const dot =
      (normals[from * 3] ?? 0) * (normals[to * 3] ?? 0) +
      (normals[from * 3 + 1] ?? 0) * (normals[to * 3 + 1] ?? 0) +
      (normals[from * 3 + 2] ?? 0) * (normals[to * 3 + 2] ?? 0);
    sum[from] = (sum[from] ?? 0) + (1 - dot) / 2;
    degree[from] = (degree[from] ?? 0) + 1;
  };

  for (let triangle = 0; triangle + 2 < indices.length; triangle += 3) {
    const corners = [indices[triangle] ?? 0, indices[triangle + 1] ?? 0, indices[triangle + 2] ?? 0];
    for (let corner = 0; corner < 3; corner += 1) {
      accumulate(corners[corner] ?? 0, corners[(corner + 1) % 3] ?? 0);
      accumulate(corners[corner] ?? 0, corners[(corner + 2) % 3] ?? 0);
    }
  }

  const curvature = new Float64Array(mesh.vertexCount);
  for (let vertex = 0; vertex < mesh.vertexCount; vertex += 1) {
    const count = degree[vertex] ?? 0;
    curvature[vertex] = count === 0 ? 0 : Math.min(1, (sum[vertex] ?? 0) / count);
  }
  return curvature;
}

interface SurfaceSamples {
  readonly position: Float64Array;
  readonly normal: Float64Array;
  readonly curvature: Float64Array;
  readonly count: number;
}

/**
 * Amostra a superfície com densidade proporcional à área, sem sorteio de contagem: a fração
 * de amostra que sobra de um triângulo é **carregada** para o próximo. Isso mantém o total
 * exato e tira uma fonte de variância do resultado.
 */
function sampleSurface(
  mesh: WeldedMesh,
  normals: Float64Array,
  curvature: Float64Array,
  total: number,
  random: () => number,
): SurfaceSamples {
  const { positions, indices } = mesh;
  const triangleCount = indices.length / 3;

  const areas = new Float64Array(triangleCount);
  let totalArea = 0;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const a = (indices[triangle * 3] ?? 0) * 3;
    const b = (indices[triangle * 3 + 1] ?? 0) * 3;
    const c = (indices[triangle * 3 + 2] ?? 0) * 3;
    const ux = (positions[b] ?? 0) - (positions[a] ?? 0);
    const uy = (positions[b + 1] ?? 0) - (positions[a + 1] ?? 0);
    const uz = (positions[b + 2] ?? 0) - (positions[a + 2] ?? 0);
    const vx = (positions[c] ?? 0) - (positions[a] ?? 0);
    const vy = (positions[c + 1] ?? 0) - (positions[a + 1] ?? 0);
    const vz = (positions[c + 2] ?? 0) - (positions[a + 2] ?? 0);
    const area =
      Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    areas[triangle] = area;
    totalArea += area;
  }
  if (!(totalArea > 0)) throw new Error('malha com área de superfície zero — nada a amostrar.');

  const position = new Float64Array(total * 3);
  const normal = new Float64Array(total * 3);
  const sampleCurvature = new Float64Array(total);

  let written = 0;
  let carry = 0;
  for (let triangle = 0; triangle < triangleCount && written < total; triangle += 1) {
    carry += (total * (areas[triangle] ?? 0)) / totalArea;
    let quota = Math.floor(carry);
    carry -= quota;
    if (quota <= 0) continue;
    quota = Math.min(quota, total - written);

    const ia = indices[triangle * 3] ?? 0;
    const ib = indices[triangle * 3 + 1] ?? 0;
    const ic = indices[triangle * 3 + 2] ?? 0;

    for (let sample = 0; sample < quota; sample += 1) {
      // Raiz na primeira coordenada: sem ela a distribuição baricêntrica se concentra num
      // canto do triângulo em vez de cobrir a face inteira.
      const rootU = Math.sqrt(random());
      const r2 = random();
      const wa = 1 - rootU;
      const wb = rootU * (1 - r2);
      const wc = rootU * r2;

      const at = written * 3;
      for (let axis = 0; axis < 3; axis += 1) {
        position[at + axis] =
          wa * (positions[ia * 3 + axis] ?? 0) +
          wb * (positions[ib * 3 + axis] ?? 0) +
          wc * (positions[ic * 3 + axis] ?? 0);
        normal[at + axis] =
          wa * (normals[ia * 3 + axis] ?? 0) +
          wb * (normals[ib * 3 + axis] ?? 0) +
          wc * (normals[ic * 3 + axis] ?? 0);
      }
      sampleCurvature[written] =
        wa * (curvature[ia] ?? 0) + wb * (curvature[ib] ?? 0) + wc * (curvature[ic] ?? 0);
      written += 1;
    }
  }

  return { position, normal, curvature: sampleCurvature, count: written };
}

/**
 * Uma amostra por célula ocupada: tira o agrupamento que o sorteio deixa e devolve densidade
 * de superfície parelha. A resolução é procurada por bisseção até o número de células
 * ocupadas encostar no alvo — buscar é mais barato do que adivinhar, e o alvo é dado.
 */
function voxelPick(samples: SurfaceSamples, target: number): { picked: Uint32Array; resolution: number } {
  const pickAt = (resolution: number): Uint32Array => {
    const cells = new Map<number, number>();
    const scale = resolution / 2.0000001; // [-1, 1] -> [0, resolution)
    for (let sample = 0; sample < samples.count; sample += 1) {
      const at = sample * 3;
      const cx = Math.floor(((samples.position[at] ?? 0) + 1) * scale);
      const cy = Math.floor(((samples.position[at + 1] ?? 0) + 1) * scale);
      const cz = Math.floor(((samples.position[at + 2] ?? 0) + 1) * scale);
      const key = (cx * resolution + cy) * resolution + cz;
      if (!cells.has(key)) cells.set(key, sample);
    }
    // Ordenar por chave de célula, e não pela ordem de inserção do `Map`, é o que torna o
    // resultado independente de como as amostras chegaram.
    return Uint32Array.from(
      [...cells.entries()].sort((a, b) => a[0] - b[0]).map(([, sample]) => sample),
    );
  };

  let low = VOXEL_MIN_RESOLUTION;
  let high = VOXEL_MAX_RESOLUTION;
  let best = pickAt(high);
  let bestResolution = high;

  for (let step = 0; step < VOXEL_SEARCH_STEPS && low <= high; step += 1) {
    const middle = Math.floor((low + high) / 2);
    const picked = pickAt(middle);
    if (picked.length >= target) {
      best = picked;
      bestResolution = middle;
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }

  return { picked: best, resolution: bestResolution };
}

/** Fisher-Yates com a mesma semente do resto — é o que dá a propriedade do prefixo. */
function shuffle(order: Uint32Array, random: () => number): void {
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const held = order[index] ?? 0;
    order[index] = order[swap] ?? 0;
    order[swap] = held;
  }
}

function quantizeSigned(value: number): number {
  return Math.max(-INT16_MAX, Math.min(INT16_MAX, Math.round(value * INT16_MAX)));
}

export function buildPointCloud(mesh: Mesh, options: PointCloudOptions): PointCloud {
  if (!Number.isInteger(options.targetPoints) || options.targetPoints < 1) {
    throw new Error(`--points=${options.targetPoints}: esperava um inteiro >= 1.`);
  }

  const welded = weld(mesh);
  const sourceRadius = normalizeScale(welded.positions);
  const normals = vertexNormals(welded);
  const curvature = vertexCurvature(welded, normals);

  const random = mulberry32(options.seed);
  const samples = sampleSurface(
    welded,
    normals,
    curvature,
    options.targetPoints * OVERSAMPLE_FACTOR,
    random,
  );

  const { picked, resolution } = voxelPick(samples, options.targetPoints);
  const order = Uint32Array.from(picked);
  shuffle(order, random);

  const count = Math.min(order.length, options.targetPoints);
  const data = new Int16Array(count * POINT_STRIDE_COMPONENTS);

  for (let point = 0; point < count; point += 1) {
    const sample = order[point] ?? 0;
    const from = sample * 3;
    const to = point * POINT_STRIDE_COMPONENTS;

    const nx = samples.normal[from] ?? 0;
    const ny = samples.normal[from + 1] ?? 0;
    const nz = samples.normal[from + 2] ?? 0;
    const length = Math.hypot(nx, ny, nz) || 1;

    data[to] = quantizeSigned(samples.position[from] ?? 0);
    data[to + 1] = quantizeSigned(samples.position[from + 1] ?? 0);
    data[to + 2] = quantizeSigned(samples.position[from + 2] ?? 0);
    data[to + 3] = quantizeSigned(nx / length);
    data[to + 4] = quantizeSigned(ny / length);
    data[to + 5] = quantizeSigned(nz / length);
    data[to + 6] = quantizeSigned(samples.curvature[sample] ?? 0);
  }

  return {
    data,
    stats: {
      requestedPoints: options.targetPoints,
      points: count,
      sourceTriangles: mesh.triangleCount,
      weldedVertices: welded.vertexCount,
      surfaceSamples: samples.count,
      voxelResolution: resolution,
      sourceRadius,
      // Meio passo de quantização, em unidades de raio: o pior desvio que um ponto sofre.
      quantizationErrorRadius: 0.5 / INT16_MAX,
      seed: options.seed,
    },
  };
}

/** Little-endian explícito: `Int16Array` herda a ordem da máquina, e o formato não pode. */
export function pointCloudToBuffer(cloud: PointCloud): Buffer {
  const buffer = Buffer.allocUnsafe(cloud.data.length * 2);
  for (let index = 0; index < cloud.data.length; index += 1) {
    buffer.writeInt16LE(cloud.data[index] ?? 0, index * 2);
  }
  return buffer;
}
