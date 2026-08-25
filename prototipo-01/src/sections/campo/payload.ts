/**
 * Leitura dos dois binários de `public/points/`.
 *
 * O formato inteiro está documentado no cabeçalho de `scripts/build-points.ts`,
 * que é quem os grava; aqui só se abre a janela certa sobre os bytes. **Não há
 * passe de decode** — os `Int16Array` são entregues ao three com
 * `normalized: true` e a GPU divide por 32767 na busca de atributo (V.5).
 *
 * Nada neste módulo importa three: ele devolve arrays tipados e medidas, e quem
 * monta a geometria é `scene.ts`.
 */

/** Bytes por ponto: 3 posições + 3 normais + 1 curvatura, todos `Int16`. */
const BYTES_PER_POINT = 14;

/** Cabeçalho do casco. Tabela completa no script de build. */
const HULL_MAGIC = 'FHUL';
const HULL_VERSION = 1;
const HULL_HEADER_BYTES = 16;

export interface PointsPayload {
  /** Três blocos sobre o **mesmo** `ArrayBuffer`; nenhum é copiado. */
  position: Int16Array;
  normal: Int16Array;
  curvature: Int16Array;
  count: number;
}

export interface HullPayload {
  position: Int16Array;
  index: Uint16Array;
}

async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`forja/campo: ${url} respondeu ${response.status}`);
  }
  return response.arrayBuffer();
}

export async function loadPoints(url: string): Promise<PointsPayload> {
  const buffer = await fetchBuffer(url);
  const count = buffer.byteLength / BYTES_PER_POINT;
  if (!Number.isInteger(count) || count === 0) {
    throw new Error(
      `forja/campo: ${url} tem ${buffer.byteLength} bytes, que não é múltiplo de ${BYTES_PER_POINT}`,
    );
  }
  const position = new Int16Array(buffer, 0, count * 3);
  const normal = new Int16Array(buffer, count * 6, count * 3);
  const curvature = new Int16Array(buffer, count * 12, count);
  return { position, normal, curvature, count };
}

function readMagic(view: DataView): string {
  let magic = '';
  for (let i = 0; i < HULL_MAGIC.length; i += 1) magic += String.fromCharCode(view.getUint8(i));
  return magic;
}

export async function loadHull(url: string): Promise<HullPayload> {
  const buffer = await fetchBuffer(url);
  if (buffer.byteLength < HULL_HEADER_BYTES) {
    throw new Error(`forja/campo: ${url} é curto demais para ter cabeçalho`);
  }
  const view = new DataView(buffer);
  const magic = readMagic(view);
  const version = view.getUint16(4, true);
  if (magic !== HULL_MAGIC || version !== HULL_VERSION) {
    // Falhar aqui é o ponto do cabeçalho: sem ele, um arquivo de outra versão
    // viraria triângulos aleatórios e o oclusor apagaria a nuvem inteira sem
    // um erro sequer.
    throw new Error(`forja/campo: ${url} tem magic "${magic}" v${version}, esperado FHUL v1`);
  }

  const vertexCount = view.getUint32(8, true);
  const indexCount = view.getUint32(12, true);
  const expected = HULL_HEADER_BYTES + vertexCount * 6 + indexCount * 2;
  if (expected !== buffer.byteLength) {
    throw new Error(
      `forja/campo: ${url} declara ${vertexCount} vértices e ${indexCount} índices ` +
        `(${expected} bytes), mas tem ${buffer.byteLength}`,
    );
  }

  return {
    position: new Int16Array(buffer, HULL_HEADER_BYTES, vertexCount * 3),
    index: new Uint16Array(buffer, HULL_HEADER_BYTES + vertexCount * 6, indexCount),
  };
}
