/**
 * Imagem e fonte do usuário, no build, sem dependência nenhuma.
 *
 * PNG é o único formato de imagem que o Node decodifica de verdade sem biblioteca externa —
 * o `zlib` embutido faz metade do trabalho, e a outra metade (desfiltrar linhas, expandir
 * profundidade de bit, paleta) está aqui. Isso importa porque **decodificar é o que permite
 * processar**: redimensionar para o tamanho que a tela realmente usa, reescrever em 8 bits e
 * **jogar fora todo chunk auxiliar** — que é onde mora o EXIF, e o EXIF de uma foto tirada no
 * celular carrega GPS.
 *
 * JPEG e WebP não têm decodificador aqui. Para eles a ingestão faz o que consegue fazer com
 * honestidade: confere que o arquivo é mesmo daquele formato, lê largura e altura do
 * cabeçalho, pesa, e copia **verbatim**. O relatório diz que foi verbatim; ninguém fica com a
 * impressão de que houve processamento.
 *
 * `.woff2` também é cópia verbatim, e por um motivo diferente: o arquivo já é Brotli e já é
 * o formato final da web. Reduzir o peso dele exigiria **subconjunto de glifos** — remontar
 * `glyf`/`loca`/`cmap`/`hmtx` —, que é um projeto próprio e não uma etapa de ingestão.
 */
import { deflateSync, inflateSync } from 'node:zlib';

export interface RasterImage {
  readonly width: number;
  readonly height: number;
  /** 3 (RGB) ou 4 (RGBA). */
  readonly channels: 3 | 4;
  /** `width × height × channels` bytes, sem preenchimento de linha. */
  readonly data: Uint8Array;
}

