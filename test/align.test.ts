import { describe, expect, it } from 'vitest';
import { apply, autoAlign, centroid, commonCrop, coverage, findStars, fitTransform, type Point, type Transform, warp } from '../src/align';
import type { Plane } from '../src/calibrate';

const W = 200;
const H = 160;
const C: Point = { x: (W - 1) / 2, y: (H - 1) / 2 };

/** Deterministic pseudo-random numbers. */
function rng(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
}

const random = rng(7);
const STARS: (Point & { f: number })[] = Array.from({ length: 25 }, () => ({
  x: 15 + random() * (W - 30),
  y: 15 + random() * (H - 30),
  f: 500 + random() * 5000,
}));

/** A sky of 100 ADU with Gaussian stars (σ = 1.5 px), seen through transform t⁻¹. */
function field(t: Transform, noise = 2, seed = 1): Plane {
  const r = rng(seed);
  const data = new Float32Array(W * H);
  for (let i = 0; i < data.length; i++) data[i] = 100 + (r() + r() + r() - 1.5) * noise * 2;
  for (const s of STARS) {
    // Where the reference star lands in this frame
    const p = inverse(t, s);
    for (let y = Math.floor(p.y) - 8; y <= p.y + 8; y++) {
      for (let x = Math.floor(p.x) - 8; x <= p.x + 8; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        data[y * W + x] += s.f * Math.exp(-((x - p.x) ** 2 + (y - p.y) ** 2) / (2 * 1.5 ** 2));
      }
    }
  }
  return { width: W, height: H, data };
}

function inverse(t: Transform, q: Point): Point {
  const cos = Math.cos(-t.rotation);
  const sin = Math.sin(-t.rotation);
  const x = q.x - C.x - t.dx;
  const y = q.y - C.y - t.dy;
  return { x: cos * x - sin * y + C.x, y: sin * x + cos * y + C.y };
}

describe('centroid', () => {
  it('finds a star centre to a fraction of a pixel from a nearby click', () => {
    const p = field({ dx: 0, dy: 0, rotation: 0 }, 0);
    const s = STARS.find((x) => x.f > 2000)!;
    const c = centroid(p, s.x + 3, s.y - 2)!;
    expect(c.x).toBeCloseTo(s.x, 1);
    expect(c.y).toBeCloseTo(s.y, 1);
  });

  it('returns null on an empty sky', () => {
    const p: Plane = { width: 30, height: 30, data: new Float32Array(900).fill(100) };
    expect(centroid(p, 15, 15)).toBeNull();
  });
});

describe('findStars', () => {
  it('finds the bright stars and skips a single hot pixel', () => {
    const p = field({ dx: 0, dy: 0, rotation: 0 });
    p.data[80 * W + 100] = 60000;
    const found = findStars(p);
    expect(found.length).toBeGreaterThanOrEqual(20);
    expect(found.some((s) => Math.hypot(s.x - 100, s.y - 80) < 1)).toBe(false);
  });
});

describe('fitTransform', () => {
  it('fits shift and rotation from pairs', () => {
    const t: Transform = { dx: 3, dy: -2, rotation: 0.05 };
    const pairs: [Point, Point][] = STARS.slice(0, 5).map((s) => [s, apply(t, C, s)]);
    const f = fitTransform(pairs, C, true);
    expect(f.dx).toBeCloseTo(3, 6);
    expect(f.dy).toBeCloseTo(-2, 6);
    expect(f.rotation).toBeCloseTo(0.05, 6);
    expect(f.rms).toBeLessThan(1e-6);
  });

  it('fits only the shift for one star', () => {
    const f = fitTransform([[{ x: 10, y: 10 }, { x: 12.5, y: 9 }]], C, true);
    expect(f).toMatchObject({ dx: 2.5, dy: -1, rotation: 0 });
  });
});

describe('autoAlign', () => {
  const ref = findStars(field({ dx: 0, dy: 0, rotation: 0 }, 2, 1));

  it('finds a small shift by nearest neighbour', () => {
    const t = { dx: 2.3, dy: -1.7, rotation: 0 };
    const r = autoAlign(findStars(field(t, 2, 2)), ref, C, false)!;
    expect(r.method).toBe('nearest');
    expect(r.dx).toBeCloseTo(2.3, 1);
    expect(r.dy).toBeCloseTo(-1.7, 1);
    expect(r.rotation).toBe(0);
  });

  it('finds a meridian flip', () => {
    const t = { dx: 1.5, dy: 2, rotation: Math.PI };
    const r = autoAlign(findStars(field(t, 2, 3)), ref, C, false)!;
    expect(r.method).toBe('flip');
    expect(Math.abs(r.rotation)).toBeCloseTo(Math.PI, 2);
    expect(r.dx).toBeCloseTo(1.5, 1);
    expect(r.dy).toBeCloseTo(2, 1);
  });

  it('finds any rotation with triangles', () => {
    const t = { dx: -4, dy: 3, rotation: 0.5 };
    const r = autoAlign(findStars(field(t, 2, 4)), ref, C, true)!;
    expect(r.method).toBe('triangles');
    expect(r.rotation).toBeCloseTo(0.5, 2);
    expect(r.dx).toBeCloseTo(-4, 0);
    expect(r.dy).toBeCloseTo(3, 0);
  });
});

describe('warp and crop', () => {
  it('moves a frame onto the reference', () => {
    const t = { dx: 3, dy: -2, rotation: 0 };
    const frame = field(t, 0);
    const reference = field({ dx: 0, dy: 0, rotation: 0 }, 0);
    const out = warp(frame, t, C);
    // Away from the edges the warped frame matches the reference
    let maxDiff = 0;
    for (let y = 10; y < H - 10; y++) {
      for (let x = 10; x < W - 10; x++) maxDiff = Math.max(maxDiff, Math.abs(out.data[y * W + x] - reference.data[y * W + x]));
    }
    expect(maxDiff).toBeLessThan(1e-3);
    // The first 3 columns come from outside the frame
    expect(Number.isNaN(out.data[50 * W + 2])).toBe(true);
    expect(Number.isNaN(out.data[50 * W + 3])).toBe(false);
  });

  it('crops to the area all frames cover', () => {
    const masks = [
      coverage(W, H, { dx: 3, dy: -2, rotation: 0 }, C),
      coverage(W, H, { dx: -1.5, dy: 1, rotation: 0 }, C),
    ];
    expect(commonCrop(masks, W, H)).toEqual({ x0: 3, x1: W - 3, y0: 1, y1: H - 3 });
  });
});
