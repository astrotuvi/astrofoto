// Turns dropped or picked files (FITS, .fits.gz, zip) into frames.

import { unzipSync } from 'fflate';
import { FitsError, type FitsErrorCode, type FitsWarning, readFits } from './fits';
import { describeFrame, matchProfile } from './instrument/profile';
import { type Frame, state } from './state';
import type { InstrumentProfile } from './types';

const FITS_EXT = /\.(fits?|fts)(\.gz)?$/i;
const ZIP_EXT = /\.zip$/i;

/** Files that were not added. */
export interface ImportProblem {
  fileName: string;
  reason: 'notFits' | 'duplicate' | 'zip' | FitsErrorCode | 'unknown';
  detail?: string;
}

/** Files that were added, but with something to check. */
export interface ImportWarning {
  fileName: string;
  reason: FitsWarning | 'otherInstrument';
  detail?: string;
}

export interface ImportResult {
  added: number;
  problems: ImportProblem[];
  warnings: ImportWarning[];
}

interface NamedBytes { name: string; bytes: Uint8Array }

function isHidden(path: string): boolean {
  return path.split('/').some((part) => part.startsWith('.') || part === '__MACOSX');
}

/** A picked or dropped file and its path relative to the chosen folder. */
export interface PickedFile { file: File; name: string }

export function picked(files: Iterable<File>): PickedFile[] {
  return Array.from(files, (file) => ({ file, name: file.webkitRelativePath || file.name }));
}

async function expand(files: PickedFile[]): Promise<{ entries: NamedBytes[]; problems: ImportProblem[] }> {
  const entries: NamedBytes[] = [];
  const problems: ImportProblem[] = [];
  for (const { file, name } of files) {
    if (isHidden(name)) continue;
    if (ZIP_EXT.test(name)) {
      try {
        const unzipped = unzipSync(new Uint8Array(await file.arrayBuffer()));
        for (const [path, bytes] of Object.entries(unzipped)) {
          if (path.endsWith('/') || isHidden(path)) continue;
          if (FITS_EXT.test(path)) entries.push({ name: path, bytes });
          else problems.push({ fileName: `${name}: ${path}`, reason: 'notFits' });
        }
      } catch (e) {
        problems.push({ fileName: name, reason: 'zip', detail: String(e) });
      }
    } else if (FITS_EXT.test(name)) {
      entries.push({ name, bytes: new Uint8Array(await file.arrayBuffer()) });
    } else {
      problems.push({ fileName: name, reason: 'notFits' });
    }
  }
  return { entries, problems };
}

function instrumentName(header: Record<string, unknown>): string {
  return [header.TELESCOP, header.INSTRUME].map((v) => String(v ?? '').trim()).join(' / ');
}

export async function importFiles(files: PickedFile[]): Promise<ImportResult> {
  const { entries, problems } = await expand(files);
  const warnings: ImportWarning[] = [];
  const known = new Set(state.frames.map((f) => f.meta.fileName));
  let profile: InstrumentProfile | null = state.profile;
  let instrument = state.frames.length ? instrumentName(state.frames[0].meta.header) : null;
  const frames: Frame[] = [];

  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const { name, bytes } of entries) {
    if (known.has(name)) {
      problems.push({ fileName: name, reason: 'duplicate' });
      continue;
    }
    try {
      const image = readFits(bytes);
      if (!profile) {
        profile = matchProfile(image.header);
        state.setProfile(profile);
      }
      if (instrument === null) instrument = instrumentName(image.header);
      else if (instrumentName(image.header) !== instrument) {
        warnings.push({ fileName: name, reason: 'otherInstrument', detail: instrumentName(image.header) });
      }
      for (const w of image.warnings) warnings.push({ fileName: name, reason: w });
      frames.push({ meta: describeFrame(state.newId(), name, image.header, image, profile), image, raw: bytes });
      known.add(name);
    } catch (e) {
      problems.push(e instanceof FitsError
        ? { fileName: name, reason: e.code, detail: e.message }
        : { fileName: name, reason: 'unknown', detail: String(e) });
    }
  }
  state.addFrames(frames);
  if (frames.length) state.addLog('files', 'filesAdded', { n: frames.length });
  return { added: frames.length, problems, warnings };
}
