// Profile matching and header access through keyword aliases. See docs/DESIGN.md §2.4.

import type { HeaderValue } from '../fits';
import type { FrameMeta, InstrumentProfile, Kind } from '../types';
import { KINDS } from '../types';
import { canonicalFilter, type Concept, DEFAULT_FILTERS, DEFAULT_KEYWORDS, DEFAULT_KIND_VALUES, FILE_NAME_KIND, type FilterInfo } from './defaults';
import azt12 from './profiles/to-azt12-andor.json';

export const BUILT_IN_PROFILES: InstrumentProfile[] = [azt12 as InstrumentProfile];

type Header = Record<string, HeaderValue>;

function str(v: HeaderValue | undefined): string {
  return v === undefined ? '' : String(v).trim();
}

/** Picks a built-in profile from TELESCOP/INSTRUME, or creates a new one from the defaults. */
export function matchProfile(header: Header, profiles = BUILT_IN_PROFILES): InstrumentProfile {
  const telescop = str(header.TELESCOP).toLowerCase();
  const instrume = str(header.INSTRUME).toLowerCase();
  for (const p of profiles) {
    const m = p.match;
    if (!m || (!m.telescop && !m.instrume)) continue;
    if (m.telescop && !telescop.includes(m.telescop.toLowerCase())) continue;
    if (m.instrume && !instrume.includes(m.instrume.toLowerCase())) continue;
    return structuredClone(p);
  }
  const name = [str(header.TELESCOP), str(header.INSTRUME)].filter(Boolean).join(' + ') || '?';
  return {
    id: 'generated-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name,
    match: { telescop: str(header.TELESCOP) || undefined, instrume: str(header.INSTRUME) || undefined },
    keywords: {},
    kindValues: {},
    trim: null,
    filters: {},
    generated: true,
  };
}

export function keywordsFor(profile: InstrumentProfile, concept: Concept): string[] {
  return profile.keywords[concept] ?? DEFAULT_KEYWORDS[concept];
}

/** The header value for a concept and the keyword it was found under. */
export function headerValue(
  header: Header,
  profile: InstrumentProfile,
  concept: Concept,
): { key: string; value: HeaderValue } | undefined {
  for (const key of keywordsFor(profile, concept)) {
    if (header[key] !== undefined && str(header[key]) !== '') return { key, value: header[key] };
  }
  return undefined;
}

export function kindFromValue(value: string, profile: InstrumentProfile): Kind | undefined {
  const v = value.trim().toLowerCase();
  for (const kind of KINDS) {
    const values = profile.kindValues[kind] ?? DEFAULT_KIND_VALUES[kind];
    if (values.some((x) => x.toLowerCase() === v)) return kind;
  }
  return undefined;
}

export function kindFromFileName(fileName: string): Kind | undefined {
  const base = fileName.split('/').pop()!.toLowerCase();
  const words = base.split(/[^a-z]+/).filter(Boolean);
  for (const kind of KINDS) {
    if (FILE_NAME_KIND[kind].some((w) => words.includes(w))) return kind;
  }
  return undefined;
}

function mjdToIso(mjd: number): string {
  return new Date((mjd - 40587) * 86400000).toISOString();
}

/** Wavelength and system of a filter: the profile first, then the built-in list, also under other spellings. */
export function filterInfo(profile: InstrumentProfile | null | undefined, filter: string): FilterInfo | undefined {
  const own = profile?.filters[filter];
  if (own) return own;
  if (DEFAULT_FILTERS[filter]) return DEFAULT_FILTERS[filter];
  const canonical = canonicalFilter(filter);
  return canonical ? DEFAULT_FILTERS[canonical] : undefined;
}

/** Telescope and camera names: the profile's own, else TELESCOP and INSTRUME from the header. */
export function instrumentNames(header: Header, profile: InstrumentProfile | null | undefined): { telescope: string; camera: string } {
  return {
    telescope: profile?.telescope || str(header.TELESCOP),
    camera: profile?.camera || str(header.INSTRUME),
  };
}

/** A value and where it came from: the profile, a header keyword, or the app's own estimate. */
export interface Sourced {
  value: number;
  source: 'profile' | 'header' | 'optics' | 'wcs' | 'estimate';
  /** The keyword(s) the value was read from. */
  key?: string;
}

function headerNumber(header: Header, profile: InstrumentProfile, concept: Concept): { key: string; value: number } | undefined {
  const hv = headerValue(header, profile, concept);
  const n = Number(hv?.value);
  return hv && Number.isFinite(n) ? { key: hv.key, value: n } : undefined;
}

