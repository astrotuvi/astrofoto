import { describe, expect, it } from 'vitest';
import { clippedMean, combine, detectTrim, masterDark, masterFlat, type Plane, trimPlane } from '../src/calibrate';
import { median } from '../src/stats';

const plane = (width: number, height: number, f: (x: number, y: number) => number): Plane => {
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = f(x, y);
  return { width, height, data };
};
const constant = (v: number) => plane(4, 4, () => v);

describe('calibration', () => {
  it('trims a region', () => {
    const p = trimPlane(plane(5, 4, (x, y) => 10 * y + x), { x0: 1, x1: 3, y0: 1, y1: 2 });
    expect(p.width).toBe(3);
    expect(p.height).toBe(2);
    expect(Array.from(p.data)).toEqual([11, 12, 13, 21, 22, 23]);
  });

  it('combines by median, mean and sigma clipping', () => {
    const planes = [1, 2, 3, 4, 100].map(constant);
    expect(combine(planes, 'median').data[0]).toBe(3);
    expect(combine(planes, 'mean').data[0]).toBe(22);
    expect(clippedMean(Float32Array.from([10, 11, 9, 10, 10, 11, 9, 10, 500]), { low: 3, high: 3 })).toBe(10);
  });

  it('rejects planes of different sizes', () => {
    expect(() => combine([constant(1), plane(3, 3, () => 1)], 'median')).toThrow();
  });

  it('subtracts the bias from darks', () => {
    const d = masterDark([constant(1460), constant(1462), constant(1461)], constant(1454), 'median');
    expect(d.data[0]).toBe(7);
  });

  it('normalises each flat by its own median', () => {
    const bias = constant(1000);
    // Two flats of different brightness with the same pattern: right half 10 % darker
    const pattern = (level: number) => plane(4, 4, (x) => 1000 + level * (x >= 2 ? 0.9 : 1));
    const r = masterFlat([{ plane: pattern(30000), exposure: 2 }, { plane: pattern(40000), exposure: 3 }], bias, null, 'median');
    expect(median(r.master.data)).toBeCloseTo(1, 6);
    expect(r.master.data[3] / r.master.data[0]).toBeCloseTo(0.9, 5);
    expect(r.levels.map(Math.round)).toEqual([28500, 38000]);
  });

  it('subtracts a dark scaled to each flat exposure', () => {
    const dark = { plane: constant(10), exposure: 10 };
    const r = masterFlat([{ plane: constant(1005), exposure: 5 }], constant(0), dark, 'median');
    expect(r.levels[0]).toBe(1000);
  });

  it('finds the exposed columns of a flat', () => {
    // Columns 0–2 and 17–19 unexposed, column 3 partly lit
    const flat = plane(20, 10, (x) => (x < 3 || x > 16 ? 1450 : x === 3 ? 20000 : 40000));
    expect(detectTrim(flat)).toEqual({ x0: 4, x1: 16, y0: 0, y1: 9 });
  });

  it('finds nothing to trim in an evenly lit flat', () => {
    expect(detectTrim(plane(20, 10, (x, y) => 40000 + x + y))).toBeNull();
  });
});