export interface ImageProbe {
  readonly format: 'png' | 'jpeg' | 'webp';
  readonly width: number;
  readonly height: number;
  /** O que dá para dizer do arquivo sem decodificar (ex.: `progressivo`, `lossless`). */
  readonly detail: string;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface PngChunk {
  readonly type: string;
  readonly data: Buffer;
}

function readPngChunks(buffer: Buffer): PngChunk[] {
  if (buffer.byteLength < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('PNG: assinatura ausente — o arquivo não é um PNG.');
  }

  const chunks: PngChunk[] = [];
  let cursor = 8;
  while (cursor + 8 <= buffer.byteLength) {
    const length = buffer.readUInt32BE(cursor);
    const type = buffer.subarray(cursor + 4, cursor + 8).toString('latin1');
    const start = cursor + 8;
    const end = start + length;
    if (end + 4 > buffer.byteLength) throw new Error(`PNG: chunk \`${type}\` truncado.`);
    chunks.push({ type, data: buffer.subarray(start, end) });
    cursor = end + 4;
    if (type === 'IEND') break;
  }
  return chunks;
}

const PNG_CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paethPredictor(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const dLeft = Math.abs(estimate - left);
  const dUp = Math.abs(estimate - up);
  const dUpLeft = Math.abs(estimate - upLeft);
  if (dLeft <= dUp && dLeft <= dUpLeft) return left;
  return dUp <= dUpLeft ? up : upLeft;
}

function unfilter(raw: Buffer, height: number, stride: number, bytesPerPixel: number): Buffer {
  const out = Buffer.allocUnsafe(height * stride);
  for (let row = 0; row < height; row += 1) {
    const filter = raw[row * (stride + 1)] ?? 0;
    const from = row * (stride + 1) + 1;
    const to = row * stride;
    const previous = to - stride;

    for (let index = 0; index < stride; index += 1) {
      const value = raw[from + index] ?? 0;
      const left = index >= bytesPerPixel ? (out[to + index - bytesPerPixel] ?? 0) : 0;
      const up = row > 0 ? (out[previous + index] ?? 0) : 0;
      const upLeft = row > 0 && index >= bytesPerPixel ? (out[previous + index - bytesPerPixel] ?? 0) : 0;

      let restored: number;
      switch (filter) {
        case 0:
          restored = value;
          break;
        case 1:
          restored = value + left;
          break;
        case 2:
          restored = value + up;
          break;
        case 3:
          restored = value + ((left + up) >> 1);
          break;
        case 4:
          restored = value + paethPredictor(left, up, upLeft);
          break;
        default:
          throw new Error(`PNG: tipo de filtro ${filter} desconhecido na linha ${row}.`);
      }
      out[to + index] = restored & 0xff;
    }
  }
  return out;
}

/** Lê a `sample`-ésima amostra de uma linha com profundidade de bit arbitrária, em 0–255. */
function readSample(row: Buffer, sample: number, bitDepth: number): number {
  if (bitDepth === 8) return row[sample] ?? 0;
  if (bitDepth === 16) return row[sample * 2] ?? 0; // descarta o byte baixo: a saída é 8 bits
  const perByte = 8 / bitDepth;
  const byte = row[Math.floor(sample / perByte)] ?? 0;
  const shift = 8 - bitDepth * ((sample % perByte) + 1);
  const raw = (byte >> shift) & ((1 << bitDepth) - 1);
  return raw;
}

/** Reescala uma amostra de `bitDepth` bits para 0–255 preservando branco e preto. */
function scaleToByte(value: number, bitDepth: number): number {
  if (bitDepth === 8 || bitDepth === 16) return value;
  const max = (1 << bitDepth) - 1;
  return Math.round((value * 255) / max);
}

export function decodePng(buffer: Buffer): RasterImage {
  const chunks = readPngChunks(buffer);
  const header = chunks.find((chunk) => chunk.type === 'IHDR');
  if (header === undefined || header.data.byteLength < 13) throw new Error('PNG: IHDR ausente.');

  const width = header.data.readUInt32BE(0);
  const height = header.data.readUInt32BE(4);
  const bitDepth = header.data.readUInt8(8);
  const colorType = header.data.readUInt8(9);
  const interlace = header.data.readUInt8(12);

  if (width === 0 || height === 0) throw new Error('PNG: dimensão zero.');
  if (interlace !== 0) {
    throw new Error('PNG entrelaçado (Adam7) — reexporte sem entrelaçamento e ingira de novo.');
  }
  const channels = PNG_CHANNELS[colorType];
  if (channels === undefined) throw new Error(`PNG: colorType ${colorType} desconhecido.`);
  if (![1, 2, 4, 8, 16].includes(bitDepth)) throw new Error(`PNG: bitDepth ${bitDepth} inválido.`);
  if (colorType !== 0 && colorType !== 3 && bitDepth < 8) {
    throw new Error(`PNG: bitDepth ${bitDepth} não vale para colorType ${colorType}.`);
  }

  const idat = Buffer.concat(chunks.filter((chunk) => chunk.type === 'IDAT').map((chunk) => chunk.data));
  if (idat.byteLength === 0) throw new Error('PNG: nenhum chunk IDAT.');

  const stride = Math.ceil((width * channels * bitDepth) / 8);
  const bytesPerPixel = Math.max(1, Math.ceil((channels * bitDepth) / 8));
  const raw = inflateSync(idat);
  if (raw.byteLength < height * (stride + 1)) throw new Error('PNG: dados IDAT truncados.');
  const rows = unfilter(raw, height, stride, bytesPerPixel);

  const palette = chunks.find((chunk) => chunk.type === 'PLTE')?.data ?? null;
  const paletteAlpha = chunks.find((chunk) => chunk.type === 'tRNS')?.data ?? null;
  if (colorType === 3 && palette === null) throw new Error('PNG: colorType 3 sem PLTE.');

  const hasAlpha = colorType === 4 || colorType === 6 || (colorType === 3 && paletteAlpha !== null);
  const outChannels: 3 | 4 = hasAlpha ? 4 : 3;
  const data = new Uint8Array(width * height * outChannels);

  for (let row = 0; row < height; row += 1) {
    const line = rows.subarray(row * stride, (row + 1) * stride);
    for (let column = 0; column < width; column += 1) {
      const at = (row * width + column) * outChannels;
      const sampleBase = column * channels;

      if (colorType === 3) {
        const index = readSample(line, sampleBase, bitDepth);
        const entry = index * 3;
        data[at] = palette?.[entry] ?? 0;
        data[at + 1] = palette?.[entry + 1] ?? 0;
        data[at + 2] = palette?.[entry + 2] ?? 0;
        if (outChannels === 4) data[at + 3] = paletteAlpha?.[index] ?? 255;
        continue;
      }

      const read = (offset: number): number => scaleToByte(readSample(line, sampleBase + offset, bitDepth), bitDepth);

      if (colorType === 0 || colorType === 4) {
        const gray = read(0);
        data[at] = gray;
        data[at + 1] = gray;
        data[at + 2] = gray;
        if (outChannels === 4) data[at + 3] = colorType === 4 ? read(1) : 255;
      } else {
        data[at] = read(0);
        data[at + 1] = read(1);
        data[at + 2] = read(2);
        if (outChannels === 4) data[at + 3] = colorType === 6 ? read(3) : 255;
      }
    }
  }

  return { width, height, channels: outChannels, data };
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(data.byteLength, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), Buffer.from(data)]);
  const crc = Buffer.allocUnsafe(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/**
 * Escolhe o filtro de cada linha pela **menor soma de valores absolutos com sinal** — a
 * heurística da própria especificação do PNG. Determinística por construção: nenhuma decisão
 * depende de tempo, de ordem de `Map` ou de sorteio.
 */
function filterRows(image: RasterImage): Buffer {
  const bytesPerPixel = image.channels;
  const stride = image.width * bytesPerPixel;
  const out = Buffer.allocUnsafe(image.height * (stride + 1));
  const candidate = Buffer.allocUnsafe(stride);
  const best = Buffer.allocUnsafe(stride);

  for (let row = 0; row < image.height; row += 1) {
    const from = row * stride;
    const previous = from - stride;
    let bestFilter = 0;
    let bestScore = Infinity;

    for (let filter = 0; filter <= 4; filter += 1) {
      let score = 0;
      for (let index = 0; index < stride; index += 1) {
        const value = image.data[from + index] ?? 0;
        const left = index >= bytesPerPixel ? (image.data[from + index - bytesPerPixel] ?? 0) : 0;
        const up = row > 0 ? (image.data[previous + index] ?? 0) : 0;
        const upLeft = row > 0 && index >= bytesPerPixel ? (image.data[previous + index - bytesPerPixel] ?? 0) : 0;

        let encoded: number;
        switch (filter) {
          case 0:
            encoded = value;
            break;
          case 1:
            encoded = value - left;
            break;
          case 2:
            encoded = value - up;
            break;
          case 3:
            encoded = value - ((left + up) >> 1);
            break;
          default:
            encoded = value - paethPredictor(left, up, upLeft);
        }
        encoded &= 0xff;
        candidate[index] = encoded;
        score += encoded < 128 ? encoded : 256 - encoded;
      }
      if (score < bestScore) {
        bestScore = score;
        bestFilter = filter;
        candidate.copy(best);
      }
    }

    out[row * (stride + 1)] = bestFilter;
    best.copy(out, row * (stride + 1) + 1);
  }

  return out;
}

/**
 * Reescreve o PNG com o mínimo de chunks: IHDR, IDAT, IEND. Some tudo que era auxiliar —
 * `eXIf`, `tEXt`, `tIME`, perfil de cor. Some de propósito: além dos bytes, é assim que a
 * geolocalização de uma foto de celular deixa de ser publicada junto com o site.
 */
export function encodePng(image: RasterImage): Buffer {
  const header = Buffer.allocUnsafe(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header.writeUInt8(8, 8); // bitDepth
  header.writeUInt8(image.channels === 4 ? 6 : 2, 9); // colorType
  header.writeUInt8(0, 10); // compressão
  header.writeUInt8(0, 11); // filtro
  header.writeUInt8(0, 12); // sem entrelaçamento

  const compressed = deflateSync(filterRows(image), { level: 9 });
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', new Uint8Array(0)),
  ]);
}

