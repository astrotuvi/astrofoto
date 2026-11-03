// Instrument profile files (.astroprofile.json), so a mentor can give students a checked profile
// for a new telescope. See docs/DESIGN.md §2.4.

import { KINDS, type InstrumentProfile, type Region } from '../types';
import { CONCEPTS } from './defaults';

const FORMAT = 'astrofoto-profile';
const FORMAT_VERSION = 1;

export type ProfileErrorCode = 'badJson' | 'notProfile' | 'newerFormat' | 'badValue';

export class ProfileError extends Error {
  constructor(readonly code: ProfileErrorCode, readonly detail = '') {
    super(detail ? `${code}: ${detail}` : code);
  }
}

export function profileFileName(p: InstrumentProfile): string {
  const base = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'profile';
  return `${base}.astroprofile.json`;
}

export function serializeProfile(p: InstrumentProfile): string {
  const { generated: _generated, ...rest } = p;
  return JSON.stringify({ format: FORMAT, version: FORMAT_VERSION, profile: rest }, null, 2) + '\n';
}

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function bad(field: string): never {
  throw new ProfileError('badValue', field);
}

function positive(v: unknown, field: string): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) bad(field);
  return v;
}

function stringList(v: unknown, field: string): string[] {
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) bad(field);
  return (v as string[]).map((x) => x.trim()).filter(Boolean);
}

function region(v: unknown): Region | null {
  if (v === null || v === undefined) return null;
  if (!isObject(v)) bad('trim');
  const r = { x0: v.x0, x1: v.x1, y0: v.y0, y1: v.y1 };
  if (Object.values(r).some((x) => !Number.isInteger(x) || (x as number) < 0)) bad('trim');
  const ok = r as Region;
  if (ok.x0 > ok.x1 || ok.y0 > ok.y1) bad('trim');
  return ok;
}

/** Checks a profile read from a file or a project and keeps only the fields the app knows. */
export function checkProfile(v: unknown): InstrumentProfile {
  if (!isObject(v)) throw new ProfileError('notProfile');
  if (typeof v.name !== 'string' || !v.name.trim()) bad('name');
  const name = v.name.trim();

  const keywords: InstrumentProfile['keywords'] = {};
  if (v.keywords !== undefined) {
    if (!isObject(v.keywords)) bad('keywords');
    for (const c of CONCEPTS) {
      if (v.keywords[c] !== undefined) keywords[c] = stringList(v.keywords[c], `keywords.${c}`).map((k) => k.toUpperCase());
    }
  }
  const kindValues: InstrumentProfile['kindValues'] = {};
  if (v.kindValues !== undefined) {
    if (!isObject(v.kindValues)) bad('kindValues');
    for (const k of KINDS) {
      if (v.kindValues[k] !== undefined) kindValues[k] = stringList(v.kindValues[k], `kindValues.${k}`);
    }
  }
  const filters: InstrumentProfile['filters'] = {};
  if (v.filters !== undefined) {
    if (!isObject(v.filters)) bad('filters');
    for (const [f, info] of Object.entries(v.filters)) {
      if (!isObject(info)) bad(`filters.${f}`);
      const nm = positive(info.wavelengthNm, `filters.${f}`);
      if (nm === undefined) bad(`filters.${f}`);
      if (info.system !== undefined && typeof info.system !== 'string') bad(`filters.${f}`);
      filters[f] = info.system ? { wavelengthNm: nm, system: info.system as string } : { wavelengthNm: nm };
    }
  }
  let match: InstrumentProfile['match'];
  if (v.match !== undefined) {
    if (!isObject(v.match)) bad('match');
    const str = (x: unknown, f: string) => {
      if (x !== undefined && typeof x !== 'string') bad(f);
      return (x as string | undefined)?.trim() || undefined;
    };
    match = { telescop: str(v.match.telescop, 'match.telescop'), instrume: str(v.match.instrume, 'match.instrume') };
  }
  const label = (x: unknown, f: string) => {
    if (x !== undefined && typeof x !== 'string') bad(f);
    return (x as string | undefined)?.trim() || undefined;
  };
  if (v.pixelSizeIncludesBinning !== undefined && typeof v.pixelSizeIncludesBinning !== 'boolean') bad('pixelSizeIncludesBinning');

  const p: InstrumentProfile = {
    id: typeof v.id === 'string' && v.id.trim() ? v.id.trim() : 'profile-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name,
    telescope: label(v.telescope, 'telescope'),
    camera: label(v.camera, 'camera'),
    match,
    keywords,
    kindValues,
    trim: region(v.trim),
    saturationLevel: positive(v.saturationLevel, 'saturationLevel'),
    pixelScale: positive(v.pixelScale, 'pixelScale'),
    pixelSizeIncludesBinning: v.pixelSizeIncludesBinning as boolean | undefined,
    gain: positive(v.gain, 'gain'),
    filters,
  };
  if (v.generated === true) p.generated = true;
  // Leave out empty optional fields, so the saved file stays short
  for (const k of Object.keys(p) as (keyof InstrumentProfile)[]) if (p[k] === undefined) delete p[k];
  return p;
}

/** Reads an .astroprofile.json file. */
export function parseProfileFile(text: string): InstrumentProfile {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new ProfileError('badJson', String(e));
  }
  if (!isObject(json) || json.format !== FORMAT) throw new ProfileError('notProfile');
  if (typeof json.version !== 'number' || json.version > FORMAT_VERSION) throw new ProfileError('newerFormat');
  const p = checkProfile(json.profile);
  delete p.generated;
  return p;
}
