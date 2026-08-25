/// <reference lib="dom" />
/**
 * Generates the relief asset set for the "FORJA" plate (technique IV.1) — albedo +
 * depth + metal grain — instead of shipping a library preset.
 *
 * Division of labour: Chrome rasterises the word (it owns the font engine) and encodes
 * PNG/WebP (it owns the codecs); Node does all the field maths. No native image library.
 *
 *   pnpm tsx scripts/build-relief.ts
 *
 * ── DEPTH PACKING — read this before writing the shader ──────────────────────────────
 * `forja-depth.png` is 8-bit RGBA. Height is a 16-bit unsigned integer split across two
 * channels: R = high byte, G = low byte. B is 0 and A is 255 (constant, so they cost
 * almost nothing after PNG filtering).
 *
 *   GLSL:  float height = (texel.r * 255.0 * 256.0 + texel.g * 255.0) / 65535.0;
 *   bytes: height = (R * 256 + G) / 65535
 *
 * 0.5 is the plate surface, ~0.15 is the floor of the engraved letters, and the ramp in
 * between is the bevel. Sample the depth with NEAREST: LINEAR would interpolate the low
 * byte across its wrap and produce spikes. The field is already blurred, so NEAREST is
 * smooth enough for normals.
 *
 * ── WHY THE GRAIN IS A SEPARATE FILE ────────────────────────────────────────────────
 * The grain was originally baked into the depth. Measured, at 1280x720:
 *   grain baked in  -> forja-depth.png = 1602 KB   (budget: 300 KB)
 *   grain removed   -> forja-depth.png =  250 KB
 * A ±0.02 grain spans ±1310 units of the 16-bit range, so the low byte changes by tens
 * of units between neighbouring pixels and PNG has nothing left to compress. The grain
 * is low-frequency anyway, so it ships as a 256x256 seamless tile in `forja-grain.png`
 * (R channel, 0.5 = neutral) and the shader adds it:
 *
 *   height += (grainTexel.r - 0.5) * 2.0 * 0.02;   // GRAIN_AMPLITUDE
 *
 * Still "texture instead of runtime procedural" (rule VI.5) — and the amplitude becomes
 * tunable without regenerating the asset.
 *
 * ── SIZE BUDGET IS INFORMATIVE, NOT A GATE ──────────────────────────────────────────
 * The byte ceilings below (`*_BUDGET_KB`) used to pick the resolution and fail the
 * build. The project owner lifted that ceiling for this asset: the band this plate
 * fills is 2560 px wide at dpr 2, and the previous 1280×720 depth map left every texel
 * covering two screen pixels — a blurred bevel and a stair-stepped shadow edge. The
 * budgets still print (they are useful context for anyone reading the console output),
 * they just no longer set a non-zero exit code. The gates that still fail a build are
 * quality, not cost: 60 FPS on real GPU, contrast, WCAG, `prefers-reduced-motion`.
 *
 * Exit codes: 0 ok (bytes are printed either way, over budget or not).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launchRealGpu, PROJECT_ROOT } from './lib/chrome';
import { blur, clamp01, fractalNoise } from './lib/field';
import { nowIso, patchMeasurements, toKb } from './lib/measurements';
import type { Page } from 'playwright-core';

const WORD = 'FORJA';
/** The word takes 80% of the plate width, leaving a margin for the light to graze. */
const WORD_WIDTH_FRACTION = 0.8;
const FONT_PATH = resolve(PROJECT_ROOT, 'public/fonts/instrument-serif-400-latin.woff2');
const OUT_DIR = resolve(PROJECT_ROOT, 'public/relief');

/**
 * 3200×1800: the band this plate fills is 2560 px wide at dpr 2, so this keeps the
 * depth map at roughly one texel per screen pixel instead of the previous 1:2 stretch.
 * Same 16:9 aspect as the old 1280×720 asset (2.5× on each axis), so every constant
 * derived from that ratio in `relight.ts` (`uFieldAspect`) still holds unchanged.
 * Kept as an array — and the loop below kept generic — in case a future asset ever
 * needs the old shrink-on-budget-miss behaviour back; today the loop runs once.
 */
