import { describe, expect, it } from 'vitest';
import { histogram, median, sortedPercentile, stats, values } from '../src/stats';

describe('stats', () => {
  it('computes basic statistics and ignores NaN', () => {
    const s = stats(values(Float32Array.from([1, 2, 3, 4, NaN, 100]), 6));
    expect(s.n).toBe(5);
    expect(s.mean).toBe(22);
    expect(s.median).toBe(3);
    expect(s.min).toBe(1);
    expect(s.max).toBe(100);
    expect(s.std).toBeCloseTo(43.6, 1);
  });

  it('takes values from a region', () => {
    // 3×3 image, region is the bottom-right 2×2
    const v = values(Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]), 3, { x0: 1, x1: 2, y0: 1, y1: 2 });
    expect(Array.from(v)).toEqual([5, 6, 8, 9]);
  });

  it('median of an even count averages the middle two', () => {
    expect(median(Float32Array.from([4, 1, 3, 2]))).toBe(2.5);
  });

  it('interpolates percentiles', () => {
    const s = Float32Array.from([0, 10, 20, 30, 40]);
    expect(sortedPercentile(s, 50)).toBe(20);
    expect(sortedPercentile(s, 25)).toBe(10);
    expect(sortedPercentile(s, 10)).toBe(4);
  });

  it('counts values in bins, including the top edge', () => {
    const h = histogram(Float32Array.from([0, 0.5, 1, 9.99, 10, 11]), 0, 10, 10);
    expect(Array.from(h.counts)).toEqual([2, 1, 0, 0, 0, 0, 0, 0, 0, 2]);
  });
});
