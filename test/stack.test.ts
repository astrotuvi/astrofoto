import { beforeEach, describe, expect, it } from 'vitest';
import { importFiles } from '../src/import';
import { refreshAll } from '../src/masters';
import { open, serialize } from '../src/project';
import { lightsByTime, referenceFrame, runAuto, stackId, updateManualTransforms, useAuto } from '../src/stack';
import { state } from '../src/state';
import { synthFits } from './helpers';

const W = 120;
const H = 100;
const STARS = [[30, 25, 4000], [80, 30, 3000], [55, 70, 5000], [95, 80, 2500], [20, 75, 3500]];

/** A light with Gaussian stars, seen shifted by −(dx, dy) relative to the reference. */
function light(name: string, filter: string, date: string, dx: number, dy: number, hit?: [number, number]) {
  const raw = Array.from({ length: W * H }, (_, i) => {
    const x = i % W;
    const y = Math.floor(i / W);
    let v = 100 + ((i * 7919) % 13) - 6;
    for (const [sx, sy, f] of STARS) v += f * Math.exp(-((x - sx + dx) ** 2 + (y - sy + dy) ** 2) / (2 * 1.6 ** 2));
    if (hit && x === hit[0] && y === hit[1]) v += 20000;
    return v;
  });
  return {
    name,
    file: new File([synthFits({ bitpix: -32, width: W, height: H, raw, cards: [['IMAGETYP', 'LIGHT'], ['FILTER', filter], ['EXPTIME', 30], ['DATE-OBS', date]] })], name),
  };
}

async function loadLights(): Promise<void> {
  await importFiles([
    light('v2.fits', 'V', '2026-10-21T20:01:00', 2, -1, [60, 50]),
    light('v1.fits', 'V', '2026-10-21T20:00:00', 0, 0),
    light('v3.fits', 'V', '2026-10-21T20:02:00', 1.5, 0.5),
    light('b1.fits', 'B', '2026-10-21T20:03:00', 3, 1),
    light('b2.fits', 'B', '2026-10-21T20:04:00', 3.5, 1.5),
  ]);
  // Trimming moves the calibrated pixel grid; stars and transforms stay in raw coordinates
  state.updateSettings({ trim: { x0: 4, x1: W - 1, y0: 0, y1: H - 1 } });
  for (const s of ['trim', 'bias', 'dark', 'flat', 'calibrate'] as const) state.setStep(s, { done: true });
  refreshAll();
}

const id = (name: string) => state.frames.find((f) => f.meta.fileName === name)!.meta.id;

describe('alignment and stacking', () => {
  beforeEach(() => state.clear());

  it('uses the first frame in time as the reference', async () => {
    await loadLights();
    expect(lightsByTime().map((f) => f.meta.fileName)).toEqual(['v1.fits', 'v2.fits', 'v3.fits', 'b1.fits', 'b2.fits']);
    expect(referenceFrame()!.meta.fileName).toBe('v1.fits');
  });

  it('aligns automatically, crops to the common area and stacks per filter', async () => {
    await loadLights();
    runAuto();
    const a = state.auto.get(id('b2.fits'))!;
    expect(a.dx).toBeCloseTo(3.5, 1);
    expect(a.dy).toBeCloseTo(1.5, 1);
    expect(useAuto(lightsByTime().map((f) => f.meta.id))).toEqual([]);

    state.setStep('align', { done: true });
    state.setStep('stack', { done: true });
    refreshAll();
    // Largest shifts: x +3.5 (left edge lost), y −1 and +1.5; fitted shifts are not exact, so ±1 px
    const crop = state.alignCrop!;
    const near = (v: number, e: number) => expect(Math.abs(v - e)).toBeLessThanOrEqual(1);
    near(crop.x0, 4);
    near(crop.x1, W - 4 - 1);
    near(crop.y0, 2);
    near(crop.y1, H - 2);
    const stack = state.stacks.get(stackId('V'))!;
    expect(stack.count).toBe(3);
    expect(stack.image.width).toBe(crop.x1 - crop.x0 + 1);
    expect([...state.stacks.keys()].sort()).toEqual([stackId('B'), stackId('V')]);

    // The median removes the cosmic-ray hit of v2 (at raw 60, 50 → reference 62, 49)
    const at = (x: number, y: number) => stack.image.data[(y - crop.y0) * stack.image.width + (x - 4 - crop.x0)];
    expect(at(62, 49)).toBeLessThan(200);
    state.updateSettings({ combine: { ...state.settings.combine, stack: 'mean' } });
    refreshAll();
    expect(state.stacks.get(stackId('V'))!.image.data[(49 - crop.y0) * stack.image.width + (62 - 4 - crop.x0)]).toBeGreaterThan(5000);
  });

  it('computes the shift from stars clicked in the same order', async () => {
    await loadLights();
    const ref = id('v1.fits');
    const v2 = id('v2.fits');
    state.updateSettings({ manualStars: { [ref]: [[30, 25], [80, 30]], [v2]: [[28, 26], [78, 31]] } });
    updateManualTransforms([v2]);
    expect(state.settings.transforms[v2]).toEqual({ dx: 2, dy: -1, rotation: 0, source: 'manual' });
    expect(state.settings.transforms[ref]).toBeUndefined();
  });

  it('keeps the alignment in the project file and recomputes the stacks', async () => {
    await loadLights();
    runAuto();
    useAuto(lightsByTime().map((f) => f.meta.id));
    state.setStep('align', { done: true });
    state.setStep('stack', { done: true });
    refreshAll();
    const before = state.stacks.get(stackId('B'))!.image.data.slice();
    const bytes = serialize();
    state.clear();
    open(bytes);
    expect(Object.keys(state.settings.transforms)).toHaveLength(4);
    expect(state.settings.combine.stack).toBe('median');
    expect(state.stacks.get(stackId('B'))!.image.data).toEqual(before);
  });
});