const RESOLUTIONS = [{ width: 3200, height: 1800 }] as const;

const ALBEDO_BUDGET_KB = 200;
/** Informative only (see header) — measured ≈1.5 MB at 3200×1800, ceiling padded to spare. */
const DEPTH_BUDGET_KB = 2000;
const GRAIN_BUDGET_KB = 80;
const PREVIEW_BUDGET_KB = 40;

/** Heights are normalised: 0.5 is the untouched plate, 0.15 the floor of the groove. */
const PLATE_HEIGHT = 0.5;
const LETTER_HEIGHT = 0.15;
/**
 * Three box passes spread the letter mask into the bevel ramp. Radius scales with the
 * texture (2.5× the 8 px tuned for the old 1280×720 asset) so the ramp keeps the same
 * *physical* width — same fraction of the plate, same ~45° bevel that
 * `DEFAULT_HEIGHT_SCALE` in `relight.ts` was derived from — just described with 2.5×
 * more texels. That is the whole point of the resolution bump: the geometry is
 * identical, only the sampling density (and therefore the on-screen sharpness) changes.
 */
const BEVEL_BLUR_RADIUS_PX = 20;
/** Final blur, same 2.5× scale as the bevel radius — kills the 8-bit staircase. */
const FINAL_BLUR_RADIUS_PX = 3;

/**
 * Seamless grain tile, still 256×256 — this one does *not* scale with the main asset.
 * Its on-screen feature size is `assetHeight / uGrainTiles / cells` (see the
 * `DEFAULT_GRAIN_TILES` comment in `relight.ts`): a function of the plate's physical
 * size and the noise cell count, not of how many texels the tile is rasterised at.
 * `valueNoise` is already smoothly interpolated at generation time (the lattice is
 * `smoothstep`-blended before it ever touches a pixel), so 256 px carries the same
 * information a bigger tile would — the extra texels would cost bytes without adding
 * detail. Regenerated on every run regardless, so it stays in lockstep with depth/albedo.
 */
const GRAIN_TILE_SIZE = 256;
const GRAIN_OCTAVES = [
  { cells: 16, amplitude: 1 },
  { cells: 32, amplitude: 0.5 },
] as const;
/** Amplitude the shader should apply: low on purpose — texture, not damage. */
const GRAIN_AMPLITUDE = 0.02;

/** #1c1c1e — dark charcoal. Colour comes from the light in the shader, not from here. */
const ALBEDO_BASE_RGB = [28, 28, 30] as const;
const WEAR_STRENGTH = 0.14;
const GROOVE_DARKENING = 0.3;
const BEVEL_SCRATCH_GAIN = 70;
const WEAR_OCTAVES = [
  { cells: 10, amplitude: 1 },
  { cells: 40, amplitude: 0.45 },
  { cells: 160, amplitude: 0.2 },
] as const;

const WEAR_SEED = 91117;
const GRAIN_SEED = 55501;

const PREVIEW_SCALE = 0.4;
const ALBEDO_WEBP_QUALITY = 0.8;
const PREVIEW_WEBP_QUALITY = 0.7;

const BYTES_PER_PACKED_PIXEL = 5;

interface RasterInput {
  readonly fontBase64: string;
  readonly width: number;
  readonly height: number;
  readonly word: string;
  readonly widthFraction: number;
}

/** Draws the word white-on-black and returns its coverage mask, one byte per pixel. */
const rasterizeWord = async (input: RasterInput): Promise<string> => {
  const face = new FontFace(
    'ReliefDisplay',
    `url(data:font/woff2;base64,${input.fontBase64}) format('woff2')`,
  );
  await face.load();
  document.fonts.add(face);

  const canvas = document.createElement('canvas');
  canvas.width = input.width;
  canvas.height = input.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) throw new Error('canvas 2d indisponível');

  context.fillStyle = '#000000';
  context.fillRect(0, 0, input.width, input.height);

  // Two-step fit: measure at a reference size, then scale so the word lands on target.
  const referenceSize = 200;
  context.font = `${referenceSize}px "ReliefDisplay"`;
  const referenceWidth = context.measureText(input.word).width;
  const targetWidth = input.width * input.widthFraction;
  const fontSize =
    referenceWidth > 0 ? (referenceSize * targetWidth) / referenceWidth : referenceSize;

  context.font = `${fontSize}px "ReliefDisplay"`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#ffffff';
  context.fillText(input.word, input.width / 2, input.height / 2);

  const { data } = context.getImageData(0, 0, input.width, input.height);
  const pixels = input.width * input.height;
  const mask = new Uint8Array(pixels);
  for (let i = 0; i < pixels; i += 1) mask[i] = data[i * 4] ?? 0;

  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < mask.length; offset += chunkSize) {
    binary += String.fromCharCode(...Array.from(mask.subarray(offset, offset + chunkSize)));
  }
  return btoa(binary);
};

