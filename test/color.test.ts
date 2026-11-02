import { beforeEach, describe, expect, it } from 'vitest';
import {
  autoBlack, backgroundLevels, channelLevel, compositionName, initialChannel, newComposition, render, stretchValue,
  wavelengthOrder,
} from '../src/color';
import { fitsBytes, fitsExports } from '../src/export';
import { readFits, type FitsImage } from '../src/fits';
import { importFiles } from '../src/import';
import { BUILT_IN_PROFILES } from '../src/instrument/profile';
import { refreshAll } from '../src/masters';
import { open, serialize } from '../src/project';
import { stackImage } from '../src/stack';
import { state } from '../src/state';
import type { Composition } from '../src/types';
import { synthFits } from './helpers';

const plane = (values: number[]): FitsImage => ({
  width: values.length, height: 1, data: Float32Array.from(values), cards: [], header: {}, bitpix: -32, hdu: 0, warnings: [],
});

function composition(filters: [string | null, string | null, string | null]): Composition {
  const c = newComposition('c1');
  c.channels.R.filter = filters[0];
  c.channels.G.filter = filters[1];
  c.channels.B.filter = filters[2];
  return c;
}

describe('colour', () => {
  it('scales between the black and white point, then stretches', () => {
    const lin = { type: 'linear' as const, strength: 1 };
    const asinh = { type: 'asinh' as const, strength: 100 };
    expect(stretchValue(0.5, lin)).toBe(0.5);
    expect(stretchValue(2, lin)).toBe(1);
    expect(stretchValue(-1, lin)).toBe(0);
    expect(stretchValue(NaN, asinh)).toBe(0);
    expect(stretchValue(1, asinh)).toBeCloseTo(1, 10);
    // Faint parts become much brighter
    expect(stretchValue(0.01, asinh)).toBeGreaterThan(0.1);
    expect(channelLevel(150, { filter: 'V', black: 100, white: 300, weight: 2 }, lin)).toBe(0.5);
  });

  it('renders each filter into its channel', () => {
    const images: Record<string, FitsImage> = { R: plane([0, 100, 50]), V: plane([100, 0, 50]) };
    const c = composition(['R', 'V', null]);
    c.channels.R = { filter: 'R', black: 0, white: 100, weight: 1 };
    c.channels.G = { filter: 'V', black: 0, white: 100, weight: 1 };
    const img = render(c, (f) => images[f])!;
    expect([...img.rgba]).toEqual([0, 255, 0, 255, 255, 0, 0, 255, 128, 128, 0, 255]);
    expect(render(composition([null, null, null]), (f) => images[f])).toBeNull();
  });

  it('sets the black point from the background, so the sky is neutral', () => {
    const sky = (level: number, star: number) => plane([...Array.from({ length: 99 }, (_, i) => level + (i % 5) - 2), star]);
    const images: Record<string, FitsImage> = { R: sky(1200, 40000), V: sky(1100, 30000), B: sky(560, 9000) };
    const c = composition(['R', 'V', 'B']);
    for (const ch of ['R', 'G', 'B'] as const) c.channels[ch] = initialChannel(c.channels[ch].filter, images[c.channels[ch].filter!]);
    expect(c.channels.B).toMatchObject({ black: 558, white: 9000, weight: 1 });
    c.stretch = { type: 'asinh', strength: 1000 };
    const before = backgroundLevels(c, (f) => images[f]);
    expect(before.B).toBeGreaterThan(before.R!);
    for (const ch of ['R', 'G', 'B'] as const) c.channels[ch].black = autoBlack(images[c.channels[ch].filter!], c.channels[ch], c.stretch);
    expect(c.channels.R.black).toBeLessThan(1200);
    // 10 % grey, i.e. 25.5 on the 0–255 scale
    for (const v of Object.values(backgroundLevels(c, (f) => images[f]))) expect(Math.abs(v - 25.5)).toBeLessThanOrEqual(0.5);
    c.stretch = { type: 'linear', strength: 1000 };
    c.channels.R.black = autoBlack(images.R, c.channels.R, c.stretch);
    expect(Math.abs(backgroundLevels(c, (f) => images[f]).R! - 25.5)).toBeLessThanOrEqual(0.5);
  });

  it('checks that the filters go from short to long wavelength', () => {
    const p = BUILT_IN_PROFILES[0];
    expect(wavelengthOrder(composition(['R', 'V', 'B']), p)).toBe('ordered');
    expect(wavelengthOrder(composition(['i', 'r', 'g']), p)).toBe('ordered');
    expect(wavelengthOrder(composition(['B', 'V', 'R']), p)).toBe('reversed');
    expect(wavelengthOrder(composition(['V', 'R', 'B']), p)).toBe('mixed');
    expect(wavelengthOrder(composition(['Ha', 'OIII', 'OIII']), p)).toBe('ordered');
    expect(wavelengthOrder(composition(['R', 'V', 'X']), p)).toBe('unknown');
    expect(wavelengthOrder(composition(['R', null, 'B']), p)).toBe('incomplete');
    expect(compositionName(composition(['R', 'V', 'B']))).toBe('BVR');
    expect(compositionName(composition(['SII', 'Ha', 'OIII']))).toBe('OIII·Ha·SII');
  });
});

