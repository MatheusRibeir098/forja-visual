/**
 * Read/merge/write access to `src/generated/measurements.json`.
 *
 * Each measure script owns one top-level key and must not clobber the others: the
 * scripts run independently (and sometimes in parallel), so writing is always a
 * read-merge-write of a single key.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Measurements } from '../../src/generated/types';

export const MEASUREMENTS_PATH = fileURLToPath(
  new URL('../../src/generated/measurements.json', import.meta.url),
);

const EMPTY: Measurements = {
  bundle: null,
  contrast: null,
  fps: null,
  fpsLow: null,
  relief: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readMeasurements(): Measurements {
  try {
    const parsed: unknown = JSON.parse(readFileSync(MEASUREMENTS_PATH, 'utf8'));
    if (!isRecord(parsed)) return EMPTY;
    return { ...EMPTY, ...(parsed as Partial<Measurements>) };
  } catch {
    return EMPTY;
  }
}

/** Merges `patch` into the file, leaving every other key untouched. */
export function patchMeasurements(patch: Partial<Measurements>): void {
  const merged: Measurements = { ...readMeasurements(), ...patch };
  writeFileSync(MEASUREMENTS_PATH, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
}

/** Bytes to KB with two decimals — the unit every budget in the spec is written in. */
export function toKb(bytes: number): number {
  return Math.round((bytes / 1024) * 100) / 100;
}

export function nowIso(): string {
  return new Date().toISOString();
}
