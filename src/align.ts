// Star centroids, star finding, matching and the shift/rotation fit. See docs/DESIGN.md §3.3.
//
// A transform maps a point p of a frame to the reference frame, rotating about a centre c:
//   q = R(rotation)·(p − c) + c + (dx, dy)
// With the centre in the middle of the image, a 180° meridian flip has a small (dx, dy).

import type { Plane } from './calibrate';
import { median, sortedMedian } from './stats';
import type { Region } from './types';

export interface Point { x: number; y: number }

export interface Star extends Point {
  /** Sum of the pixel values above the background. */
  flux: number;
  /** Highest value above the background. */
  peak: number;
}

export interface Transform { dx: number; dy: number; rotation: number }

export const IDENTITY: Transform = { dx: 0, dy: 0, rotation: 0 };

export function apply(t: Transform, c: Point, p: Point): Point {
  const cos = Math.cos(t.rotation);
  const sin = Math.sin(t.rotation);
  const x = p.x - c.x;
  const y = p.y - c.y;
  return { x: cos * x - sin * y + c.x + t.dx, y: sin * x + cos * y + c.y + t.dy };
}

/** The point of the frame that lands on q in the reference. */
export function applyInverse(t: Transform, c: Point, q: Point): Point {
  const cos = Math.cos(t.rotation);
  const sin = Math.sin(t.rotation);
  const x = q.x - c.x - t.dx;
  const y = q.y - c.y - t.dy;
  return { x: cos * x + sin * y + c.x, y: -sin * x + cos * y + c.y };
}

/** Largest distance between where two transforms put the corners of a w × h image. */
export function transformDifference(a: Transform, b: Transform, c: Point, w: number, h: number): number {
  let max = 0;
  for (const p of [{ x: 0, y: 0 }, { x: w - 1, y: 0 }, { x: 0, y: h - 1 }, { x: w - 1, y: h - 1 }]) {
    const pa = apply(a, c, p);
    const pb = apply(b, c, p);
    max = Math.max(max, Math.hypot(pa.x - pb.x, pa.y - pb.y));
  }
  return max;
}

/** Rotation in (−π, π]. */
function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function at(p: Plane, x: number, y: number): number {
  return x >= 0 && y >= 0 && x < p.width && y < p.height ? p.data[y * p.width + x] : NaN;
}

/** Median and scatter (1.4826 · MAD) of the square ring between half-sizes r0 (exclusive) and r1 around (x, y). */
function ring(p: Plane, x: number, y: number, r0: number, r1: number): { bg: number; sigma: number } {
  const vals: number[] = [];
  for (let j = -r1; j <= r1; j++) {
    for (let i = -r1; i <= r1; i++) {
      if (Math.abs(i) <= r0 && Math.abs(j) <= r0) continue;
      const v = at(p, x + i, y + j);
      if (!Number.isNaN(v)) vals.push(v);
    }
  }
  if (!vals.length) return { bg: NaN, sigma: NaN };
  const bg = median(Float32Array.from(vals));
  return { bg, sigma: 1.4826 * median(Float32Array.from(vals, (v) => Math.abs(v - bg))) };
}

const RING = { inner: 6, outer: 10 };

/**
 * The star near (x, y): moves to the brightest pixel within `search` px, then takes the
 * brightness-weighted average position (background subtracted) within `radius` px,
 * repeated a few times. Returns null when there is nothing brighter than the background.
 */
export function centroid(p: Plane, x: number, y: number, radius = 4, search = 6): Star | null {
  let bx = Math.round(x);
  let by = Math.round(y);
  let best = -Infinity;
  const x0 = bx;
  const y0 = by;
  for (let j = -search; j <= search; j++) {
    for (let i = -search; i <= search; i++) {
      if (i * i + j * j > search * search) continue;
      const v = at(p, x0 + i, y0 + j);
      if (v > best) { best = v; bx = x0 + i; by = y0 + j; }
    }
  }
  if (!Number.isFinite(best)) return null;
  const bg = ring(p, bx, by, RING.inner, RING.outer).bg;
  if (!Number.isFinite(bg) || best <= bg) return null;

  let cx = bx;
  let cy = by;
  let flux = 0;
  for (let round = 0; round < 3; round++) {
    let sx = 0, sy = 0, s = 0;
    const ix = Math.round(cx);
    const iy = Math.round(cy);
    for (let j = -radius; j <= radius; j++) {
      for (let i = -radius; i <= radius; i++) {
        const px = ix + i;
        const py = iy + j;
        if ((px - cx) ** 2 + (py - cy) ** 2 > radius * radius) continue;
        const v = at(p, px, py) - bg;
        if (!(v > 0)) continue;
        sx += v * px;
        sy += v * py;
        s += v;
      }
    }
    if (s <= 0) return null;
    const nx = sx / s;
    const ny = sy / s;
    flux = s;
    const moved = Math.hypot(nx - cx, ny - cy);
    cx = nx;
    cy = ny;
    if (moved < 0.01) break;
  }
  return { x: cx, y: cy, flux, peak: best - bg };
}

