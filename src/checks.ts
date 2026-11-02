// Consistency checks on the loaded frames. See docs/DESIGN.md §2.4.

import { type Frame, state } from './state';
import { KINDS, type Kind } from './types';

export type CheckLevel = 'error' | 'warning' | 'info';
export type CheckCode =
  | 'sizeMismatch' | 'binningMismatch' | 'trimOutside'
  | 'noBias' | 'noDarks' | 'noFlats' | 'noLights'
  | 'darkExposures' | 'darkExposure' | 'darkTemperature'
  | 'noFlatForFilter' | 'memory';

export interface Check {
  level: CheckLevel;
  code: CheckCode;
  params: Record<string, string | number>;
}

/** Above this the app suggests software binning (§2.4). */
export const MEMORY_LIMIT = 1.5e9;
const TEMPERATURE_TOLERANCE = 2; // °C

function sizeKey(f: Frame): string {
  return `${f.meta.width} × ${f.meta.height}`;
}

function binKey(f: Frame): string {
  return f.meta.xbin || f.meta.ybin ? `${f.meta.xbin ?? 1}×${f.meta.ybin ?? 1}` : '';
}

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}

/** Rough memory need: frames, calibrated and aligned lights, masters and stacks. */
export function memoryEstimate(): number {
  const frames = state.frames.filter((f) => !f.meta.excluded);
  if (frames.length === 0) return 0;
  const px = frames[0].meta.width * frames[0].meta.height * 4;
  const lights = state.framesOf('light').length;
  const filters = new Set([...state.filtersOf('flat'), ...state.filtersOf('light')]).size;
  return px * (frames.length + 2 * lights + 2 + 2 * filters);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
}

export function runChecks(): Check[] {
  const out: Check[] = [];
  const all = state.frames.filter((f) => !f.meta.excluded);
  if (all.length === 0) return out;

  // Every frame must match: masters and lights are combined pixel by pixel
  const size = mostCommon(all.map(sizeKey));
  const odd = all.filter((f) => sizeKey(f) !== size);
  if (odd.length) out.push({ level: 'error', code: 'sizeMismatch', params: { size, n: odd.length, files: odd.map((f) => f.meta.fileName).join(', ') } });
  const bin = mostCommon(all.map(binKey));
  const oddBin = all.filter((f) => binKey(f) !== bin);
  if (oddBin.length) out.push({ level: 'error', code: 'binningMismatch', params: { bin, n: oddBin.length, files: oddBin.map((f) => f.meta.fileName).join(', ') } });

  const trim = state.settings.trim;
  if (trim && all.some((f) => trim.x1 >= f.meta.width || trim.y1 >= f.meta.height)) {
    out.push({ level: 'error', code: 'trimOutside', params: {} });
  }

  const count = (k: Kind) => state.framesOf(k).length;
  const missing: Record<Kind, CheckCode> = { bias: 'noBias', dark: 'noDarks', flat: 'noFlats', light: 'noLights' };
  for (const k of KINDS) {
    if (count(k) === 0) out.push({ level: k === 'flat' && count('light') ? 'warning' : 'info', code: missing[k], params: {} });
  }

  const darks = state.framesOf('dark');
  const lights = state.framesOf('light');
  const darkExps = [...new Set(darks.map((f) => f.meta.exposure))];
  if (darkExps.length > 1) {
    out.push({ level: 'warning', code: 'darkExposures', params: { list: darkExps.join(', ') } });
  }
  if (darks.length && lights.length) {
    const lightExps = [...new Set(lights.map((f) => f.meta.exposure))];
    const d = darkExps[0];
    const other = lightExps.filter((e) => Math.abs(e - d) > 0.01 * Math.max(e, d));
    if (other.length) out.push({ level: 'info', code: 'darkExposure', params: { dark: d, light: other.join(', ') } });

    const dt = darks.map((f) => f.meta.temperature).filter((x): x is number => x !== undefined);
    const lt = lights.map((f) => f.meta.temperature).filter((x): x is number => x !== undefined);
    if (dt.length && lt.length && Math.abs(median(dt) - median(lt)) > TEMPERATURE_TOLERANCE) {
      out.push({ level: 'warning', code: 'darkTemperature', params: { dark: Math.round(median(dt) * 10) / 10, light: Math.round(median(lt) * 10) / 10 } });
    }
  }

  const flatFilters = new Set(state.filtersOf('flat'));
  for (const f of state.filtersOf('light')) {
    if (!flatFilters.has(f) && flatFilters.size) out.push({ level: 'warning', code: 'noFlatForFilter', params: { filter: f || '–' } });
  }

  const mem = memoryEstimate();
  if (mem > MEMORY_LIMIT) out.push({ level: 'warning', code: 'memory', params: { mb: Math.round(mem / 1e6) } });
  return out;
}

export function hasErrors(): boolean {
  return runChecks().some((c) => c.level === 'error');
}