interface SurfaceInput {
  readonly base64: string;
  readonly width: number;
  readonly height: number;
  /** How many bytes each pixel occupies in `base64`, and how to expand them to RGBA. */
  readonly layout: 'depth16' | 'albedo' | 'gray';
  readonly stride: number;
  readonly offset: number;
  readonly type: 'image/png' | 'image/webp';
  readonly quality?: number;
}

interface EncodeOutput {
  readonly files: string[];
  /** Max byte difference after decoding our own depth PNG — proves the packing survives. */
  readonly depthRoundTripMaxError: number;
}

/** Expands packed fields into RGBA and encodes them with the browser codecs. */
const encodeSurfaces = async (surfaces: SurfaceInput[]): Promise<EncodeOutput> => {
  const encoded: string[] = [];
  let depthSource: Uint8ClampedArray | null = null;
  let depthBlob: Blob | null = null;

  for (const surface of surfaces) {
    const binary = atob(surface.base64);
    const source = new Uint8Array(binary.length);
    for (let i = 0; i < source.length; i += 1) source[i] = binary.charCodeAt(i);

    const pixels = surface.width * surface.height;
    const rgba = new Uint8ClampedArray(pixels * 4);
    for (let i = 0; i < pixels; i += 1) {
      const from = i * surface.stride + surface.offset;
      const to = i * 4;
      if (surface.layout === 'depth16') {
        rgba[to] = source[from] ?? 0;
        rgba[to + 1] = source[from + 1] ?? 0;
        rgba[to + 2] = 0;
      } else if (surface.layout === 'albedo') {
        rgba[to] = source[from] ?? 0;
        rgba[to + 1] = source[from + 1] ?? 0;
        rgba[to + 2] = source[from + 2] ?? 0;
      } else {
        const value = source[from] ?? 0;
        rgba[to] = value;
        rgba[to + 1] = value;
        rgba[to + 2] = value;
      }
      rgba[to + 3] = 255;
    }

    const canvas = document.createElement('canvas');
    canvas.width = surface.width;
    canvas.height = surface.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) throw new Error('canvas 2d indisponível');
    const imageData = context.createImageData(surface.width, surface.height);
    imageData.data.set(rgba);
    context.putImageData(imageData, 0, 0);

    const blob = await new Promise<Blob | null>((done) =>
      canvas.toBlob(done, surface.type, surface.quality),
    );
    if (blob === null) throw new Error(`toBlob falhou para ${surface.type}`);
    if (surface.layout === 'depth16') {
      depthSource = rgba;
      depthBlob = blob;
    }

    const bytes = new Uint8Array(await blob.arrayBuffer());
    let out = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      out += String.fromCharCode(...Array.from(bytes.subarray(offset, offset + chunkSize)));
    }
    encoded.push(btoa(out));
  }

  // Decode our own PNG back: if Chrome colour-managed it, the 16-bit packing is dead.
  let depthRoundTripMaxError = -1;
  const firstDepth = surfaces.find((surface) => surface.layout === 'depth16');
  if (depthBlob !== null && depthSource !== null && firstDepth !== undefined) {
    const bitmap = await createImageBitmap(depthBlob, {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });
    const canvas = document.createElement('canvas');
    canvas.width = firstDepth.width;
    canvas.height = firstDepth.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) throw new Error('canvas 2d indisponível');
    context.drawImage(bitmap, 0, 0);
    const decoded = context.getImageData(0, 0, firstDepth.width, firstDepth.height).data;
    depthRoundTripMaxError = 0;
    for (let i = 0; i < firstDepth.width * firstDepth.height; i += 1) {
      const to = i * 4;
      depthRoundTripMaxError = Math.max(
        depthRoundTripMaxError,
        Math.abs((decoded[to] ?? 0) - (depthSource[to] ?? 0)),
        Math.abs((decoded[to + 1] ?? 0) - (depthSource[to + 1] ?? 0)),
      );
    }
  }

  return { files: encoded, depthRoundTripMaxError };
};

