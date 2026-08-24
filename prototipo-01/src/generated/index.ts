/**
 * Generated artifacts. Written by `scripts/measure-*.ts` and `scripts/build-relief.ts`;
 * never edit `measurements.json` by hand — a number without a script behind it is an
 * estimate, and this project only ships verified numbers (P6).
 */
import data from './measurements.json';
import type { Measurements } from './types';

/**
 * Vite inlines the JSON at build time (`resolveJsonModule`), so this costs no network
 * request. The assertion narrows the widened literal types TypeScript infers from JSON.
 */
export const measurements = data as Measurements;

export type * from './types';
