// Built-in defaults used when a profile does not say otherwise. See docs/DESIGN.md §2.4.

import type { HeaderConcept, Kind } from '../types';

export type Concept = HeaderConcept;

export const CONCEPTS: Concept[] = ['kind', 'filter', 'exposure', 'temperature', 'xbin', 'ybin', 'date',
  'focalLength', 'pixelSize', 'pixelScale', 'gain', 'saturation'];

/**
 * Header keywords tried for each concept, in order. CCDSUM ('2 2', observatory software) holds
 * both binnings. GAIN is not tried: many programs write the camera's gain setting in it, not e⁻/ADU.
 */
export const DEFAULT_KEYWORDS: Record<Concept, string[]> = {
  kind: ['IMAGETYP', 'FRAMETYP', 'OBSTYPE', 'FRAME'],
  filter: ['FILTER', 'FILTER1', 'FILTNAM', 'FILTERS'],
  exposure: ['EXPTIME', 'EXPOSURE', 'ITIME'],
  temperature: ['CCD-TEMP', 'CCDTEMP', 'CCD_TEMP', 'TEMPERAT'],
  xbin: ['XBINNING', 'CCDXBIN', 'BINNING', 'CCDSUM'],
  ybin: ['YBINNING', 'CCDYBIN', 'BINNING', 'CCDSUM'],
  date: ['DATE-OBS', 'MJD-OBS', 'DATE'],
  focalLength: ['FOCALLEN', 'FOCAL'],
  pixelSize: ['XPIXSZ', 'PIXSIZE1', 'PIXSIZE'],
  pixelScale: ['PIXSCALE', 'SECPIX'],
  gain: ['EGAIN'],
  saturation: ['SATURATE', 'DATAMAX'],
};

/** Frame type values recognised in the header (compared case-insensitively). */
export const DEFAULT_KIND_VALUES: Record<Kind, string[]> = {
  bias: ['bias', 'bias frame', 'zero', 'offset'],
  dark: ['dark', 'dark frame'],
  flat: ['flat', 'flat field', 'flat frame', 'flatfield', 'skyflat', 'sky flat', 'domeflat', 'dome flat', 'twilight flat'],
  light: ['light', 'light frame', 'object', 'science', 'expose'],
};

/** Words in a file name that suggest the frame type, if the header has none. */
export const FILE_NAME_KIND: Record<Kind, string[]> = {
  bias: ['bias', 'zero'],
  dark: ['dark'],
  flat: ['flat'],
  light: ['light', 'object', 'sci'],
};

export interface FilterInfo { wavelengthNm: number; system?: string }

/** Approximate central wavelengths. Names are case-sensitive: R (Johnson) ≠ r (Sloan). */
export const DEFAULT_FILTERS: Record<string, FilterInfo> = {
  U: { wavelengthNm: 365, system: 'Johnson-Cousins' },
  B: { wavelengthNm: 445, system: 'Johnson-Cousins' },
  V: { wavelengthNm: 551, system: 'Johnson-Cousins' },
  R: { wavelengthNm: 658, system: 'Johnson-Cousins' },
  I: { wavelengthNm: 806, system: 'Johnson-Cousins' },
  u: { wavelengthNm: 354, system: 'Sloan' },
  g: { wavelengthNm: 477, system: 'Sloan' },
  r: { wavelengthNm: 623, system: 'Sloan' },
  i: { wavelengthNm: 763, system: 'Sloan' },
  z: { wavelengthNm: 913, system: 'Sloan' },
  L: { wavelengthNm: 550, system: 'LRGB' },
  Red: { wavelengthNm: 630, system: 'LRGB' },
  Green: { wavelengthNm: 530, system: 'LRGB' },
  Blue: { wavelengthNm: 460, system: 'LRGB' },
  Ha: { wavelengthNm: 656, system: 'narrowband' },
  'H-alpha': { wavelengthNm: 656, system: 'narrowband' },
  OIII: { wavelengthNm: 501, system: 'narrowband' },
  SII: { wavelengthNm: 672, system: 'narrowband' },
  NII: { wavelengthNm: 658, system: 'narrowband' },
  Hb: { wavelengthNm: 486, system: 'narrowband' },
};

/** Other spellings of the filters above, after removing spaces, dashes and the word "filter" (lower case). */
const FILTER_ALIASES: Record<string, string> = {
  l: 'L', lum: 'L', luminance: 'L', clear: 'L',
  red: 'Red', green: 'Green', blue: 'Blue',
  ha: 'Ha', halpha: 'Ha', 'hα': 'Ha', hb: 'Hb', hbeta: 'Hb', 'hβ': 'Hb',
  oiii: 'OIII', o3: 'OIII', sii: 'SII', s2: 'SII', nii: 'NII', n2: 'NII',
};

const SLOAN = /sdss|sloan|prime|['′]/i;
const JOHNSON = /johnson|bessell?|cousins/i;

/**
 * The built-in filter a name probably means, e.g. "Luminance" → L, "SDSS r'" → r, "rp" → r,
 * "Bessell V" → V. Single letters keep their case unless the name says Sloan or Johnson.
 */
export function canonicalFilter(name: string): string | undefined {
  const bare = name.replace(/filter|sdss|sloan|johnson|bessell?|cousins|prime/gi, '').replace(/[\s_\-'′.()]/g, '');
  const alias = FILTER_ALIASES[bare.toLowerCase()];
  if (alias && bare.length > 1) return alias;
  const prime = /^([ugriz])p$/i.exec(bare);
  if (prime) return prime[1].toLowerCase();
  if (bare.length !== 1) return undefined;
  if (SLOAN.test(name) && 'ugriz'.includes(bare.toLowerCase())) return bare.toLowerCase();
  if (JOHNSON.test(name) && 'UBVRI'.includes(bare.toUpperCase())) return bare.toUpperCase();
  if (DEFAULT_FILTERS[bare]) return bare;
  if (DEFAULT_FILTERS[bare.toUpperCase()] && !DEFAULT_FILTERS[bare.toLowerCase()]) return bare.toUpperCase();
  return alias;
}
