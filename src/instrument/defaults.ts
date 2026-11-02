// Built-in defaults used when a profile does not say otherwise. See docs/DESIGN.md §2.4.

import type { Kind } from '../types';

export type Concept = 'kind' | 'filter' | 'exposure' | 'temperature' | 'xbin' | 'ybin' | 'date';

/** Header keywords tried for each concept, in order. */
export const DEFAULT_KEYWORDS: Record<Concept, string[]> = {
  kind: ['IMAGETYP', 'FRAMETYP', 'OBSTYPE'],
  filter: ['FILTER', 'FILTER1', 'FILTNAM', 'FILTERS'],
  exposure: ['EXPTIME', 'EXPOSURE', 'ITIME'],
  temperature: ['CCD-TEMP', 'CCDTEMP', 'TEMPERAT'],
  xbin: ['XBINNING', 'CCDXBIN', 'BINNING'],
  ybin: ['YBINNING', 'CCDYBIN', 'BINNING'],
  date: ['DATE-OBS', 'DATE', 'MJD-OBS'],
};

/** Frame type values recognised in the header (compared case-insensitively). */
export const DEFAULT_KIND_VALUES: Record<Kind, string[]> = {
  bias: ['bias', 'bias frame', 'zero'],
  dark: ['dark', 'dark frame'],
  flat: ['flat', 'flat field', 'flat frame', 'skyflat', 'domeflat'],
  light: ['light', 'light frame', 'object', 'science'],
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
