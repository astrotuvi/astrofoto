import { unzipSync, zipSync, strToU8 } from 'fflate';
import { beforeEach, describe, expect, it } from 'vitest';
import { calibrateLight } from '../src/calibrate';
import { importFiles } from '../src/import';
import { calibrateLights, refreshAll } from '../src/masters';
import { compareVersions, open, ProjectError, serialize } from '../src/project';
import { masterId, state } from '../src/state';
import { synthFits } from './helpers';

const W = 6;
const frame = (name: string, type: string, value: number, filter = 'V', exp = 30) => ({
  name,
  file: new File([synthFits({
    bitpix: 16, width: W, height: 4, raw: Array.from({ length: W * 4 }, (_, i) => value + (i % W === 0 ? -value + 5 : 0)),
    cards: [['IMAGETYP', type], ['FILTER', filter], ['EXPTIME', exp]],
  })], name),
});

async function loadSet(): Promise<void> {
  await importFiles([
    frame('b1.fits', 'BIAS', 1000, 'V', 0), frame('b2.fits', 'BIAS', 1002, 'V', 0),
    frame('d1.fits', 'DARK', 1030, 'V', 60),
    frame('f1.fits', 'FLAT', 21000), frame('f2.fits', 'FLAT', 31000),
    frame('l1.fits', 'LIGHT', 1500), frame('l2.fits', 'LIGHT', 1600),
  ]);
}

describe('calibrating lights', () => {
  beforeEach(() => state.clear());

  it('applies bias, scaled dark and flat', () => {
    const p = (v: number) => ({ width: 1, height: 1, data: Float32Array.of(v) });
    const r = calibrateLight(p(1500), p(1000), { plane: p(30), scale: 0.5 }, p(0.5));
    expect(r.data[0]).toBe((1500 - 1000 - 15) / 0.5);
    expect(calibrateLight(p(1500), null, null, p(0)).data[0]).toBeNaN();
  });

  it('builds masters and calibrated lights in order, with the dark scaled by exposure', async () => {
    await loadSet();
    state.updateSettings({ trim: { x0: 1, x1: W - 1, y0: 0, y1: 3 } });
    for (const s of ['trim', 'bias', 'dark', 'flat', 'calibrate'] as const) state.setStep(s, { done: true });
    refreshAll();
    expect(state.masters.get(masterId('dark'))!.image.data[0]).toBe(29); // 1030 − median(1000, 1002)
    const cal = state.calibrated.get(state.framesOf('light')[0].meta.id)!;
    // (1500 − 1001 − 29 × 30/60) / 1
    expect(cal.data[0]).toBeCloseTo(484.5, 4);
    expect(cal.width).toBe(W - 1);

    state.updateSettings({ useFlat: false, useDark: false });
    calibrateLights();
    expect(state.calibrated.get(state.framesOf('light')[0].meta.id)!.data[0]).toBe(499);
  });

  it('keeps a step done that was skipped for lack of frames', async () => {
    await importFiles([frame('l1.fits', 'LIGHT', 1500)]);
    state.setStep('bias', { done: true });
    refreshAll();
    expect(state.isDone('bias')).toBe(true);
  });
});

describe('project file', () => {
  beforeEach(() => state.clear());

  it('saves and reopens frames, corrections, settings and answers', async () => {
    await loadSet();
    const light = state.framesOf('light')[1];
    state.updateMeta(light.meta.id, { filter: 'R', kindSource: 'user', excluded: true });
    state.updateSettings({ trim: { x0: 1, x1: W - 1, y0: 0, y1: 3 }, combine: { bias: 'mean', dark: 'median', flat: 'median', stack: 'median' } });
    for (const s of ['trim', 'bias', 'dark', 'flat', 'calibrate'] as const) state.setStep(s, { done: true });
    state.setInfo({ title: 'M57', student: 'Mari' });
    state.setAnswer('bias-noise.mean', { value: '1001', correct: true, attempts: 1 });
    state.useHint('bias-noise', 2);
    refreshAll();
    const before = Array.from(state.calibrated.get(state.framesOf('light')[0].meta.id)!.data);

    const bytes = serialize();
    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual(['frames/b1.fits', 'frames/b2.fits', 'frames/d1.fits', 'frames/f1.fits', 'frames/f2.fits', 'frames/l1.fits', 'frames/l2.fits', 'project.json']);

    state.clear();
    expect(state.frames).toHaveLength(0);
    open(bytes);

    expect(state.frames).toHaveLength(7);
    expect(state.dirty).toBe(false);
    expect(state.info.title).toBe('M57');
    expect(state.settings.combine.bias).toBe('mean');
    expect(state.answers['bias-noise.mean'].value).toBe('1001');
    expect(state.hintsUsed['bias-noise']).toBe(2);
    const reopened = state.frame(light.meta.id)!;
    expect(reopened.meta.filter).toBe('R');
    expect(reopened.meta.excluded).toBe(true);
    expect(reopened.meta.header.FILTER).toBe('V');
    // Masters and calibrated frames are recomputed, not stored
    expect(state.masters.size).toBe(3);
    expect(Array.from(state.calibrated.get(state.framesOf('light')[0].meta.id)!.data)).toEqual(before);
    // New frames get fresh ids
    expect(state.newId()).toBe('f8');
  });

  it('rejects files that are not projects', () => {
    expect(() => open(new Uint8Array([1, 2, 3]))).toThrow(ProjectError);
    expect(() => open(zipSync({ 'x.txt': strToU8('hi') }))).toThrow(ProjectError);
    const newer = zipSync({ 'project.json': strToU8(JSON.stringify({ version: 99, appVersion: '9.0.0', frames: [] })) });
    try {
      open(newer);
      expect.unreachable();
    } catch (e) {
      expect((e as ProjectError).code).toBe('newerFormat');
    }
  });

  it('compares versions', () => {
    expect(compareVersions('0.3.0', '0.2.9')).toBe(1);
    expect(compareVersions('0.2', '0.2.0')).toBe(0);
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1);
  });
});
