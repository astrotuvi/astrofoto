import { describe, expect, it } from 'vitest';
import { describeFrame, kindFromFileName, matchProfile, pixelScale } from '../src/instrument/profile';

const size = { width: 524, height: 512 };

describe('instrument profiles', () => {
  it('picks the built-in AZT-12 profile', () => {
    const p = matchProfile({ TELESCOP: 'AZT-12', INSTRUME: 'Ascom Driver for Andor CCD Cameras' });
    expect(p.id).toBe('to-azt12-andor');
    expect(p.trim).toEqual({ x0: 4, x1: 515, y0: 0, y1: 511 });
    expect(p.generated).toBeUndefined();
  });

  it('creates a profile for an unknown instrument', () => {
    const p = matchProfile({ TELESCOP: 'Celestron C8', INSTRUME: 'ZWO ASI1600MM' });
    expect(p.generated).toBe(true);
    expect(p.name).toBe('Celestron C8 + ZWO ASI1600MM');
    expect(p.trim).toBeNull();
  });

  it('reads frame metadata through keyword aliases', () => {
    const p = matchProfile({});
    const m = describeFrame('a', 'x.fits', { FRAMETYP: 'Flat Field', FILTER1: 'Ha', EXPOSURE: 2.5, 'MJD-OBS': 61334.5 }, size, p);
    expect(m.kind).toBe('flat');
    expect(m.kindSource).toBe('header');
    expect(m.filter).toBe('Ha');
    expect(m.exposure).toBe(2.5);
    expect(m.dateObs).toBe('2026-10-21T12:00:00.000Z');
  });

  it('keeps filter case and ignores filters for bias/dark', () => {
    const p = matchProfile({});
    expect(describeFrame('a', 'a.fits', { IMAGETYP: 'LIGHT', FILTER: 'r' }, size, p).filter).toBe('r');
    expect(describeFrame('b', 'b.fits', { IMAGETYP: 'LIGHT', FILTER: 'R' }, size, p).filter).toBe('R');
    expect(describeFrame('c', 'c.fits', { IMAGETYP: 'BIAS', FILTER: 'NII' }, size, p).filter).toBe('');
  });

  it('falls back to the file name, then guesses', () => {
    const p = matchProfile({});
    expect(kindFromFileName('night1/M57_dark_30s_001.fits')).toBe('dark');
    expect(kindFromFileName('BIAS-2026-10-21-0000.fits')).toBe('bias');
    expect(kindFromFileName('darkness.fits')).toBeUndefined();
    const m = describeFrame('a', 'img001.fits', {}, size, p);
    expect(m.kind).toBe('light');
    expect(m.kindSource).toBe('guess');
  });

  it('computes the pixel scale from FOCALLEN and XPIXSZ', () => {
    const p = matchProfile({ TELESCOP: 'AZT-12', INSTRUME: 'Andor' });
    expect(pixelScale({ FOCALLEN: 12000, XPIXSZ: 26, XBINNING: 2 }, p)).toBeCloseTo(0.4469, 3);
    const unbinned = { ...p, pixelSizeIncludesBinning: false };
    expect(pixelScale({ FOCALLEN: 12000, XPIXSZ: 13, XBINNING: 2 }, unbinned)).toBeCloseTo(0.4469, 3);
  });
});