/**
 * Redução por média de área (box). Não é o melhor reamostrador que existe — é o que não
 * introduz aliasing na redução e não depende de tabela de pesos, e portanto é reproduzível
 * byte a byte em qualquer máquina.
 */
export function resizeToFit(image: RasterImage, maxSize: number): RasterImage {
  const longest = Math.max(image.width, image.height);
  if (longest <= maxSize) return image;

  const scale = maxSize / longest;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const channels = image.channels;
  const data = new Uint8Array(width * height * channels);

  const xRatio = image.width / width;
  const yRatio = image.height / height;

  for (let row = 0; row < height; row += 1) {
    const y0 = Math.floor(row * yRatio);
    const y1 = Math.max(y0 + 1, Math.min(image.height, Math.ceil((row + 1) * yRatio)));
    for (let column = 0; column < width; column += 1) {
      const x0 = Math.floor(column * xRatio);
      const x1 = Math.max(x0 + 1, Math.min(image.width, Math.ceil((column + 1) * xRatio)));

      for (let channel = 0; channel < channels; channel += 1) {
        let sum = 0;
        let samples = 0;
        for (let y = y0; y < y1; y += 1) {
          for (let x = x0; x < x1; x += 1) {
            sum += image.data[(y * image.width + x) * channels + channel] ?? 0;
            samples += 1;
          }
        }
        data[(row * width + column) * channels + channel] = Math.round(sum / samples);
      }
    }
  }

  return { width, height, channels, data };
}

