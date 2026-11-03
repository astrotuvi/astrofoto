import { beforeEach, describe, expect, it } from 'vitest';
import { backgroundLevels } from '../src/color';
import { importFiles } from '../src/import';
import { refreshAll } from '../src/masters';
import { quickFilters, quickLook, quickLookFrames, renderQuickLook, stackRegion } from '../src/quicklook';
import { stackImage } from '../src/stack';
import { state } from '../src/state';
import { synthFits } from './helpers';

const W = 40;
const H = 30;

/** A star on a sky whose level differs by filter. */
function light(name: string, filter: string, minute: number, sky: number) {
  const raw = Array.from({ length: W * H }, (_, i) =>
    sky + ((i * 7919) % 11) + 8000 * Math.exp(-(((i % W) - 20) ** 2 + (Math.floor(i / W) - 15) ** 2) / 3));
  return {
    name,
    file: new File([synthFits({
      bitpix: -32, width: W, height: H, raw,
      cards: [['IMAGETYP', 'LIGHT'], ['FILTER', filter], ['EXPTIME', 30], ['DATE-OBS', `2026-10-21T20:${String(minute).padStart(2, '0')}:00`], ['ROWORDER', 'TOP-DOWN']],
    })], name),
  };
}

describe('quick look', () => {
  beforeEach(() => state.clear());

  it('chooses the filters as in the colour step', () => {
    expect(quickFilters(['B', 'I', 'R', 'U', 'V'])).toEqual({ B: 'B', G: 'V', R: 'R' });
    expect(quickFilters(['g', 'i', 'r', 'z'])).toEqual({ B: 'g', G: 'r', R: 'i' });
    expect(quickFilters(['Ha', 'OIII', 'SII'])).toEqual({ B: 'OIII', G: 'Ha', R: 'SII' });
    expect(quickFilters(['B', 'V'])).toBeNull();
  });

  it('takes the frames closest together in time, with a neutral sky', async () => {
    await importFiles([
      light('b1.fits', 'B', 0, 500), light('b2.fits', 'B', 5, 500),
      light('v1.fits', 'V', 1, 900), light('v2.fits', 'V', 9, 900),
      light('r1.fits', 'R', 7, 1300), light('r2.fits', 'R', 8, 1300),
    ]);
    const f = quickLookFrames()!;
    expect([f.B.meta.fileName, f.G.meta.fileName, f.R.meta.fileName]).toEqual(['b2.fits', 'v2.fits', 'r1.fits']);
    const q = quickLook()!;
    const images = new Map([['B', f.B.image], ['V', f.G.image], ['R', f.R.image]]);
    // 10 % grey, i.e. 25.5 on the 0–255 scale, in every channel
    for (const v of Object.values(backgroundLevels(q.composition, (x) => images.get(x)))) expect(Math.abs(v - 25.5)).toBeLessThanOrEqual(1);
    expect(renderQuickLook(q)).toMatchObject({ width: W, height: H });
  });

  it('is cropped to the area of the stacks for comparing', async () => {
    await importFiles([light('b.fits', 'B', 0, 500), light('v.fits', 'V', 1, 900), light('r.fits', 'R', 2, 1300)]);
    expect(stackRegion()).toBeNull();
    for (const s of ['trim', 'bias', 'dark', 'flat', 'calibrate', 'align', 'stack'] as const) state.setStep(s, { done: true });
    const ids = state.framesOf('light').map((f) => f.meta.id);
    state.updateSettings({ trim: { x0: 2, x1: 37, y0: 1, y1: 28 }, referenceId: ids[0] });
    state.updateSettings({ transforms: Object.fromEntries(ids.slice(1).map((id) => [id, { dx: 0, dy: 0, rotation: 0, source: 'auto' as const }])) });
    refreshAll();
    const st = stackImage('V')!;
    const img = renderQuickLook(quickLook()!, stackRegion());
    expect(img).toMatchObject({ width: st.width, height: st.height });
    expect(stackRegion()!.x0).toBeGreaterThanOrEqual(2);
  });
});
