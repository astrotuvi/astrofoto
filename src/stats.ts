// Basic statistics on pixel data. NaN values are ignored.

import type { DisplayScale, RangeMode, Region } from './types';

export interface Stats {
  n: number;
  mean: number;
  median: number;
  std: number;
  min: number;
  max: number;
}

/** Finite values of `data` (an image of the given width) inside `region`, or all of it. */
export function values(data: Float32Array, width: number, region?: Region): Float32Array {
  if (!region) return finite(data);
  const out = new Float32Array((region.x1 - region.x0 + 1) * (region.y1 - region.y0 + 1));
  let n = 0;
  for (let y = region.y0; y <= region.y1; y++) {
    for (let x = region.x0; x <= region.x1; x++) {
      const v = data[y * width + x];
      if (Number.isFinite(v)) out[n++] = v;
    }
  }
  return out.subarray(0, n);
}

/** Median of a sorted array. */
export function sortedMedian(sorted: Float32Array): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const m = n >> 1;
  return n % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

/** k-th smallest value (0-based) of `a`, reordering `a` in place (quickselect). */
function select(a: Float32Array, k: number): number {
  let lo = 0;
  let hi = a.length - 1;
  while (hi > lo) {
    const pivot = a[(lo + hi) >> 1];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (a[i] < pivot) i++;
      while (a[j] > pivot) j--;
      if (i <= j) {
        const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
        i++; j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else break;
  }
  return a[k];
}

/** Copy of the finite values. A plain loop: typed-array filter() is slow on large images. */
export function finite(v: Float32Array): Float32Array {
  const out = new Float32Array(v.length);
  let n = 0;
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    if (x - x === 0) out[n++] = x;
  }
  return n === v.length ? out : out.slice(0, n);
}

/** Median of the finite values, without sorting the whole array. */
export function median(v: Float32Array): number {
  const a = finite(v);
  const n = a.length;
  if (n === 0) return NaN;
  const m = n >> 1;
  const upper = select(a, m);
  if (n % 2) return upper;
  // The lower middle value is the largest of the values left of m after selection
  let lower = -Infinity;
  for (let i = 0; i < m; i++) if (a[i] > lower) lower = a[i];
  return (lower + upper) / 2;
}

/** Percentile p (0–100) of a sorted array, with linear interpolation. */
export function sortedPercentile(sorted: Float32Array, p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const pos = (Math.min(100, Math.max(0, p)) / 100) * (n - 1);
  const i = Math.floor(pos);
  const f = pos - i;
  return i + 1 < n ? sorted[i] * (1 - f) + sorted[i + 1] * f : sorted[i];
}

export function stats(v: Float32Array): Stats {
  const n = v.length;
  if (n === 0) return { n, mean: NaN, median: NaN, std: NaN, min: NaN, max: NaN };
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = v[i];
    sum += x;
    if (x < min) min = x;
    if (x > max) max = x;
  }
  const mean = sum / n;
  let ss = 0;
  for (let i = 0; i < n; i++) ss += (v[i] - mean) ** 2;
  return { n, mean, median: median(v), std: n > 1 ? Math.sqrt(ss / (n - 1)) : 0, min, max };
}

export interface Histogram {
  lo: number;
  hi: number;
  binWidth: number;
  counts: Uint32Array;
}

/** Histogram with `bins` equal bins from lo to hi. Values outside are left out. */
export function histogram(v: Float32Array, lo: number, hi: number, bins: number): Histogram {
  const counts = new Uint32Array(bins);
  const binWidth = (hi - lo) / bins || 1;
  for (let i = 0; i < v.length; i++) {
    const b = Math.floor((v[i] - lo) / binWidth);
    if (b >= 0 && b < bins) counts[b]++;
    else if (v[i] === hi) counts[bins - 1]++;
  }
  return { lo, hi, binWidth, counts };
}

/** Black and white display levels of a sorted image for a range mode; 'manual' keeps the given ones. */
export function displayRange(sorted: Float32Array, mode: RangeMode, black = 0, white = 1): { black: number; white: number } {
  if (mode === 'manual' || sorted.length === 0) return { black, white };
  const p = mode === 'p995' ? 0.5 : mode === 'p99' ? 1 : 0;
  return {
    black: p ? sortedPercentile(sorted, p) : sorted[0],
    white: p ? sortedPercentile(sorted, 100 - p) : sorted[sorted.length - 1],
  };
}

export const DISPLAY_SCALES: DisplayScale[] = ['linear', 'sqrt', 'log', 'asinh'];

/** Grey level 0–255 of a value: 0–1 between black and white, then through the scale. */
export function greyLevel(v: number, black: number, white: number, scale: DisplayScale = 'linear'): number {
  const x = Math.min(1, Math.max(0, (v - black) / (white - black || 1)));
  const y = scale === 'sqrt' ? Math.sqrt(x)
    : scale === 'log' ? Math.log1p(1000 * x) / Math.log1p(1000)
    : scale === 'asinh' ? Math.asinh(10 * x) / Math.asinh(10)
    : x;
  return Math.round(y * 255);
}