interface MaskStats {
  readonly coverage: number;
  readonly widthFraction: number;
  readonly heightFraction: number;
}

/** Sanity check that the font actually rendered — a missing glyph gives a flat plate. */
function describeMask(mask: Uint8Array, width: number, height: number): MaskStats {
  let inked = 0;
  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((mask[y * width + x] ?? 0) < 128) continue;
      inked += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return { coverage: 0, widthFraction: 0, heightFraction: 0 };
  return {
    coverage: inked / (width * height),
    widthFraction: (maxX - minX + 1) / width,
    heightFraction: (maxY - minY + 1) / height,
  };
}

interface PackedFields {
  readonly packed: Uint8Array;
  readonly preview: Uint8Array;
  readonly previewWidth: number;
  readonly previewHeight: number;
  readonly stats: MaskStats;
}

/** Coverage mask -> bevelled groove -> 16-bit packing, with the albedo interleaved. */
function buildFields(mask: Uint8Array, width: number, height: number): PackedFields {
  const pixels = width * height;

  const coverage = new Float32Array(pixels);
  for (let i = 0; i < pixels; i += 1) coverage[i] = (mask[i] ?? 0) / 255;

  // Blurring the mask turns the hard letter edge into a ramp: the blurred value is ~0.5
  // exactly on the outline and approaches 1 deep inside, so remapping [0.5, 1] to [0, 1]
  // gives a bevel that starts at the plate surface and reaches full depth ~12 px in.
  // Multiplying by the sharp coverage keeps the ramp strictly inside the letter.
  const spread = blur(coverage, width, height, BEVEL_BLUR_RADIUS_PX);
  const bevel = new Float32Array(pixels);
  for (let i = 0; i < pixels; i += 1) {
    bevel[i] = clamp01(((spread[i] ?? 0) - 0.5) * 2) * (coverage[i] ?? 0);
  }

  const depth = new Float32Array(pixels);
  for (let i = 0; i < pixels; i += 1) {
    depth[i] = clamp01(PLATE_HEIGHT + (LETTER_HEIGHT - PLATE_HEIGHT) * (bevel[i] ?? 0));
  }
  const smoothDepth = blur(depth, width, height, FINAL_BLUR_RADIUS_PX, 2);

  const wear = fractalNoise(width, height, WEAR_OCTAVES, WEAR_SEED);

  // The bevel "scratch": brightest where the ramp is steepest, i.e. on the cut edge.
  const slope = new Float32Array(pixels);
  let maxSlope = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const left = bevel[i - (x > 0 ? 1 : 0)] ?? 0;
      const right = bevel[i + (x < width - 1 ? 1 : 0)] ?? 0;
      const up = bevel[i - (y > 0 ? width : 0)] ?? 0;
      const down = bevel[i + (y < height - 1 ? width : 0)] ?? 0;
      const magnitude = Math.hypot(right - left, down - up);
      slope[i] = magnitude;
      if (magnitude > maxSlope) maxSlope = magnitude;
    }
  }

  const packed = new Uint8Array(pixels * BYTES_PER_PACKED_PIXEL);
  for (let i = 0; i < pixels; i += 1) {
    const quantized = Math.round(clamp01(smoothDepth[i] ?? 0) * 65535);
    const target = i * BYTES_PER_PACKED_PIXEL;
    packed[target] = (quantized >> 8) & 0xff;
    packed[target + 1] = quantized & 0xff;

    const shade = 1 + WEAR_STRENGTH * (wear[i] ?? 0);
    const groove = 1 - GROOVE_DARKENING * (bevel[i] ?? 0);
    const scratch = maxSlope > 0 ? ((slope[i] ?? 0) / maxSlope) * BEVEL_SCRATCH_GAIN : 0;
    for (let channel = 0; channel < 3; channel += 1) {
      const value = (ALBEDO_BASE_RGB[channel] ?? 0) * shade * groove + scratch;
      packed[target + 2 + channel] = Math.max(0, Math.min(255, Math.round(value)));
    }
  }

  const previewWidth = Math.round(width * PREVIEW_SCALE);
  const previewHeight = Math.round(height * PREVIEW_SCALE);
  const preview = new Uint8Array(previewWidth * previewHeight);
  const stepX = width / previewWidth;
  const stepY = height / previewHeight;
  for (let y = 0; y < previewHeight; y += 1) {
    for (let x = 0; x < previewWidth; x += 1) {
      const sourceX = Math.min(width - 1, Math.floor(x * stepX));
      const sourceY = Math.min(height - 1, Math.floor(y * stepY));
      preview[y * previewWidth + x] = Math.round(
        clamp01(smoothDepth[sourceY * width + sourceX] ?? 0) * 255,
      );
    }
  }

  return {
    packed,
    preview,
    previewWidth,
    previewHeight,
    stats: describeMask(mask, width, height),
  };
}