function probeJpeg(buffer: Buffer): ImageProbe {
  if (buffer.byteLength < 4 || buffer.readUInt16BE(0) !== 0xffd8) {
    throw new Error('JPEG: marcador SOI (`FFD8`) ausente — o arquivo não é um JPEG.');
  }

  let cursor = 2;
  while (cursor + 4 <= buffer.byteLength) {
    if (buffer.readUInt8(cursor) !== 0xff) {
      cursor += 1;
      continue;
    }
    const marker = buffer.readUInt8(cursor + 1);
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      cursor += 2;
      continue;
    }
    const length = buffer.readUInt16BE(cursor + 2);
    const isFrameHeader = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrameHeader) {
      if (cursor + 9 > buffer.byteLength) break;
      return {
        format: 'jpeg',
        height: buffer.readUInt16BE(cursor + 5),
        width: buffer.readUInt16BE(cursor + 7),
        detail: marker === 0xc2 ? 'baseline progressivo' : 'baseline sequencial',
      };
    }
    cursor += 2 + length;
  }

  throw new Error('JPEG: nenhum marcador SOF encontrado — arquivo truncado ou não é JPEG.');
}

function probeWebp(buffer: Buffer): ImageProbe {
  const isRiff =
    buffer.byteLength >= 16 &&
    buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buffer.subarray(8, 12).toString('latin1') === 'WEBP';
  if (!isRiff) throw new Error('WebP: contêiner RIFF/WEBP ausente — o arquivo não é um WebP.');

  const fourCC = buffer.subarray(12, 16).toString('latin1');

  if (fourCC === 'VP8X' && buffer.byteLength >= 30) {
    return {
      format: 'webp',
      width: buffer.readUIntLE(24, 3) + 1,
      height: buffer.readUIntLE(27, 3) + 1,
      detail: 'estendido (VP8X)',
    };
  }
  if (fourCC === 'VP8 ' && buffer.byteLength >= 30) {
    return {
      format: 'webp',
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
      detail: 'com perda (VP8)',
    };
  }
  if (fourCC === 'VP8L' && buffer.byteLength >= 25) {
    const bits = buffer.readUInt32LE(21);
    return {
      format: 'webp',
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
      detail: 'sem perda (VP8L)',
    };
  }

  throw new Error(`WebP: bloco \`${fourCC}\` não reconhecido.`);
}

export function probeImage(buffer: Buffer, extension: string): ImageProbe {
  switch (extension) {
    case '.png': {
      const image = decodePng(buffer);
      return {
        format: 'png',
        width: image.width,
        height: image.height,
        detail: image.channels === 4 ? 'com canal alfa' : 'sem canal alfa',
      };
    }
    case '.jpg':
    case '.jpeg':
      return probeJpeg(buffer);
    case '.webp':
      return probeWebp(buffer);
    default:
      throw new Error(`extensão \`${extension}\` não é imagem suportada (.png, .jpg, .webp).`);
  }
}

export interface FontProbe {
  /** `ttf` (glifos quadráticos) ou `cff` (curvas cúbicas, PostScript). */
  readonly flavor: string;
  readonly tables: number;
  /** Tamanho que a fonte teria descomprimida — mostra o quanto o Brotli já ganhou. */
  readonly uncompressedBytes: number;
}

export function probeWoff2(buffer: Buffer): FontProbe {
  if (buffer.byteLength < 48 || buffer.subarray(0, 4).toString('latin1') !== 'wOF2') {
    throw new Error('WOFF2: assinatura `wOF2` ausente. `.woff` e `.ttf` não servem — converta para WOFF2.');
  }
  const flavor = buffer.readUInt32BE(4);
  return {
    flavor: flavor === 0x4f54544f ? 'cff' : 'ttf',
    tables: buffer.readUInt16BE(12),
    uncompressedBytes: buffer.readUInt32BE(16),
  };
}
