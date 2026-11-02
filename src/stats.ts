// Basic statistics on pixel data. NaN values are ignored.

import type { Region } from './types';

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
  if (!region) return data.filter(Number.isFinite);
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

export function median(v: Float32Array): number {
  return sortedMedian(Float32Array.from(v).sort());
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