/** Background level and noise from every few pixels: median and 1.4826 · MAD. */
export function backgroundNoise(p: Plane): { bg: number; sigma: number } {
  const step = Math.max(1, Math.floor(p.data.length / 50000));
  const sample: number[] = [];
  for (let i = 0; i < p.data.length; i += step) if (!Number.isNaN(p.data[i])) sample.push(p.data[i]);
  const s = Float32Array.from(sample).sort();
  const bg = sortedMedian(s);
  const dev = s.map((v) => Math.abs(v - bg)).sort();
  return { bg, sigma: 1.4826 * sortedMedian(dev) };
}

/**
 * Bright stars, brightest (by flux) first. Left out are:
 * - single hot pixels and cosmic-ray hits: a star has at least 3 pixels above half its peak;
 * - bright knots of a nebula: a star stands out at least 5 times the scatter of the ring around it.
 */
export function findStars(p: Plane, max = 40, threshold = 5): Star[] {
  const { bg, sigma } = backgroundNoise(p);
  const limit = bg + threshold * Math.max(sigma, 1e-6);
  const margin = 6;
  const peaks: { x: number; y: number; v: number }[] = [];
  const { width: w, height: h, data } = p;
  for (let y = margin; y < h - margin; y++) {
    for (let x = margin; x < w - margin; x++) {
      const v = data[y * w + x];
      if (!(v > limit)) continue;
      let isPeak = true;
      for (let j = -1; j <= 1 && isPeak; j++) {
        for (let i = -1; i <= 1; i++) {
          if (!i && !j) continue;
          const n = data[(y + j) * w + x + i];
          // Strictly brighter than the neighbours before it, so a flat top counts once
          if (n > v || (n === v && (j < 0 || (j === 0 && i < 0)))) { isPeak = false; break; }
        }
      }
      if (!isPeak) continue;
      let wide = 0;
      const half = bg + (v - bg) / 2;
      for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) if (data[(y + j) * w + x + i] > half) wide++;
      if (wide >= 3) peaks.push({ x, y, v });
    }
  }
  peaks.sort((a, b) => b.v - a.v);
  const stars: Star[] = [];
  for (const pk of peaks.slice(0, max * 4)) {
    const s = centroid(p, pk.x, pk.y, 4, 1);
    if (!s || stars.some((o) => Math.hypot(o.x - s.x, o.y - s.y) < 5)) continue;
    const around = ring(p, Math.round(s.x), Math.round(s.y), RING.inner, RING.outer);
    if (s.peak < threshold * Math.max(around.sigma, sigma)) continue;
    stars.push(s);
  }
  return stars.sort((a, b) => b.flux - a.flux).slice(0, max);
}

/** Least-squares fit of pairs [frame point, reference point]. Without rotation only the shift is fitted. */
export function fitTransform(pairs: [Point, Point][], c: Point, rotation: boolean, baseRotation = 0): Transform & { rms: number } {
  const n = pairs.length;
  if (n === 0) return { ...IDENTITY, rms: 0 };
  let theta = baseRotation;
  if (rotation && n >= 2) {
    let px = 0, py = 0, qx = 0, qy = 0;
    for (const [p, q] of pairs) { px += p.x; py += p.y; qx += q.x; qy += q.y; }
    px /= n; py /= n; qx /= n; qy /= n;
    let sxy = 0, sxx = 0;
    for (const [p, q] of pairs) {
      const ax = p.x - px, ay = p.y - py, bx = q.x - qx, by = q.y - qy;
      sxx += ax * bx + ay * by;
      sxy += ax * by - ay * bx;
    }
    theta = Math.atan2(sxy, sxx);
  }
  // With the rotation known, the best shift is the mean of the differences
  let dx = 0, dy = 0;
  const r: Transform = { dx: 0, dy: 0, rotation: wrap(theta) };
  for (const [p, q] of pairs) {
    const m = apply(r, c, p);
    dx += q.x - m.x;
    dy += q.y - m.y;
  }
  const t: Transform = { dx: dx / n, dy: dy / n, rotation: r.rotation };
  let ss = 0;
  for (const [p, q] of pairs) {
    const m = apply(t, c, p);
    ss += (q.x - m.x) ** 2 + (q.y - m.y) ** 2;
  }
  return { ...t, rms: Math.sqrt(ss / n) };
}

