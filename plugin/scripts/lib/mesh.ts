/**
 * Ler malha de arquivo do usuário, em Node puro e sem dependência nenhuma.
 *
 * Não é um carregador genérico: é o mínimo para **transformar o arquivo do usuário em
 * triângulos no build**, que é o único momento em que isso pode acontecer. Asset decodificado
 * no navegador é o oposto do que o protótipo 01 provou (regra transversal 4) — lá o `.stl` do
 * crânio virou `Int16` pré-processado, sem decodificador nenhum embarcado no site.
 *
 * Por isso o suporte é deliberadamente estreito e **falha alto** no que não cobre: um `.glb`
 * com Draco recusado com mensagem clara é melhor do que uma nuvem de pontos silenciosamente
 * vazia. O que não dá para ler vira erro, nunca derivado degradado.
 */

export type MeshFormat = 'stl-binary' | 'stl-ascii' | 'obj' | 'glb';

export interface Mesh {
  /** 3 floats por vértice, na ordem em que o arquivo os declarou. */
  readonly positions: Float32Array;
  /** 3 índices por triângulo, apontando para `positions`. */
  readonly indices: Uint32Array;
  readonly format: MeshFormat;
  readonly triangleCount: number;
  /** O que o leitor precisou ignorar — sobe para o relatório, nunca some. */
  readonly warnings: readonly string[];
}

export const MESH_EXTENSIONS: readonly string[] = ['.stl', '.obj', '.glb'];

const STL_HEADER_BYTES = 80;
const STL_FACET_BYTES = 50;

/** `84 + 50 × n` é exato: é a assinatura do STL binário, mais confiável que o prefixo `solid`. */
function looksBinaryStl(buffer: Buffer): boolean {
  if (buffer.byteLength < STL_HEADER_BYTES + 4) return false;
  const triangles = buffer.readUInt32LE(STL_HEADER_BYTES);
  return buffer.byteLength === STL_HEADER_BYTES + 4 + triangles * STL_FACET_BYTES;
}

function parseBinaryStl(buffer: Buffer): Mesh {
  const triangleCount = buffer.readUInt32LE(STL_HEADER_BYTES);
  if (triangleCount === 0) throw new Error('STL binário sem triângulo nenhum.');

  const positions = new Float32Array(triangleCount * 9);
  const indices = new Uint32Array(triangleCount * 3);

  let cursor = STL_HEADER_BYTES + 4;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    // Os 12 primeiros bytes são a normal gravada pelo exportador. Ignoramos de propósito:
    // ela vem errada com frequência (zero, invertida, não normalizada) e recalculamos.
    cursor += 12;
    for (let corner = 0; corner < 3; corner += 1) {
      const base = triangle * 9 + corner * 3;
      positions[base] = buffer.readFloatLE(cursor);
      positions[base + 1] = buffer.readFloatLE(cursor + 4);
      positions[base + 2] = buffer.readFloatLE(cursor + 8);
      cursor += 12;
      indices[triangle * 3 + corner] = triangle * 3 + corner;
    }
    cursor += 2; // atributo por face, sem uso
  }

  return { positions, indices, format: 'stl-binary', triangleCount, warnings: [] };
}

function parseAsciiStl(text: string): Mesh {
  const vertices: number[] = [];
  const pattern = /vertex\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/g;

  let match = pattern.exec(text);
  while (match !== null) {
    vertices.push(Number(match[1]), Number(match[2]), Number(match[3]));
    match = pattern.exec(text);
  }

  if (vertices.length === 0) throw new Error('STL ASCII sem nenhuma linha `vertex`.');
  if (vertices.length % 9 !== 0) {
    throw new Error(
      `STL ASCII com ${vertices.length / 3} vértices — não é múltiplo de 3, o arquivo está truncado.`,
    );
  }
  if (vertices.some((value) => !Number.isFinite(value))) {
    throw new Error('STL ASCII com coordenada não numérica (NaN/Infinity).');
  }

  const triangleCount = vertices.length / 9;
  return {
    positions: new Float32Array(vertices),
    indices: Uint32Array.from({ length: triangleCount * 3 }, (_unused, index) => index),
    format: 'stl-ascii',
    triangleCount,
    warnings: [],
  };
}

