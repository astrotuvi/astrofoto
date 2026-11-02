// Profile matching and header access through keyword aliases. See docs/DESIGN.md §2.4.

import type { HeaderValue } from '../fits';
import type { FrameMeta, InstrumentProfile, Kind } from '../types';
import { KINDS } from '../types';
import { type Concept, DEFAULT_FILTERS, DEFAULT_KEYWORDS, DEFAULT_KIND_VALUES, FILE_NAME_KIND } from './defaults';
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
    importBinning: 1,
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

export function filterInfo(profile: InstrumentProfile, filter: string) {
  return profile.filters[filter] ?? DEFAULT_FILTERS[filter];
}

/** Arcseconds per pixel from the profile or from FOCALLEN and XPIXSZ, if known. */
export function pixelScale(header: Header, profile: InstrumentProfile): number | undefined {
  if (profile.pixelScale) return profile.pixelScale;
  const focal = header.FOCALLEN;
  const size = header.XPIXSZ;
  if (typeof focal !== 'number' || typeof size !== 'number' || focal <= 0) return undefined;
  const bin = Number(headerValue(header, profile, 'xbin')?.value) || 1;
  const binned = profile.pixelSizeIncludesBinning === false ? size * bin : size;
  return (206.265 * binned) / focal;
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
  const xbin = Number(headerValue(header, profile, 'xbin')?.value);
  const ybin = Number(headerValue(header, profile, 'ybin')?.value);
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
    xbin: Number.isFinite(xbin) ? xbin : undefined,
    ybin: Number.isFinite(ybin) ? ybin : undefined,
    width: size.width,
    height: size.height,
    header,
  };
}
