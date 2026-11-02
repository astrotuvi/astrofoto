import { beforeEach, describe, expect, it } from 'vitest';
import { runChecks } from '../src/checks';
import { importFiles } from '../src/import';
import { state } from '../src/state';
import { synthFits } from './helpers';

const file = (name: string, type: string, opts: { filter?: string; exp?: number; temp?: number; width?: number } = {}) => {
  const width = opts.width ?? 4;
  const bytes = synthFits({
    bitpix: 16, width, height: 4, raw: new Array(width * 4).fill(100),
    cards: [['IMAGETYP', type], ['FILTER', opts.filter ?? 'V'], ['EXPTIME', opts.exp ?? 30], ['CCD-TEMP', opts.temp ?? -60]],
  });
  return { file: new File([bytes], name), name };
};

describe('consistency checks', () => {
  beforeEach(() => state.clear());

  it('finds size, exposure, temperature and filter problems', async () => {
    await importFiles([
      file('b1.fits', 'BIAS', { exp: 0 }),
      file('b2.fits', 'BIAS', { exp: 0, width: 6 }),
      file('d1.fits', 'DARK', { exp: 60, temp: -50 }),
      file('f1.fits', 'FLAT', { filter: 'V', exp: 3 }),
      file('l1.fits', 'LIGHT', { filter: 'V' }),
      file('l2.fits', 'LIGHT', { filter: 'R' }),
    ]);
    const codes = runChecks().map((c) => c.code).sort();
    expect(codes).toEqual(['darkExposure', 'darkTemperature', 'noFlatForFilter', 'sizeMismatch']);
    expect(runChecks().find((c) => c.code === 'sizeMismatch')!.params.files).toBe('b2.fits');
  });

  it('reports missing frame types', async () => {
    await importFiles([file('l1.fits', 'LIGHT')]);
    expect(runChecks().map((c) => c.code).sort()).toEqual(['noBias', 'noDarks', 'noFlats']);
  });
});
