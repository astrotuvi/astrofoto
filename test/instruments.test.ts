// Headers in the style of common capture programs, so files from other telescopes are tested
// without real data. The keywords follow each program's usual output; values are made up.

import { describe, expect, it } from 'vitest';
import type { HeaderValue } from '../src/fits';
import { canonicalFilter } from '../src/instrument/defaults';
import { describeFrame, filterInfo, gainInfo, instrumentNames, matchProfile, pixelScaleInfo, redescribe, saturationInfo } from '../src/instrument/profile';
import { checkProfile, parseProfileFile, ProfileError, serializeProfile } from '../src/instrument/profilefile';

type Header = Record<string, HeaderValue>;
const size = { width: 1000, height: 800 };

function read(header: Header, fileName = 'frame.fits') {
  const p = matchProfile(header);
  return { p, m: describeFrame('a', fileName, header, size, p) };
}

describe('headers from capture programs', () => {
  it('N.I.N.A.: EGAIN is the gain, GAIN only the camera setting', () => {
    const header: Header = {
      IMAGETYP: 'LIGHT', EXPOSURE: 120, EXPTIME: 120, XBINNING: 1, YBINNING: 1,
      GAIN: 100, OFFSET: 50, EGAIN: 0.78, XPIXSZ: 3.76, YPIXSZ: 3.76,
      INSTRUME: 'ZWO ASI2600MM Pro', TELESCOP: 'Refractor 250', FOCALLEN: 250,
      FILTER: 'Lum', 'CCD-TEMP': -10, 'DATE-OBS': '2026-10-21T20:15:00.123', ROWORDER: 'TOP-DOWN',
    };
    const { p, m } = read(header);
    expect(m.kind).toBe('light');
    expect(m.filter).toBe('Lum');
    expect(m.exposure).toBe(120);
    expect(m.temperature).toBe(-10);
    expect(filterInfo(p, m.filter)?.wavelengthNm).toBe(550);
    expect(gainInfo(header, p)).toEqual({ value: 0.78, source: 'header', key: 'EGAIN' });
    expect(gainInfo({ GAIN: 100 }, p)).toBeUndefined();
    const scale = pixelScaleInfo(header, p)!;
    expect(scale.source).toBe('optics');
    expect(scale.value).toBeCloseTo(3.102, 3);
  });

  it('MaxIm DL: frame types with "Frame" and "Field"', () => {
    for (const [value, kind] of [['Light Frame', 'light'], ['Dark Frame', 'dark'], ['Bias Frame', 'bias'], ['Flat Field', 'flat']]) {
      expect(read({ IMAGETYP: value, EXPTIME: 30, FILTER: 'Red', SWCREATE: 'MaxIm DL Version 6.40' }).m.kind).toBe(kind);
    }
    const header: Header = { IMAGETYP: 'Light Frame', XBINNING: 2, YBINNING: 2, XPIXSZ: 18, FOCALLEN: 1000, FILTER: 'Red' };
    const { p, m } = read(header);
    expect(m.xbin).toBe(2);
    expect(filterInfo(p, m.filter)?.wavelengthNm).toBe(630);
    // XPIXSZ already includes the binning (2 × 9 µm)
    expect(pixelScaleInfo(header, p)!.value).toBeCloseTo(3.713, 3);
    expect(pixelScaleInfo(header, { ...p, pixelSizeIncludesBinning: false })!.value).toBeCloseTo(7.426, 3);
  });

  it('KStars/Ekos (INDI): FRAME and PIXSIZE1', () => {
    const header: Header = { FRAME: 'Flat', PIXSIZE1: 4.63, FOCALLEN: 530, XBINNING: 1, FILTER: 'H_Alpha', EXPTIME: 2 };
    const { p, m } = read(header);
    expect(m.kind).toBe('flat');
    expect(m.kindSource).toBe('header');
    expect(filterInfo(p, m.filter)?.wavelengthNm).toBe(656);
    expect(pixelScaleInfo(header, p)!.key).toBe('FOCALLEN, PIXSIZE1');
  });

  it('observatory software: OBSTYPE, ZERO and CCDSUM', () => {
    const bias = read({ OBSTYPE: 'ZERO', CCDSUM: '2 2', EXPTIME: 0 });
    expect(bias.m.kind).toBe('bias');
    expect(bias.m.xbin).toBe(2);
    expect(bias.m.ybin).toBe(2);
    expect(read({ OBSTYPE: 'OBJECT', CCDSUM: '1 2' }).m.ybin).toBe(2);
    expect(read({ IMAGETYP: 'zero' }).m.kind).toBe('bias');
    expect(read({ OBSTYPE: 'DOMEFLAT' }).m.kind).toBe('flat');
  });

  it('Las Cumbres style: EXPOSE, Sloan "rp" and PIXSCALE', () => {
    const header: Header = { OBSTYPE: 'EXPOSE', FILTER: 'rp', PIXSCALE: 0.389, CCDSUM: '2 2', 'DATE-OBS': '2026-03-01T01:02:03.000' };
    const { p, m } = read(header);
    expect(m.kind).toBe('light');
    expect(filterInfo(p, m.filter)).toEqual({ wavelengthNm: 623, system: 'Sloan' });
    expect(pixelScaleInfo(header, p)).toEqual({ value: 0.389, source: 'header', key: 'PIXSCALE' });
    expect(read({ OBSTYPE: 'SKYFLAT', FILTER: 'gp' }).m.kind).toBe('flat');
  });

  it('prefers DATE-OBS and MJD-OBS over the file date', () => {
    expect(read({ DATE: '2026-11-01T10:00:00', 'MJD-OBS': 61334.5 }).m.dateObs).toBe('2026-10-21T12:00:00.000Z');
  });

  it('falls back to the WCS for the pixel scale', () => {
    const p = matchProfile({});
    expect(pixelScaleInfo({ CD1_1: -2.8e-4, CD2_1: 1e-6 }, p)!.value).toBeCloseTo(1.008, 3);
    expect(pixelScaleInfo({ CDELT1: -5e-4 }, p)).toEqual({ value: 1.8, source: 'wcs', key: 'CDELT1' });
    expect(pixelScaleInfo({}, p)).toBeUndefined();
    expect(pixelScaleInfo({ CDELT1: -5e-4 }, { ...p, pixelScale: 0.5 })).toEqual({ value: 0.5, source: 'profile' });
  });
});