/** `f 1/2/3` -> 1; `f -1` -> conta do fim. Índice de OBJ é 1-based e pode ser negativo. */
function objVertexIndex(token: string, vertexCount: number): number {
  const raw = Number(token.split('/')[0]);
  if (!Number.isInteger(raw) || raw === 0) {
    throw new Error(`OBJ: índice de face inválido \`${token}\`.`);
  }
  const resolved = raw > 0 ? raw - 1 : vertexCount + raw;
  if (resolved < 0 || resolved >= vertexCount) {
    throw new Error(`OBJ: índice de face ${raw} fora do intervalo de ${vertexCount} vértices.`);
  }
  return resolved;
}

function parseObj(text: string): Mesh {
  const vertices: number[] = [];
  const faces: number[] = [];
  const warnings: string[] = [];
  let ignoredLines = 0;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;

    const parts = line.split(/\s+/);
    const keyword = parts[0];

    if (keyword === 'v') {
      const x = Number(parts[1]);
      const y = Number(parts[2]);
      const z = Number(parts[3]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        throw new Error(`OBJ: vértice com coordenada não numérica — \`${line}\``);
      }
      vertices.push(x, y, z);
      continue;
    }

    if (keyword === 'f') {
      const corners = parts.slice(1).filter((part) => part.length > 0);
      if (corners.length < 3) throw new Error(`OBJ: face com menos de 3 cantos — \`${line}\``);
      const vertexCount = vertices.length / 3;
      // Leque a partir do primeiro canto: correto para polígono convexo, que é o que
      // exportador de OBJ emite. Côncavo sairia com triângulo invadindo o vazio — por isso
      // o aviso abaixo, em vez de silêncio.
      const first = objVertexIndex(corners[0] ?? '', vertexCount);
      for (let corner = 1; corner + 1 < corners.length; corner += 1) {
        faces.push(
          first,
          objVertexIndex(corners[corner] ?? '', vertexCount),
          objVertexIndex(corners[corner + 1] ?? '', vertexCount),
        );
      }
      if (corners.length > 4) ignoredLines += 1;
      continue;
    }

    if (keyword !== 'vt' && keyword !== 'vn' && keyword !== 'g' && keyword !== 'o') {
      ignoredLines += keyword === 'usemtl' || keyword === 'mtllib' || keyword === 's' ? 0 : 1;
    }
  }

  if (vertices.length === 0) throw new Error('OBJ sem nenhuma linha `v`.');
  if (faces.length === 0) throw new Error('OBJ sem nenhuma linha `f` — não há superfície a amostrar.');
  if (ignoredLines > 0) {
    warnings.push(
      `${ignoredLines} linha(s) do OBJ ignoradas (polígono de 5+ lados triangulado em leque, ou diretiva sem efeito na geometria).`,
    );
  }

  return {
    positions: new Float32Array(vertices),
    indices: Uint32Array.from(faces),
    format: 'obj',
    triangleCount: faces.length / 3,
    warnings,
  };
}

const GLB_MAGIC = 0x46546c67; // 'glTF'
const GLB_CHUNK_JSON = 0x4e4f534a;
const GLB_CHUNK_BIN = 0x004e4942;
const GLTF_MODE_TRIANGLES = 4;

const GLTF_COMPONENT_SIZE: Readonly<Record<number, number>> = {
  5120: 1, // BYTE
  5121: 1, // UNSIGNED_BYTE
  5122: 2, // SHORT
  5123: 2, // UNSIGNED_SHORT
  5125: 4, // UNSIGNED_INT
  5126: 4, // FLOAT
};

/**
 * Extensões que mudam **como os bytes do vértice são codificados**. Sem implementar o
 * descompressor, ler o buffer daria lixo geométrico com cara de malha — recusar é o único
 * comportamento honesto.
 */
const UNSUPPORTED_GLTF_EXTENSIONS: readonly string[] = [
  'KHR_draco_mesh_compression',
  'EXT_meshopt_compression',
  'KHR_mesh_quantization',
];

type Json = Record<string, unknown>;