/** Binning from the header; CCDSUM-style values ('2 2') hold x then y. */
function binning(header: Header, profile: InstrumentProfile, concept: 'xbin' | 'ybin'): number | undefined {
  const hv = headerValue(header, profile, concept);
  if (!hv) return undefined;
  const parts = String(hv.value).trim().split(/[\sx×,]+/i).map(Number);
  const n = concept === 'ybin' && parts.length > 1 ? parts[1] : parts[0];
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Arcseconds per pixel: the profile, a scale keyword, the optics (focal length and pixel size),
 * or the WCS (CD matrix or CDELT), in that order.
 */
export function pixelScaleInfo(header: Header, profile: InstrumentProfile): Sourced | undefined {
  if (profile.pixelScale) return { value: profile.pixelScale, source: 'profile' };
  const direct = headerNumber(header, profile, 'pixelScale');
  if (direct && direct.value > 0) return { value: direct.value, source: 'header', key: direct.key };
  const focal = headerNumber(header, profile, 'focalLength');
  const size = headerNumber(header, profile, 'pixelSize');
  if (focal && size && focal.value > 0 && size.value > 0) {
    const bin = binning(header, profile, 'xbin') ?? 1;
    const binned = profile.pixelSizeIncludesBinning === false ? size.value * bin : size.value;
    return { value: (206.265 * binned) / focal.value, source: 'optics', key: `${focal.key}, ${size.key}` };
  }
  const cd11 = Number(header.CD1_1);
  const cd21 = Number(header.CD2_1);
  if (Number.isFinite(cd11) && header.CD1_1 !== undefined) {
    const deg = Math.hypot(cd11, Number.isFinite(cd21) ? cd21 : 0);
    if (deg > 0) return { value: deg * 3600, source: 'wcs', key: 'CD1_1' };
  }
  const cdelt = Math.abs(Number(header.CDELT1));
  if (Number.isFinite(cdelt) && cdelt > 0) return { value: cdelt * 3600, source: 'wcs', key: 'CDELT1' };
  return undefined;
}

export function pixelScale(header: Header, profile: InstrumentProfile): number | undefined {
  return pixelScaleInfo(header, profile)?.value;
}

/** Largest stored value of each integer BITPIX. */
const BITPIX_MAX: Record<number, number> = { 8: 255, 16: 32767, 32: 2147483647 };

/** Saturation level in ADU: the profile, SATURATE/DATAMAX, else 95 % of the data type's maximum. */
export function saturationInfo(header: Header, profile: InstrumentProfile): Sourced | undefined {
  if (profile.saturationLevel) return { value: profile.saturationLevel, source: 'profile' };
  const hv = headerNumber(header, profile, 'saturation');
  if (hv && hv.value > 0) return { value: hv.value, source: 'header', key: hv.key };
  const max = BITPIX_MAX[Number(header.BITPIX)];
  if (max === undefined) return undefined;
  const top = max * (Number(header.BSCALE) || 1) + (Number(header.BZERO) || 0);
  return { value: Math.round(0.95 * top), source: 'estimate' };
}

/** Electrons per ADU from the profile or the header, if known. */
export function gainInfo(header: Header, profile: InstrumentProfile): Sourced | undefined {
  if (profile.gain) return { value: profile.gain, source: 'profile' };
  const hv = headerNumber(header, profile, 'gain');
  return hv && hv.value > 0 ? { value: hv.value, source: 'header', key: hv.key } : undefined;
}

/** Builds frame metadata from a header. */
export function describeFrame(
  id: string,
  fileName: string,
  header: Header,
  size: { width: number; height: number },
  profile: InstrumentProfile,
): FrameMeta {
  let kind: Kind | undefined;
  let kindSource: FrameMeta['kindSource'] = 'header';
  const kindValue = headerValue(header, profile, 'kind');
  if (kindValue) kind = kindFromValue(str(kindValue.value), profile);
  if (!kind) {
    kind = kindFromFileName(fileName);
    kindSource = 'fileName';
  }
  if (!kind) {
    kind = 'light';
    kindSource = 'guess';
  }

  const exposure = Number(headerValue(header, profile, 'exposure')?.value);
  const dateValue = headerValue(header, profile, 'date');
  const dateObs = dateValue?.key === 'MJD-OBS' && typeof dateValue.value === 'number'
    ? mjdToIso(dateValue.value)
    : str(dateValue?.value);
  const temperature = Number(headerValue(header, profile, 'temperature')?.value);
  const xbin = binning(header, profile, 'xbin');
  const ybin = binning(header, profile, 'ybin');
  const usesFilter = kind === 'flat' || kind === 'light';

  return {
    id,
    fileName,
    kind,
    kindSource,
    filter: usesFilter ? str(headerValue(header, profile, 'filter')?.value) : '',
    exposure: Number.isFinite(exposure) ? exposure : 0,
    dateObs,
    temperature: Number.isFinite(temperature) ? temperature : undefined,
    xbin,
    ybin,
    width: size.width,
    height: size.height,
    header,
  };
}

/**
 * Frame metadata read again with another profile. The student's own choices (type, filter,
 * excluded) are kept.
 */
export function redescribe(meta: FrameMeta, profile: InstrumentProfile): FrameMeta {
  const fresh = describeFrame(meta.id, meta.fileName, meta.header, meta, profile);
  const own: Partial<FrameMeta> = { excluded: meta.excluded };
  if (meta.kindSource === 'user') Object.assign(own, { kind: meta.kind, kindSource: 'user' });
  if (meta.filterEdited) Object.assign(own, { filter: meta.filter, filterEdited: true });
  else if (own.kind && own.kind !== fresh.kind) own.filter = own.kind === 'flat' || own.kind === 'light' ? meta.filter : '';
  return { ...fresh, ...own };
}
