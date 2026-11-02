// Saving and opening .astroproj project files. See docs/DESIGN.md §6.5.
//
// An .astroproj file is a zip: project.json (settings, decisions, answers, log) and
// frames/<file name> (the raw files as loaded, unchanged). Masters, calibrated frames and stacks
// are not stored; they are recomputed on open.

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { readFits } from './fits';
import { t } from './i18n';
import { describeFrame } from './instrument/profile';
import { type Answer, type Frame, type LogEntry, type ProjectInfo, type StepState, defaultSettings, state } from './state';
import type { Composition, FrameMeta, InstrumentProfile, MentorComment, ProcessingSettings, ReportSettings, StepId, Version } from './types';

declare const __APP_VERSION__: string;

export const PROJECT_EXT = '.astroproj';
const FORMAT_VERSION = 1;

type SavedFrame = Omit<FrameMeta, 'header'>;

interface ProjectJson {
  version: number;
  appVersion: string;
  info: ProjectInfo;
  profile: InstrumentProfile | null;
  frames: SavedFrame[];
  settings: ProcessingSettings;
  compositions: Composition[];
  versions: Version[];
  steps: Partial<Record<StepId, StepState>>;
  answers: Record<string, Answer>;
  hintsUsed: Record<string, number>;
  log: LogEntry[];
  mentorComments: Record<string, MentorComment[]>;
  report: ReportSettings;
  // Reserved for a later milestone, kept so older files stay readable
  taskSettings: Record<string, Record<string, number | string>>;
}

export class ProjectError extends Error {
  constructor(readonly code: 'notProject' | 'badJson' | 'newerFormat' | 'missingFrame', detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

/** -1, 0 or 1 for dotted version strings such as "0.3.0". */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

function framePath(f: Frame): string {
  return `frames/${f.meta.fileName}`;
}

export function serialize(): Uint8Array {
  const now = new Date().toISOString();
  const json: ProjectJson = {
    version: FORMAT_VERSION,
    appVersion: __APP_VERSION__,
    info: { ...state.info, savedWith: __APP_VERSION__, lastSaved: now },
    profile: state.profile,
    frames: state.frames.map(({ meta }) => {
      const { header: _header, ...rest } = meta;
      return rest;
    }),
    settings: state.settings,
    compositions: state.compositions,
    versions: state.versions,
    steps: state.steps,
    answers: state.answers,
    hintsUsed: state.hintsUsed,
    log: state.log,
    mentorComments: state.comments,
    report: state.report,
    taskSettings: {},
  };
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 | 1 | 6 }]> = {
    'project.json': strToU8(JSON.stringify(json, null, 2)),
  };
  // Light compression: raw 16-bit data shrinks well at level 1, and saving stays quick
  for (const f of state.frames) files[framePath(f)] = [f.raw, { level: 1 }];
  return zipSync(files, { level: 6 });
}

export interface OpenResult {
  /** The project was saved by a newer app version than this one. */
  newerApp?: string;
}

/** Older formats are upgraded here as the format changes. */
function migrate(json: ProjectJson): ProjectJson {
  return {
    ...json,
    settings: {
      ...defaultSettings(),
      ...json.settings,
      // Projects from 0.3 have no stacking method yet
      combine: { ...defaultSettings().combine, ...json.settings.combine },
    },
    // Projects from 0.4 and earlier have no colour images
    compositions: json.compositions ?? [],
    // and 0.5 and earlier no versions or comments
    versions: (json.versions ?? []).map((v) => ({
      ...v,
      settings: { ...defaultSettings(), ...v.settings, combine: { ...defaultSettings().combine, ...v.settings.combine } },
    })),
    mentorComments: json.mentorComments ?? {},
    // and 0.6 and earlier no report
    report: { sections: json.report?.sections ?? {}, items: json.report?.items ?? [] },
    hintsUsed: json.hintsUsed ?? {},
    log: json.log ?? [],
    steps: json.steps ?? {},
    answers: json.answers ?? {},
  };
}

/** Replaces the current state with the project in `bytes`. */
export function open(bytes: Uint8Array): OpenResult {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new ProjectError('notProject');
  }
  if (!files['project.json']) throw new ProjectError('notProject');
  let json: ProjectJson;
  try {
    json = JSON.parse(strFromU8(files['project.json'])) as ProjectJson;
  } catch (e) {
    throw new ProjectError('badJson', String(e));
  }
  if (typeof json.version !== 'number' || json.version > FORMAT_VERSION) throw new ProjectError('newerFormat', String(json.appVersion));
  json = migrate(json);

  const frames: Frame[] = json.frames.map((saved) => {
    const raw = files[`frames/${saved.fileName}`];
    if (!raw) throw new ProjectError('missingFrame', saved.fileName);
    const image = readFits(raw);
    const fresh = describeFrame(saved.id, saved.fileName, image.header, image, json.profile!);
    // The student's corrections (type, filter, excluded) win over the header
    return { meta: { ...fresh, ...saved, header: image.header }, image, raw };
  });

  state.clear();
  state.reserveIds(frames.map((f) => f.meta.id));
  state.info = { ...json.info };
  if (json.profile) state.setProfile(json.profile);
  state.settings = json.settings;
  state.compositions = json.compositions;
  state.versions = json.versions;
  state.comments = json.mentorComments;
  state.report = json.report;
  state.steps = json.steps;
  state.answers = json.answers;
  state.hintsUsed = json.hintsUsed;
  state.log = json.log;
  // Adding the frames rebuilds the masters and calibrated frames (see masters.ts)
  state.addFrames(frames);
  for (const k of ['info', 'settings', 'compositions', 'versions', 'comments', 'report', 'steps', 'answers', 'log'] as const) state.emit(k);
  state.markSaved();

  return compareVersions(json.appVersion, __APP_VERSION__) > 0 ? { newerApp: json.appVersion } : {};
}

/** The project title, or a generic one ("Minu projekt") when the student has not given one. */
export function projectTitle(): string {
  return state.info.title || t('project.defaultTitle');
}

export function suggestedName(): string {
  const base = projectTitle().trim().replace(/[\\/:*?"<>|]+/g, '-');
  return base + PROJECT_EXT;
}