/** Pairs of stars that are each other's nearest neighbour within `tol` px after the transform. */
export function matchStars(stars: Point[], ref: Point[], t: Transform, c: Point, tol: number): [Point, Point][] {
  const moved = stars.map((s) => apply(t, c, s));
  const nearest = (p: Point, list: Point[]) => {
    let best = -1;
    let bd = tol;
    list.forEach((o, i) => {
      const d = Math.hypot(o.x - p.x, o.y - p.y);
      if (d <= bd) { bd = d; best = i; }
    });
    return best;
  };
  const pairs: [Point, Point][] = [];
  moved.forEach((m, i) => {
    const j = nearest(m, ref);
    if (j >= 0 && nearest(ref[j], moved) === i) pairs.push([stars[i], ref[j]]);
  });
  return pairs;
}

export type MatchMethod = 'nearest' | 'flip' | 'triangles';

export interface AutoResult extends Transform {
  /** Stars matched between the frame and the reference. */
  matched: number;
  /** Scatter of the matched stars around the fit, in px. */
  rms: number;
  method: MatchMethod;
}

/** Matches that make a fit trustworthy. */
function enough(n: number, stars: number, ref: number): boolean {
  return n >= Math.min(3, stars, ref) && n >= 0.3 * Math.min(stars, ref);
}

/** Fits from rough pairs, then matches again closely and fits once more. */
function refine(stars: Star[], ref: Star[], c: Point, guess: Transform, pairs: [Point, Point][], rotation: boolean): (Transform & { rms: number; matched: number }) | null {
  let t: Transform & { rms: number } = fitTransform(pairs, c, rotation, guess.rotation);
  let matched = pairs.length;
  for (let round = 0; round < 3; round++) {
    const close = matchStars(stars, ref, t, c, 3);
    if (close.length < Math.min(2, pairs.length)) return null;
    t = fitTransform(close, c, rotation, t.rotation);
    matched = close.length;
  }
  return { ...t, matched };
}

interface Triangle { v: [Point, Point, Point]; r1: number; r2: number; cross: number }

/** Triangles of the brightest stars, described by side ratios that do not change with shift or rotation. */
function triangles(stars: Point[]): Triangle[] {
  const out: Triangle[] = [];
  const n = Math.min(stars.length, 12);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        const pts = [stars[i], stars[j], stars[k]];
        // Side opposite each vertex
        const sides = pts.map((_, m) => {
          const a = pts[(m + 1) % 3];
          const b = pts[(m + 2) % 3];
          return { m, len: Math.hypot(a.x - b.x, a.y - b.y) };
        }).sort((a, b) => a.len - b.len);
        if (sides[0].len < 10 || sides[0].len / sides[2].len < 0.1) continue;
        const v = sides.map((s) => pts[s.m]) as [Point, Point, Point];
        const cross = (v[1].x - v[0].x) * (v[2].y - v[0].y) - (v[1].y - v[0].y) * (v[2].x - v[0].x);
        out.push({ v, r1: sides[0].len / sides[2].len, r2: sides[1].len / sides[2].len, cross: Math.sign(cross) });
      }
    }
  }
  return out;
}

/**
 * Finds the transform from a frame to the reference from their stars:
 * 1. nearest neighbour within 15 px of each guess (no shift, the given guesses);
 * 2. the same after a 180° rotation (meridian flip);
 * 3. matching triangles of the brightest stars, which works for any rotation.
 * The shift model fits only the shift, unless the match needed a rotation.
 */
