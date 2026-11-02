import { gzipSync, zipSync } from 'fflate';
import { beforeEach, describe, expect, it } from 'vitest';
import { importFiles, picked } from '../src/import';
import { state } from '../src/state';
import { synthFits } from './helpers';

const frame = (type: string, filter = '') =>
  synthFits({ bitpix: 16, width: 4, height: 4, raw: new Array(16).fill(100), cards: [['IMAGETYP', type], ['FILTER', filter], ['TELESCOP', 'AZT-12'], ['INSTRUME', 'Andor CCD']] });

describe('importFiles', () => {
  beforeEach(() => state.clear());

  it('unpacks zip files, skipping hidden and non-FITS entries', async () => {
    const zip = zipSync({
      'set/BIAS-001.fits': frame('BIAS'),
      'set/LIGHT-r-001.fits.gz': gzipSync(frame('LIGHT', 'r')),
      'set/readme.txt': new TextEncoder().encode('hi'),
      '__MACOSX/set/._BIAS-001.fits': new Uint8Array(10),
    });
    const result = await importFiles(picked([new File([new Uint8Array(zip)], 'data.zip')]));
    expect(result.added).toBe(2);
    expect(result.problems.map((p) => p.reason)).toEqual(['notFits']);
    expect(state.profile?.id).toBe('to-azt12-andor');
    expect(state.frames.map((f) => [f.meta.kind, f.meta.filter])).toEqual([['bias', ''], ['light', 'r']]);
  });

  it('reports duplicates and unreadable files', async () => {
    await importFiles([{ file: new File([frame('DARK')], 'd.fits'), name: 'd.fits' }]);
    const result = await importFiles([
      { file: new File([frame('DARK')], 'd.fits'), name: 'd.fits' },
      { file: new File([new Uint8Array(100)], 'bad.fits'), name: 'bad.fits' },
    ]);
    expect(result.added).toBe(0);
    expect(result.problems.map((p) => p.reason).sort()).toEqual(['duplicate', 'notFits']);
  });
});