describe('export and saving', () => {
  beforeEach(() => state.clear());

  const W = 40;
  const H = 30;
  const star = (x: number, y: number) => Array.from({ length: W * H }, (_, i) =>
    1000 + ((i * 7919) % 11) + 8000 * Math.exp(-(((i % W) - x) ** 2 + (Math.floor(i / W) - y) ** 2) / 3));
  const light = (name: string, filter: string, minute: number) => ({
    name,
    file: new File([synthFits({
      bitpix: -32, width: W, height: H, raw: star(20, 15),
      cards: [['IMAGETYP', 'LIGHT'], ['FILTER', filter], ['EXPTIME', 30], ['DATE-OBS', `2026-10-21T20:0${minute}:00`], ['ROWORDER', 'TOP-DOWN']],
    })], name),
  });

  async function stacked(): Promise<void> {
    await importFiles([light('r1.fits', 'R', 0), light('r2.fits', 'r', 1), light('v1.fits', 'V', 2)]);
    for (const s of ['trim', 'bias', 'dark', 'flat', 'calibrate', 'align', 'stack'] as const) state.setStep(s, { done: true });
    state.updateSettings({ trim: null, transforms: {} });
    // All frames are the same, so no shift is needed
    const ids = state.framesOf('light').map((f) => f.meta.id);
    state.updateSettings({ transforms: Object.fromEntries(ids.slice(1).map((id) => [id, { dx: 0, dy: 0, rotation: 0, source: 'auto' as const }])) });
    refreshAll();
  }

  it('names FITS files so that R and r do not clash, and keeps the history', async () => {
    await stacked();
    const files = fitsExports();
    expect(files.map((f) => f.fileName)).toEqual(['stack-R-johnson-cousins.fits', 'stack-V.fits', 'stack-r-sloan.fits']);
    const back = readFits(fitsBytes(files[1]));
    expect(back.width).toBe(W);
    expect(back.bitpix).toBe(-32);
    expect(back.header.ROWORDER).toBe('TOP-DOWN');
    expect(back.header.IMAGETYP).toBe('STACKED LIGHT');
    const history = back.cards.filter((c) => c.key === 'HISTORY').map((c) => c.comment).join('\n');
    expect(history).toMatch(/Stacked: median of 1 aligned frames/);
    expect(history).toMatch(/Written by Astrofoto/);
    expect(back.data[15 * W + 20]).toBeCloseTo(stackImage('V')!.data[15 * W + 20], 3);
  });

  it('keeps colour images in the project file', async () => {
    await stacked();
    const c = composition(['R', 'V', 'r']);
    c.name = 'Proov';
    state.addComposition(c);
    const bytes = serialize();
    state.clear();
    expect(state.compositions).toEqual([]);
    open(bytes);
    expect(state.compositions).toHaveLength(1);
    expect(state.compositions[0]).toMatchObject({ id: 'c1', name: 'Proov', channels: { B: { filter: 'r' } } });
    expect(state.newCompositionId()).toBe('c2');
    expect(state.composition('color:c1')).toBe(state.compositions[0]);
  });
});