describe('telescope and camera names', () => {
  it('uses the profile’s names, else the header', () => {
    const header: Header = { TELESCOP: 'AZT-12', INSTRUME: 'Ascom Driver for Andor CCD Cameras' };
    const p = matchProfile(header);
    expect(instrumentNames(header, p)).toEqual({ telescope: 'AZT-12', camera: 'Ascom Driver for Andor CCD Cameras' });
    expect(instrumentNames(header, { ...p, camera: 'Andor iKon-M' })).toEqual({ telescope: 'AZT-12', camera: 'Andor iKon-M' });
    expect(instrumentNames({}, null)).toEqual({ telescope: '', camera: '' });
  });
});

describe('saturation level', () => {
  const p = matchProfile({});
  it('uses the profile, then SATURATE/DATAMAX, then 95 % of the data type', () => {
    expect(saturationInfo({ BITPIX: 16, BZERO: 32768 }, { ...p, saturationLevel: 60000 })).toEqual({ value: 60000, source: 'profile' });
    expect(saturationInfo({ BITPIX: 16, BZERO: 32768, SATURATE: 50000 }, p)).toEqual({ value: 50000, source: 'header', key: 'SATURATE' });
    expect(saturationInfo({ BITPIX: 16, BZERO: 32768 }, p)).toEqual({ value: 62258, source: 'estimate' });
    expect(saturationInfo({ BITPIX: 16 }, p)!.value).toBe(31129);
    expect(saturationInfo({ BITPIX: -32 }, p)).toBeUndefined();
  });
});