/** Seamless metal grain, 0.5 = neutral. Tiled by the shader over the plate. */
function buildGrainTile(size: number): Uint8Array {
  const noise = fractalNoise(size, size, GRAIN_OCTAVES, GRAIN_SEED);
  const tile = new Uint8Array(size * size);
  for (let i = 0; i < tile.length; i += 1) {
    tile[i] = Math.round(clamp01(((noise[i] ?? 0) + 1) / 2) * 255);
  }
  return tile;
}

interface Artifacts {
  readonly albedoKb: number;
  readonly depthKb: number;
  readonly grainKb: number;
  readonly previewKb: number;
  readonly width: number;
  readonly height: number;
  readonly roundTripMaxError: number;
  readonly stats: MaskStats;
  readonly files: { readonly path: string; readonly bytes: Buffer }[];
}

async function generate(
  page: Page,
  fontBase64: string,
  width: number,
  height: number,
): Promise<Artifacts> {
  const maskBase64 = await page.evaluate(rasterizeWord, {
    fontBase64,
    width,
    height,
    word: WORD,
    widthFraction: WORD_WIDTH_FRACTION,
  });
  const mask = new Uint8Array(Buffer.from(maskBase64, 'base64'));
  const fields = buildFields(mask, width, height);
  const grain = buildGrainTile(GRAIN_TILE_SIZE);

  const packedBase64 = Buffer.from(fields.packed).toString('base64');
  const encoded = await page.evaluate(encodeSurfaces, [
    {
      base64: packedBase64,
      width,
      height,
      layout: 'depth16' as const,
      stride: BYTES_PER_PACKED_PIXEL,
      offset: 0,
      type: 'image/png' as const,
    },
    {
      base64: packedBase64,
      width,
      height,
      layout: 'albedo' as const,
      stride: BYTES_PER_PACKED_PIXEL,
      offset: 2,
      type: 'image/webp' as const,
      quality: ALBEDO_WEBP_QUALITY,
    },
    {
      base64: Buffer.from(grain).toString('base64'),
      width: GRAIN_TILE_SIZE,
      height: GRAIN_TILE_SIZE,
      layout: 'gray' as const,
      stride: 1,
      offset: 0,
      type: 'image/png' as const,
    },
    {
      base64: Buffer.from(fields.preview).toString('base64'),
      width: fields.previewWidth,
      height: fields.previewHeight,
      layout: 'gray' as const,
      stride: 1,
      offset: 0,
      type: 'image/webp' as const,
      quality: PREVIEW_WEBP_QUALITY,
    },
  ]);

  const [depth, albedo, grainPng, preview] = encoded.files.map((base64) =>
    Buffer.from(base64, 'base64'),
  );
  if (
    depth === undefined ||
    albedo === undefined ||
    grainPng === undefined ||
    preview === undefined
  ) {
    throw new Error('codificação incompleta');
  }

  return {
    albedoKb: toKb(albedo.byteLength),
    depthKb: toKb(depth.byteLength),
    grainKb: toKb(grainPng.byteLength),
    previewKb: toKb(preview.byteLength),
    width,
    height,
    roundTripMaxError: encoded.depthRoundTripMaxError,
    stats: fields.stats,
    files: [
      { path: resolve(OUT_DIR, 'forja-depth.png'), bytes: depth },
      { path: resolve(OUT_DIR, 'forja-albedo.webp'), bytes: albedo },
      { path: resolve(OUT_DIR, 'forja-grain.png'), bytes: grainPng },
      { path: resolve(OUT_DIR, 'forja-depth-preview.webp'), bytes: preview },
    ],
  };
}

