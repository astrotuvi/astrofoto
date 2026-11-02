// Trim, master bias/dark/flat. See docs/DESIGN.md §3.2.

import { median, sortedMedian } from './stats';
import type { CombineMethod, Region } from './types';

export interface Plane {
  width: number;
  height: number;
  data: Float32Array;
}

export interface SigmaClip { low: number; high: number }
export const DEFAULT_SIGMA: SigmaClip = { low: 3, high: 3 };

/** Cuts out a region (0-based, inclusive). A null region returns the plane unchanged. */
export function trimPlane(p: Plane, r: Region | null): Plane {
  if (!r) return p;
  const width = r.x1 - r.x0 + 1;
  const height = r.y1 - r.y0 + 1;
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const src = (y + r.y0) * p.width + r.x0;
    data.set(p.data.subarray(src, src + width), y * width);
  }
  return { width, height, data };
}

/** Combines planes pixel by pixel. All planes must have the same size. */
export function combine(planes: Plane[], method: CombineMethod, sigma = DEFAULT_SIGMA): Plane {
  if (planes.length === 0) throw new Error('combine: no planes');
  const { width, height } = planes[0];
  for (const p of planes) {
    if (p.width !== width || p.height !== height) throw new Error('combine: planes differ in size');
  }
  const n = planes.length;
  const len = width * height;
  const out = new Float32Array(len);
  const buf = new Float32Array(n);
  const datas = planes.map((p) => p.data);

  for (let i = 0; i < len; i++) {
    let m = 0;
    for (let k = 0; k < n; k++) {
      const v = datas[k][i];
      if (!Number.isNaN(v)) buf[m++] = v;
    }
    if (m === 0) { out[i] = NaN; continue; }
    const vals = buf.subarray(0, m);
    if (method === 'mean') {
      let s = 0;
      for (let k = 0; k < m; k++) s += vals[k];
      out[i] = s / m;
    } else if (method === 'median') {
      vals.sort();
      out[i] = sortedMedian(vals);
    } else {
      out[i] = clippedMean(vals, sigma);
    }
  }
  return { width, height, data: out };
}

/**
 * Mean of the values within low·σ below and high·σ above the median, repeated until
 * nothing more is rejected (at most 5 rounds). σ is estimated from the median absolute
 * deviation, so a single large outlier does not inflate it and escape the clip.
 */
export function clippedMean(vals: Float32Array, sigma: SigmaClip): number {
  const cur = Float32Array.from(vals).sort();
  const dev = new Float32Array(cur.length);
  let n = cur.length;
  for (let round = 0; round < 5 && n > 2; round++) {
    const med = sortedMedian(cur.subarray(0, n));
    for (let k = 0; k < n; k++) dev[k] = Math.abs(cur[k] - med);
    let sd = 1.4826 * sortedMedian(dev.subarray(0, n).sort());
    if (sd === 0) {
      // More than half the values are equal: fall back to the standard deviation
      let s = 0;
      for (let k = 0; k < n; k++) s += (cur[k] - med) ** 2;
      sd = Math.sqrt(s / (n - 1));
    }
    if (sd === 0) break;
    const lo = med - sigma.low * sd;
    const hi = med + sigma.high * sd;
    // cur is sorted, so the kept values stay sorted when compacted
    let m = 0;
    for (let k = 0; k < n; k++) if (cur[k] >= lo && cur[k] <= hi) cur[m++] = cur[k];
    if (m === n || m === 0) break;
    n = m;
  }
  let s = 0;
  for (let k = 0; k < n; k++) s += cur[k];
  return s / n;
}

export function subtract(a: Plane, b: Plane): Plane {
  const data = new Float32Array(a.data.length);
  for (let i = 0; i < data.length; i++) data[i] = a.data[i] - b.data[i];
  return { width: a.width, height: a.height, data };
}

/** a − factor·b */
export function subtractScaled(a: Plane, b: Plane, factor: number): Plane {
  const data = new Float32Array(a.data.length);
  for (let i = 0; i < data.length; i++) data[i] = a.data[i] - factor * b.data[i];
  return { width: a.width, height: a.height, data };
}

export function divideBy(p: Plane, value: number): Plane {
  const data = new Float32Array(p.data.length);
  for (let i = 0; i < data.length; i++) data[i] = p.data[i] / value;
  return { width: p.width, height: p.height, data };
}

export function masterBias(biases: Plane[], method: CombineMethod): Plane {
  return combine(biases, method);
}

/** Median (or mean) of (dark − master bias). Without a bias the darks are combined as they are. */
export function masterDark(darks: Plane[], bias: Plane | null, method: CombineMethod): Plane {
  return combine(bias ? darks.map((d) => subtract(d, bias)) : darks, method);
}

export interface FlatResult {
  master: Plane;
  /** Median of each flat after bias (and dark) subtraction, before normalising. */
  levels: number[];
}

/**
 * Master flat for one filter: subtract bias (and optionally the dark scaled to each flat's
 * exposure), divide each flat by its own median, combine.
 */
export function masterFlat(
  flats: { plane: Plane; exposure: number }[],
  bias: Plane | null,
  dark: { plane: Plane; exposure: number } | null,
  method: CombineMethod,
): FlatResult {
  const levels: number[] = [];
  const normalised = flats.map(({ plane, exposure }) => {
    let p = bias ? subtract(plane, bias) : plane;
    if (dark && dark.exposure > 0) p = subtractScaled(p, dark.plane, exposure / dark.exposure);
    const level = median(p.data);
    levels.push(level);
    return divideBy(p, level);
  });
  const master = combine(normalised, method);
  // Normalise the result once more, so its median is exactly 1
  return { master: divideBy(master, median(master.data)), levels };
}

/** Median of each column (axis 'x') or row (axis 'y'). */
export function lineMedians(p: Plane, axis: 'x' | 'y'): Float32Array {
  const n = axis === 'x' ? p.width : p.height;
  const m = axis === 'x' ? p.height : p.width;
  const out = new Float32Array(n);
  const buf = new Float32Array(m);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) buf[j] = axis === 'x' ? p.data[j * p.width + i] : p.data[i * p.width + j];
    out[i] = median(buf);
  }
  return out;
}

/**
 * Finds the exposed area of a flat from its column and row medians: the longest run of
 * lines brighter than the dark level + 90 % of the step to the bright level.
 * Returns null when there is nothing to trim.
 */
export function detectTrim(flat: Plane): Region | null {
  const run = (meds: Float32Array): [number, number] => {
    const sorted = Float32Array.from(meds).sort();
    const lo = sorted[0];
    const hi = sortedMedian(sorted);
    // Not a clear step: everything counts as exposed
    if (!(hi - lo > 0.2 * Math.abs(hi))) return [0, meds.length - 1];
    const threshold = lo + 0.9 * (hi - lo);
    let best: [number, number] = [0, meds.length - 1];
    let bestLen = 0;
    let start = -1;
    for (let i = 0; i <= meds.length; i++) {
      const lit = i < meds.length && meds[i] >= threshold;
      if (lit && start < 0) start = i;
      if (!lit && start >= 0) {
        if (i - start > bestLen) { bestLen = i - start; best = [start, i - 1]; }
        start = -1;
      }
    }
    return best;
  };
  const [x0, x1] = run(lineMedians(flat, 'x'));
  const [y0, y1] = run(lineMedians(flat, 'y'));
  if (x0 === 0 && y0 === 0 && x1 === flat.width - 1 && y1 === flat.height - 1) return null;
  return { x0, x1, y0, y1 };
}
