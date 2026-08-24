/**
 * Small float-field helpers used to build the relief heightmap.
 *
 * They live in Node rather than inside `page.evaluate` for two reasons: the maths is
 * easier to read with real helper functions, and tsx compiles with esbuild's `keepNames`,
 * which injects a `__name(...)` helper into any named inner function — that helper does
 * not exist inside the page and breaks anything Playwright serializes over.
 */

/** Deterministic PRNG, so the same seed always regenerates the same asset. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Tileable value noise: the lattice wraps, so the texture has no visible seam when the
 * shader repeats it. Returns values in roughly [-1, 1].
 */
export function valueNoise(
  width: number,
  height: number,
  cells: number,
  seed: number,
): Float32Array {
  const random = mulberry32(seed);
  const lattice = new Float32Array(cells * cells);
  for (let i = 0; i < lattice.length; i += 1) lattice[i] = random() * 2 - 1;

  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const gy = (y / height) * cells;
    const y0 = Math.floor(gy) % cells;
    const y1 = (y0 + 1) % cells;
    const fy = smoothstep(gy - Math.floor(gy));

    for (let x = 0; x < width; x += 1) {
      const gx = (x / width) * cells;
      const x0 = Math.floor(gx) % cells;
      const x1 = (x0 + 1) % cells;
      const fx = smoothstep(gx - Math.floor(gx));

      const v00 = lattice[y0 * cells + x0] ?? 0;
      const v10 = lattice[y0 * cells + x1] ?? 0;
      const v01 = lattice[y1 * cells + x0] ?? 0;
      const v11 = lattice[y1 * cells + x1] ?? 0;
      const top = v00 + (v10 - v00) * fx;
      const bottom = v01 + (v11 - v01) * fx;
      out[y * width + x] = top + (bottom - top) * fy;
    }
  }
  return out;
}

/** Sums octaves of tileable value noise, normalised back to [-1, 1]. */
export function fractalNoise(
  width: number,
  height: number,
  octaves: readonly { cells: number; amplitude: number }[],
  seed: number,
): Float32Array {
  const out = new Float32Array(width * height);
  let total = 0;
  octaves.forEach((octave, index) => {
    const layer = valueNoise(width, height, octave.cells, seed + index * 7919);
    for (let i = 0; i < out.length; i += 1)
      out[i] = (out[i] ?? 0) + (layer[i] ?? 0) * octave.amplitude;
    total += octave.amplitude;
  });
  if (total > 0) for (let i = 0; i < out.length; i += 1) out[i] = (out[i] ?? 0) / total;
  return out;
}

function boxBlurPass(
  src: Float32Array,
  dst: Float32Array,
  width: number,
  height: number,
  radius: number,
  horizontal: boolean,
): void {
  const outer = horizontal ? height : width;
  const inner = horizontal ? width : height;
  const step = horizontal ? 1 : width;
  const window = radius * 2 + 1;

  for (let o = 0; o < outer; o += 1) {
    const base = horizontal ? o * width : o;
    let sum = 0;
    for (let k = -radius; k <= radius; k += 1) {
      sum += src[base + Math.min(inner - 1, Math.max(0, k)) * step] ?? 0;
    }
    for (let i = 0; i < inner; i += 1) {
      dst[base + i * step] = sum / window;
      const outIndex = Math.min(inner - 1, Math.max(0, i - radius));
      const inIndex = Math.min(inner - 1, Math.max(0, i + radius + 1));
      sum += (src[base + inIndex * step] ?? 0) - (src[base + outIndex * step] ?? 0);
    }
  }
}

/**
 * Three box passes approximate a gaussian closely enough for a heightfield and stay
 * O(n) regardless of radius. Border pixels clamp instead of wrapping.
 */
export function blur(
  source: Float32Array,
  width: number,
  height: number,
  radius: number,
  passes = 3,
): Float32Array {
  if (radius < 1) return Float32Array.from(source);
  const current = Float32Array.from(source);
  const scratch = new Float32Array(source.length);
  for (let pass = 0; pass < passes; pass += 1) {
    boxBlurPass(current, scratch, width, height, radius, true);
    boxBlurPass(scratch, current, width, height, radius, false);
  }
  return current;
}

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