describe('filter names', () => {
  it('finds the built-in filter under other spellings', () => {
    const cases: [string, string | undefined][] = [
      ['Luminance', 'L'], ['Clear', 'L'], ['l', 'L'], ['Red filter', 'Red'], ['blue', 'Blue'],
      ["r'", 'r'], ['SDSS g', 'g'], ['Sloan i', 'i'], ['ip', 'i'], ['zp', 'z'],
      ['Bessell V', 'V'], ['Johnson B', 'B'], ['v', 'V'], ['R filter', 'R'],
      ['H-Alpha', 'Ha'], ['Halpha', 'Ha'], ['O III', 'OIII'], ['S2', 'SII'], ['Hbeta', 'Hb'],
      ['Methane', undefined], ['', undefined],
    ];
    for (const [name, expected] of cases) expect(canonicalFilter(name), name).toBe(expected);
  });

  it('keeps the case of exact names and lets the profile win', () => {
    const p = matchProfile({});
    expect(filterInfo(p, 'r')?.system).toBe('Sloan');
    expect(filterInfo(p, 'R')?.system).toBe('Johnson-Cousins');
    expect(filterInfo({ ...p, filters: { Lum: { wavelengthNm: 540 } } }, 'Lum')?.wavelengthNm).toBe(540);
    expect(filterInfo(null, 'Methane')).toBeUndefined();
  });
});

describe('reading headers again with a changed profile', () => {
  it('uses new keywords but keeps the student’s own choices', () => {
    const p = matchProfile({});
    const header: Header = { PICTTYPE: 'flat', FILTER: 'B' };
    const guessed = describeFrame('a', 'img1.fits', header, size, p);
    expect(guessed.kindSource).toBe('guess');
    const withKeyword = { ...p, keywords: { kind: ['PICTTYPE'] } };
    expect(redescribe(guessed, withKeyword).kind).toBe('flat');

    const own = { ...guessed, kind: 'dark' as const, kindSource: 'user' as const, filter: '', excluded: true };
    const again = redescribe(own, withKeyword);
    expect(again.kind).toBe('dark');
    expect(again.excluded).toBe(true);

    const typed = { ...describeFrame('b', 'b.fits', { IMAGETYP: 'LIGHT', FILTER: 'B' }, size, p), filter: 'V', filterEdited: true };
    expect(redescribe(typed, withKeyword).filter).toBe('V');
  });
});

describe('profile files', () => {
  const profile = checkProfile({
    id: 'club-c8', name: 'Club C8', telescope: 'Celestron C8', camera: 'ZWO ASI1600MM', match: { telescop: 'C8' },
    keywords: { kind: ['picttype'] }, kindValues: { light: ['sky'] },
    trim: { x0: 0, x1: 99, y0: 0, y1: 49 }, saturationLevel: 60000, pixelScale: 0.6, gain: 1.2,
    filters: { Lum: { wavelengthNm: 540, system: 'LRGB' } }, generated: true,
  });

  it('round-trips through a file without the "generated" mark', () => {
    const back = parseProfileFile(serializeProfile(profile));
    const { generated: _g, ...expected } = profile;
    expect(back).toEqual(expected);
    expect(back.keywords.kind).toEqual(['PICTTYPE']);
  });

  it('drops unknown fields, such as the old import binning', () => {
    const p = checkProfile({ name: 'Old', importBinning: 1, trim: null, keywords: {}, kindValues: {}, filters: {} });
    expect('importBinning' in p).toBe(false);
    expect(p.id).toBe('profile-old');
  });

  it('rejects wrong files and values', () => {
    const code = (text: string) => {
      try {
        parseProfileFile(text);
      } catch (e) {
        return e instanceof ProfileError ? `${e.code} ${e.detail}`.trim() : 'other';
      }
      return 'ok';
    };
    const wrap = (p: unknown, version = 1) => JSON.stringify({ format: 'astrofoto-profile', version, profile: p });
    expect(code('{')).toMatch(/^badJson/);
    expect(code(JSON.stringify({ name: 'x' }))).toBe('notProfile');
    expect(code(wrap({ name: 'x' }, 99))).toBe('newerFormat');
    expect(code(wrap({ name: '' }))).toBe('badValue name');
    expect(code(wrap({ name: 'x', trim: { x0: 5, x1: 1, y0: 0, y1: 1 } }))).toBe('badValue trim');
    expect(code(wrap({ name: 'x', saturationLevel: -1 }))).toBe('badValue saturationLevel');
    expect(code(wrap({ name: 'x', filters: { B: { wavelengthNm: 'blue' } } }))).toBe('badValue filters.B');
    expect(code(wrap({ name: 'x', keywords: { kind: 'IMAGETYP' } }))).toBe('badValue keywords.kind');
    expect(code(wrap({ name: 'x', camera: 5 }))).toBe('badValue camera');
    expect(code(wrap({ name: 'x' }))).toBe('ok');
  });
});