function isJson(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function jsonArray(root: Json, key: string): Json[] {
  const value = root[key];
  return Array.isArray(value) ? value.filter(isJson) : [];
}

function jsonNumber(source: Json, key: string): number | undefined {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Coluna-maior, como o glTF grava. `out = a × b`. */
function multiplyMat4(a: readonly number[], b: readonly number[]): number[] {
  const out = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        sum += (a[k * 4 + row] ?? 0) * (b[column * 4 + k] ?? 0);
      }
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

const IDENTITY_MAT4: readonly number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function trsMatrix(node: Json): number[] {
  const matrix = node['matrix'];
  if (Array.isArray(matrix) && matrix.length === 16) {
    return matrix.map((value) => (typeof value === 'number' ? value : 0));
  }

  const t = Array.isArray(node['translation']) ? node['translation'] : [0, 0, 0];
  const r = Array.isArray(node['rotation']) ? node['rotation'] : [0, 0, 0, 1];
  const s = Array.isArray(node['scale']) ? node['scale'] : [1, 1, 1];

  const [x, y, z, w] = [Number(r[0]) || 0, Number(r[1]) || 0, Number(r[2]) || 0, Number(r[3]) ?? 1];
  const [sx, sy, sz] = [Number(s[0]) || 0, Number(s[1]) || 0, Number(s[2]) || 0];

  // Quaternion -> 3×3, já multiplicado pela escala de cada eixo (coluna-maior).
  return [
    (1 - 2 * (y * y + z * z)) * sx,
    (2 * (x * y + z * w)) * sx,
    (2 * (x * z - y * w)) * sx,
    0,
    (2 * (x * y - z * w)) * sy,
    (1 - 2 * (x * x + z * z)) * sy,
    (2 * (y * z + x * w)) * sy,
    0,
    (2 * (x * z + y * w)) * sz,
    (2 * (y * z - x * w)) * sz,
    (1 - 2 * (x * x + y * y)) * sz,
    0,
    Number(t[0]) || 0,
    Number(t[1]) || 0,
    Number(t[2]) || 0,
    1,
  ];
}

function applyMat4(m: readonly number[], x: number, y: number, z: number): [number, number, number] {
  return [
    (m[0] ?? 0) * x + (m[4] ?? 0) * y + (m[8] ?? 0) * z + (m[12] ?? 0),
    (m[1] ?? 0) * x + (m[5] ?? 0) * y + (m[9] ?? 0) * z + (m[13] ?? 0),
    (m[2] ?? 0) * x + (m[6] ?? 0) * y + (m[10] ?? 0) * z + (m[14] ?? 0),
  ];
}

function readAccessor(gltf: Json, bin: Buffer, accessorIndex: number, label: string): number[] {
  const accessor = jsonArray(gltf, 'accessors')[accessorIndex];
  if (accessor === undefined) throw new Error(`GLB: acessor ${accessorIndex} (${label}) não existe.`);
  if (isJson(accessor['sparse'])) {
    throw new Error(`GLB: acessor esparso em ${label} — não suportado por esta ingestão.`);
  }

  const componentType = jsonNumber(accessor, 'componentType') ?? 0;
  const componentSize = GLTF_COMPONENT_SIZE[componentType];
  if (componentSize === undefined) {
    throw new Error(`GLB: componentType ${componentType} desconhecido em ${label}.`);
  }

  const type = typeof accessor['type'] === 'string' ? accessor['type'] : '';
  const componentsPerElement = type === 'VEC3' ? 3 : type === 'SCALAR' ? 1 : 0;
  if (componentsPerElement === 0) {
    throw new Error(`GLB: tipo \`${type}\` em ${label} — só VEC3 e SCALAR são lidos aqui.`);
  }

  const count = jsonNumber(accessor, 'count') ?? 0;
  const viewIndex = jsonNumber(accessor, 'bufferView');
  if (viewIndex === undefined) throw new Error(`GLB: ${label} sem bufferView.`);
  const view = jsonArray(gltf, 'bufferViews')[viewIndex];
  if (view === undefined) throw new Error(`GLB: bufferView ${viewIndex} (${label}) não existe.`);

  const viewOffset = jsonNumber(view, 'byteOffset') ?? 0;
  const accessorOffset = jsonNumber(accessor, 'byteOffset') ?? 0;
  const stride = jsonNumber(view, 'byteStride') ?? componentSize * componentsPerElement;
  const base = viewOffset + accessorOffset;

  const needed = base + (count - 1) * stride + componentSize * componentsPerElement;
  if (count > 0 && needed > bin.byteLength) {
    throw new Error(`GLB: ${label} aponta para fora do chunk BIN (precisa de ${needed} bytes).`);
  }

  const out: number[] = [];
  for (let element = 0; element < count; element += 1) {
    for (let component = 0; component < componentsPerElement; component += 1) {
      const at = base + element * stride + component * componentSize;
      switch (componentType) {
        case 5126:
          out.push(bin.readFloatLE(at));
          break;
        case 5125:
          out.push(bin.readUInt32LE(at));
          break;
        case 5123:
          out.push(bin.readUInt16LE(at));
          break;
        case 5121:
          out.push(bin.readUInt8(at));
          break;
        case 5122:
          out.push(bin.readInt16LE(at));
          break;
        default:
          out.push(bin.readInt8(at));
      }
    }
  }
  return out;
}

interface GlbChunks {
  readonly gltf: Json;
  readonly bin: Buffer;
}

function splitGlb(buffer: Buffer): GlbChunks {
  if (buffer.byteLength < 12 || buffer.readUInt32LE(0) !== GLB_MAGIC) {
    throw new Error('GLB: os 4 primeiros bytes não são `glTF` — arquivo não é um GLB binário.');
  }
  const version = buffer.readUInt32LE(4);
  if (version !== 2) throw new Error(`GLB: versão ${version} — só glTF 2.0 é lido aqui.`);

  let gltf: Json | null = null;
  // Anotado: `subarray` devolve `Buffer<ArrayBufferLike>`, e `Buffer.alloc` estreita para `ArrayBuffer`.
  let bin: Buffer = Buffer.alloc(0);
  let cursor = 12;

  while (cursor + 8 <= buffer.byteLength) {
    const length = buffer.readUInt32LE(cursor);
    const type = buffer.readUInt32LE(cursor + 4);
    const start = cursor + 8;
    const end = start + length;
    if (end > buffer.byteLength) throw new Error('GLB: chunk declara mais bytes do que o arquivo tem.');

    if (type === GLB_CHUNK_JSON) {
      const parsed: unknown = JSON.parse(buffer.subarray(start, end).toString('utf8'));
      if (!isJson(parsed)) throw new Error('GLB: o chunk JSON não contém um objeto.');
      gltf = parsed;
    } else if (type === GLB_CHUNK_BIN) {
      bin = buffer.subarray(start, end);
    }
    cursor = end;
  }

  if (gltf === null) throw new Error('GLB: nenhum chunk JSON encontrado.');
  return { gltf, bin };
}

function parseGlb(buffer: Buffer): Mesh {
  const { gltf, bin } = splitGlb(buffer);

  const required = Array.isArray(gltf['extensionsRequired']) ? gltf['extensionsRequired'] : [];
  const blocked = required.filter(
    (name): name is string => typeof name === 'string' && UNSUPPORTED_GLTF_EXTENSIONS.includes(name),
  );
  if (blocked.length > 0) {
    throw new Error(
      `GLB comprimido (${blocked.join(', ')}). Esta ingestão lê glTF 2.0 sem compressão de malha.\n` +
        '  Reexporte sem Draco/meshopt, ou converta para `.stl`/`.obj` — os dois caminhos completos.',
    );
  }

  for (const buffered of jsonArray(gltf, 'buffers')) {
    const uri = buffered['uri'];
    if (typeof uri === 'string' && !uri.startsWith('data:')) {
      throw new Error(
        `GLB aponta para o arquivo externo \`${uri}\`. Só GLB autocontido é ingerido — ` +
          'um glTF de vários arquivos traria bytes de fora do que você declarou.',
      );
    }
  }

  const nodes = jsonArray(gltf, 'nodes');
  const meshes = jsonArray(gltf, 'meshes');
  const positions: number[] = [];
  const indices: number[] = [];
  const warnings: string[] = [];
  let skippedPrimitives = 0;

  const emitMesh = (meshIndex: number, world: readonly number[]): void => {
    const mesh = meshes[meshIndex];
    if (mesh === undefined) return;

    for (const primitive of jsonArray(mesh, 'primitives')) {
      const mode = jsonNumber(primitive, 'mode') ?? GLTF_MODE_TRIANGLES;
      if (mode !== GLTF_MODE_TRIANGLES) {
        skippedPrimitives += 1;
        continue;
      }
      const attributes = primitive['attributes'];
      if (!isJson(attributes)) continue;
      const positionAccessor = jsonNumber(attributes, 'POSITION');
      if (positionAccessor === undefined) continue;

      const local = readAccessor(gltf, bin, positionAccessor, 'POSITION');
      const vertexBase = positions.length / 3;
      for (let vertex = 0; vertex + 2 < local.length; vertex += 3) {
        const [x, y, z] = applyMat4(world, local[vertex] ?? 0, local[vertex + 1] ?? 0, local[vertex + 2] ?? 0);
        positions.push(x, y, z);
      }

      const indexAccessor = jsonNumber(primitive, 'indices');
      if (indexAccessor === undefined) {
        const vertexCount = local.length / 3;
        for (let vertex = 0; vertex + 2 < vertexCount; vertex += 3) {
          indices.push(vertexBase + vertex, vertexBase + vertex + 1, vertexBase + vertex + 2);
        }
      } else {
        for (const index of readAccessor(gltf, bin, indexAccessor, 'indices')) {
          indices.push(vertexBase + index);
        }
      }
    }
  };

  const walk = (nodeIndex: number, parent: readonly number[], depth: number): void => {
    if (depth > 64) throw new Error('GLB: hierarquia de nós com mais de 64 níveis — provável ciclo.');
    const node = nodes[nodeIndex];
    if (node === undefined) return;

    const world = multiplyMat4(parent, trsMatrix(node));
    const meshIndex = jsonNumber(node, 'mesh');
    if (meshIndex !== undefined) emitMesh(meshIndex, world);

    const children = node['children'];
    if (Array.isArray(children)) {
      for (const child of children) {
        if (typeof child === 'number') walk(child, world, depth + 1);
      }
    }
  };

  const scenes = jsonArray(gltf, 'scenes');
  const sceneIndex = jsonNumber(gltf, 'scene') ?? 0;
  const roots = scenes[sceneIndex]?.['nodes'];
  if (Array.isArray(roots) && roots.length > 0) {
    for (const root of roots) if (typeof root === 'number') walk(root, IDENTITY_MAT4, 0);
  } else {
    // Sem cena declarada, o glTF ainda é válido: cada malha vale na própria origem.
    for (let index = 0; index < meshes.length; index += 1) emitMesh(index, IDENTITY_MAT4);
    warnings.push('GLB sem `scenes` — malhas lidas sem transformação de nó.');
  }

  if (indices.length === 0) {
    throw new Error('GLB sem nenhum triângulo legível (mode 4 com POSITION).');
  }
  if (indices.length % 3 !== 0) throw new Error('GLB: contagem de índices não é múltiplo de 3.');
  if (skippedPrimitives > 0) {
    warnings.push(`${skippedPrimitives} primitiva(s) não-triangulares ignoradas (linhas/pontos).`);
  }

  return {
    positions: new Float32Array(positions),
    indices: Uint32Array.from(indices),
    format: 'glb',
    triangleCount: indices.length / 3,
    warnings,
  };
}

/** Lê a malha pelo conteúdo; a extensão só escolhe o leitor. */
export function parseMesh(buffer: Buffer, extension: string): Mesh {
  switch (extension) {
    case '.stl':
      return looksBinaryStl(buffer) ? parseBinaryStl(buffer) : parseAsciiStl(buffer.toString('utf8'));
    case '.obj':
      return parseObj(buffer.toString('utf8'));
    case '.glb':
      return parseGlb(buffer);
    default:
      throw new Error(`extensão \`${extension}\` não é malha suportada (${MESH_EXTENSIONS.join(', ')}).`);
  }
}