/** Informative only (see header) — no longer decides resolution or the exit code. */
function withinBudget(artifacts: Artifacts): boolean {
  return (
    artifacts.albedoKb <= ALBEDO_BUDGET_KB &&
    artifacts.depthKb <= DEPTH_BUDGET_KB &&
    artifacts.grainKb <= GRAIN_BUDGET_KB &&
    artifacts.previewKb <= PREVIEW_BUDGET_KB
  );
}

async function main(): Promise<void> {
  const fontBase64 = readFileSync(FONT_PATH).toString('base64');
  const { browser } = await launchRealGpu();

  try {
    const page = await browser.newPage();

    let chosen: Artifacts | null = null;
    for (const resolution of RESOLUTIONS) {
      const artifacts = await generate(page, fontBase64, resolution.width, resolution.height);
      console.info(
        `  ${artifacts.width}x${artifacts.height}: depth ${artifacts.depthKb} KB · ` +
          `albedo ${artifacts.albedoKb} KB · grain ${artifacts.grainKb} KB · ` +
          `preview ${artifacts.previewKb} KB`,
      );
      chosen = artifacts;
      if (withinBudget(artifacts)) break;
      console.info('  acima do teto informativo — seguindo mesmo assim (regra suspensa)');
    }
    if (chosen === null) throw new Error('nenhuma resolução gerada');

    if (chosen.stats.coverage <= 0) {
      throw new Error('a máscara saiu vazia — a fonte display não carregou no canvas');
    }

    mkdirSync(OUT_DIR, { recursive: true });
    for (const file of chosen.files) writeFileSync(file.path, file.bytes);

    patchMeasurements({
      relief: {
        albedoKb: chosen.albedoKb,
        depthKb: chosen.depthKb,
        grainKb: chosen.grainKb,
        previewKb: chosen.previewKb,
        width: chosen.width,
        height: chosen.height,
        measuredAt: nowIso(),
      },
    });

    console.info(`\nrelevo ${chosen.width}x${chosen.height} gerado em public/relief/`);
    console.info(`  forja-depth.png          ${chosen.depthKb} / ${DEPTH_BUDGET_KB} KB`);
    console.info(`  forja-albedo.webp        ${chosen.albedoKb} / ${ALBEDO_BUDGET_KB} KB`);
    console.info(`  forja-grain.png          ${chosen.grainKb} / ${GRAIN_BUDGET_KB} KB`);
    console.info(`  forja-depth-preview.webp ${chosen.previewKb} / ${PREVIEW_BUDGET_KB} KB`);
    console.info(
      `  máscara: ${(chosen.stats.coverage * 100).toFixed(1)}% de tinta · ` +
        `${(chosen.stats.widthFraction * 100).toFixed(1)}% da largura · ` +
        `${(chosen.stats.heightFraction * 100).toFixed(1)}% da altura`,
    );
    console.info(
      `  round-trip do packing 16 bits: erro máximo ${chosen.roundTripMaxError} byte(s)`,
    );
    console.info(`  o shader soma o grão com amplitude ${GRAIN_AMPLITUDE} (ver cabeçalho)`);

    if (!withinBudget(chosen)) {
      console.info(
        '\nacima do teto informativo — não falha o build (regra suspensa pelo dono do projeto).',
      );
    }
  } finally {
    await browser.close();
  }
}

await main();
