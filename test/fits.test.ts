import { gzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { FitsError, readFits, writeFits } from '../src/fits';
import { synthFits } from './helpers';

describe('readFits', () => {
  it('reads unsigned 16-bit data through BZERO', () => {
    const img = readFits(synthFits({
      bitpix: 16, width: 3, height: 2,
      raw: [-32768, -31314, 0, 1, 32767, -1],
      cards: [['BZERO', 32768], ['BSCALE', 1], ['IMAGETYP', 'BIAS'], ['ROWORDER', 'TOP-DOWN']],
    }));
    expect(img.width).toBe(3);
    expect(img.height).toBe(2);
    expect(Array.from(img.data)).toEqual([0, 1454, 32768, 32769, 65535, 32767]);
    expect(img.header.IMAGETYP).toBe('BIAS');
    expect(img.header.ROWORDER).toBe('TOP-DOWN');
  });

  it.each([
    [8, [0, 200]],
    [32, [-5, 100000]],
    [-32, [1.5, -2.25]],
    [-64, [1e-10, 3.5]],
  ] as const)('reads BITPIX %d', (bitpix, raw) => {
    const img = readFits(synthFits({ bitpix, width: 2, height: 1, raw: [...raw] }));
    expect(Array.from(img.data)).toEqual(raw.map((x) => Math.fround(x)));
  });

  it('applies BSCALE and maps BLANK to NaN', () => {
    const img = readFits(synthFits({ bitpix: 16, width: 3, height: 1, raw: [10, -1, 20], cards: [['BSCALE', 0.5], ['BZERO', 100], ['BLANK', -1]] }));
    expect(img.data[0]).toBe(105);
    expect(img.data[1]).toBeNaN();
    expect(img.data[2]).toBe(110);
  });

  it('parses strings, booleans, comments, quotes and CONTINUE', () => {
    const img = readFits(synthFits({
      bitpix: 8, width: 1, height: 1, raw: [0],
      rawCards: [
        "OBSERVER= 'O''Brien'           / who",
        "LONGSTR = 'abc&'",
        "CONTINUE  'def'",
        'EXPTIME =               3.0D+1 / [s] exposure',
        'COMMENT   just a comment',
        'HISTORY   step one',
      ],
    }));
    expect(img.header.OBSERVER).toBe("O'Brien");
    expect(img.cards.find((c) => c.key === 'OBSERVER')!.comment).toBe('who');
    expect(img.header.LONGSTR).toBe('abcdef');
    expect(img.header.EXPTIME).toBe(30);
    expect(img.header.SIMPLE).toBe(true);
    expect(img.cards.some((c) => c.key === 'HISTORY' && c.comment!.includes('step one'))).toBe(true);
  });

  it('uses the first extension with an image', () => {
    const img = readFits(synthFits({ bitpix: 16, width: 2, height: 2, raw: [1, 2, 3, 4], primaryEmpty: true }));
    expect(img.hdu).toBe(1);
    expect(Array.from(img.data)).toEqual([1, 2, 3, 4]);
  });

  it('reads 8-bit, 32-bit and 64-bit integers', () => {
    expect(Array.from(readFits(synthFits({ bitpix: 8, width: 2, height: 1, raw: [0, 255] })).data)).toEqual([0, 255]);
    expect(Array.from(readFits(synthFits({ bitpix: 32, width: 2, height: 1, raw: [-5, 100000] })).data)).toEqual([-5, 100000]);
    const img = readFits(synthFits({ bitpix: 64, width: 2, height: 1, raw: [-7, 65535], cards: [['BZERO', 10]] }));
    expect(Array.from(img.data)).toEqual([3, 65545]);
  });

  it('warns about colour images', () => {
    const rgb = readFits(synthFits({ bitpix: 16, width: 2, height: 1, planes: 3, raw: [1, 2, 3, 4, 5, 6] }));
    expect(rgb.warnings).toEqual(['colourPlanes']);
    expect(Array.from(rgb.data)).toEqual([1, 2]);
    const bayer = readFits(synthFits({ bitpix: 16, width: 2, height: 1, raw: [1, 2], cards: [['BAYERPAT', 'RGGB']] }));
    expect(bayer.warnings).toEqual(['bayer']);
  });

  it('reads gzip-compressed files', () => {
    const img = readFits(gzipSync(synthFits({ bitpix: 16, width: 2, height: 1, raw: [7, 8] })));
    expect(Array.from(img.data)).toEqual([7, 8]);
  });

  it('rejects files that are not FITS or are truncated', () => {
    expect(() => readFits(new TextEncoder().encode('hello'.padEnd(2880)))).toThrow(FitsError);
    const full = synthFits({ bitpix: 16, width: 100, height: 100, raw: [] });
    try {
      readFits(full.subarray(0, 2880 + 100));
      expect.unreachable();
    } catch (e) {
      expect((e as FitsError).code).toBe('truncated');
    }
  });
});

describe('writeFits', () => {
  it('round-trips float data and drops checksums', () => {
    const src = readFits(synthFits({
      bitpix: 16, width: 2, height: 2, raw: [1, 2, 3, 4],
      cards: [['BZERO', 32768], ['FILTER', 'r'], ['CHECKSUM', 'abc'], ['DATASUM', '1']],
    }));
    const data = Float32Array.from([1.5, 2.5, -3, 4e5]);
    const bytes = writeFits({ width: 2, height: 2, data }, src.cards, ['master bias: median of 5 frames']);
    expect(bytes.length % 2880).toBe(0);
    const back = readFits(bytes);
    expect(back.bitpix).toBe(-32);
    expect(Array.from(back.data)).toEqual(Array.from(data));
    expect(back.header.FILTER).toBe('r');
    expect(back.header.BZERO).toBeUndefined();
    expect(back.header.CHECKSUM).toBeUndefined();
    expect(back.cards.some((c) => c.key === 'HISTORY' && c.comment!.includes('master bias'))).toBe(true);
  });
});
