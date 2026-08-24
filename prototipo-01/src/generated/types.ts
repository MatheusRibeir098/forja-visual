/**
 * Shape of `measurements.json` — the verified numbers that back the "Medição" section.
 *
 * Every field here is produced by a script in `scripts/` against a real artifact
 * (the `dist/` build, a real-GPU Chrome, the generated relief asset). Nothing is
 * estimated by hand: if a script did not run, the corresponding key is `null`.
 */

/** One file on the critical path, already gzipped. */
export interface CriticalFile {
  readonly file: string;
  readonly kb: number;
}

/** `scripts/measure-bundle.ts` — gzip weight of `dist/`, split by role. */
export interface BundleMeasurement {
  readonly criticalKb: number;
  readonly criticalFiles: readonly CriticalFile[];
  readonly fontsKb: number;
  readonly lazyKb: number;
  readonly totalKb: number;
  readonly measuredAt: string;
}

/** Viewport-space rectangle, in CSS pixels. */
export interface Clip {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The single worst text/background pair found on the page. */
export interface ContrastWorstCase {
  readonly selector: string;
  readonly text: string;
  readonly ratio: number;
  readonly screenshotClip: Clip;
}

/** `scripts/measure-contrast.ts` — WCAG ratio measured per pixel, not per token. */
export interface ContrastMeasurement {
  readonly minContrast: number;
  readonly worst: ContrastWorstCase | null;
  readonly measured: number;
  readonly measuredAt: string;
}

/** `scripts/measure-fps.ts` — frame pacing during an automated scroll pass. */
export interface FpsMeasurement {
  readonly fpsMedian: number;
  readonly fpsP5: number;
  readonly renderer: string;
  readonly tier: string;
  readonly durationS: number;
  readonly viewport: string;
  readonly measuredAt: string;
}

/** `scripts/build-relief.ts` — weight of the generated relief asset pair. */
export interface ReliefMeasurement {
  readonly albedoKb: number;
  readonly depthKb: number;
  readonly grainKb: number;
  readonly previewKb: number;
  readonly width: number;
  readonly height: number;
  readonly measuredAt: string;
}

export interface Measurements {
  readonly bundle: BundleMeasurement | null;
  readonly contrast: ContrastMeasurement | null;
  readonly fps: FpsMeasurement | null;
  readonly fpsLow: FpsMeasurement | null;
  readonly relief: ReliefMeasurement | null;
}