export function autoAlign(stars: Star[], ref: Star[], c: Point, rotation: boolean, guesses: Transform[] = []): AutoResult | null {
  const tries: { t: Transform; method: MatchMethod }[] = [
    ...guesses.map((t) => ({ t, method: 'nearest' as const })),
    { t: IDENTITY, method: 'nearest' },
    { t: { dx: 0, dy: 0, rotation: Math.PI }, method: 'flip' },
  ];
  for (const { t, method } of tries) {
    const rough = matchStars(stars, ref, t, c, 15);
    if (!enough(rough.length, stars.length, ref.length)) continue;
    const r = refine(stars, ref, c, t, rough, rotation || Math.abs(wrap(t.rotation)) > 0.01);
    if (r && enough(r.matched, stars.length, ref.length)) return { ...r, method };
  }

  const ts = triangles(stars);
  const tr = triangles(ref);
  let best: (Transform & { rms: number; matched: number }) | null = null;
  for (const a of ts) {
    for (const b of tr) {
      if (a.cross !== b.cross || Math.abs(a.r1 - b.r1) > 0.02 || Math.abs(a.r2 - b.r2) > 0.02) continue;
      const pairs: [Point, Point][] = [[a.v[0], b.v[0]], [a.v[1], b.v[1]], [a.v[2], b.v[2]]];
      const guess = fitTransform(pairs, c, true);
      if (guess.rms > 3) continue;
      const n = matchStars(stars, ref, guess, c, 3).length;
      if (best && n <= best.matched) continue;
      const r = refine(stars, ref, c, guess, pairs, true);
      if (r && (!best || r.matched > best.matched)) best = r;
    }
  }
  return best && enough(best.matched, stars.length, ref.length) ? { ...best, method: 'triangles' } : null;
}

/**
 * Resamples a plane into the reference grid with bilinear interpolation. `offset` is where the
 * plane's pixel (0, 0) is in the coordinates the transform uses (the trim origin).
 * Pixels that fall outside the frame are NaN.
 */
export function warp(p: Plane, t: Transform, c: Point, offset: Point = { x: 0, y: 0 }): Plane {
  const { width: w, height: h, data } = p;
  const out = new Float32Array(w * h);
  const cos = Math.cos(t.rotation);
  const sin = Math.sin(t.rotation);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Inverse transform, written out for speed
      const qx = x + offset.x - c.x - t.dx;
      const qy = y + offset.y - c.y - t.dy;
      const sx = cos * qx + sin * qy + c.x - offset.x;
      const sy = -sin * qx + cos * qy + c.y - offset.y;
      out[y * w + x] = bilinear(data, w, h, sx, sy);
    }
  }
  return { width: w, height: h, data: out };
}

function bilinear(data: Float32Array, w: number, h: number, x: number, y: number): number {
  // A tiny tolerance keeps exact edge positions (e.g. after a whole-pixel shift) inside
  const e = 1e-6;
  if (x < -e || y < -e || x > w - 1 + e || y > h - 1 + e) return NaN;
  const x0 = Math.min(w - 2, Math.max(0, Math.floor(x)));
  const y0 = Math.min(h - 2, Math.max(0, Math.floor(y)));
  const fx = Math.min(1, Math.max(0, x - x0));
  const fy = Math.min(1, Math.max(0, y - y0));
  const i = y0 * w + x0;
  return (data[i] * (1 - fx) + data[i + 1] * fx) * (1 - fy) + (data[i + w] * (1 - fx) + data[i + w + 1] * fx) * fy;
}

/** 1 where the warped frame has data (inside the original frame), from the geometry alone. */
export function coverage(w: number, h: number, t: Transform, c: Point, offset: Point = { x: 0, y: 0 }): Uint8Array {
  const mask = new Uint8Array(w * h);
  const e = 1e-6;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = applyInverse(t, c, { x: x + offset.x, y: y + offset.y });
      const sx = s.x - offset.x;
      const sy = s.y - offset.y;
      mask[y * w + x] = sx >= -e && sy >= -e && sx <= w - 1 + e && sy <= h - 1 + e ? 1 : 0;
    }
  }
  return mask;
}

/**
 * The largest region covered by every mask, found by repeatedly removing the edge row or
 * column with the most uncovered pixels. Null when nothing is covered by all.
 */
export function commonCrop(masks: Uint8Array[], w: number, h: number): Region | null {
  const all = new Uint8Array(w * h).fill(1);
  for (const m of masks) for (let i = 0; i < all.length; i++) all[i] &= m[i];
  let x0 = 0, x1 = w - 1, y0 = 0, y1 = h - 1;
  const badRow = (y: number) => { let n = 0; for (let x = x0; x <= x1; x++) n += 1 - all[y * w + x]; return n; };
  const badCol = (x: number) => { let n = 0; for (let y = y0; y <= y1; y++) n += 1 - all[y * w + x]; return n; };
  while (x0 <= x1 && y0 <= y1) {
    const edges = [
      { n: badRow(y0), cut: () => y0++ },
      { n: badRow(y1), cut: () => y1-- },
      { n: badCol(x0), cut: () => x0++ },
      { n: badCol(x1), cut: () => x1-- },
    ];
    const worst = edges.reduce((a, b) => (b.n > a.n ? b : a));
    if (worst.n === 0) return { x0, x1, y0, y1 };
    worst.cut();
  }
  return null;
}
