// In-memory application state and change events.

import type { FitsImage } from './fits';
import { redescribe } from './instrument/profile';
import type { AutoResult } from './align';
import type {
  CombineMethod, Composition, FrameMeta, InstrumentProfile, Kind, MentorComment, ProcessingSettings, Region, ReportItem, ReportSectionId,
  ReportSettings, StepId, Version,
} from './types';

export interface Frame {
  meta: FrameMeta;
  image: FitsImage;
  /** The file as loaded (possibly gzipped), saved unchanged in the project file. */
  raw: Uint8Array;
}

export interface LogEntry {
  date: string;
  step: StepId;
  /** Message key under 'log.' in the interface strings. */
  code: string;
  params: Record<string, string | number>;
}

export interface ProjectInfo {
  title: string;
  student: string;
  created: string;
  /** App version that saved the project last. */
  savedWith?: string;
  lastSaved?: string;
}

export type MasterKind = Exclude<Kind, 'light'>;

export interface Master {
  /** 'master:bias', 'master:dark' or 'master:flat:<filter>' */
  id: string;
  kind: MasterKind;
  filter: string;
  image: FitsImage;
  /** Number of frames combined. */
  count: number;
  method: CombineMethod;
  /** Exposure of the frames combined (darks). */
  exposure: number;
  /** Flats: median level of each frame before normalising. */
  levels?: number[];
}

export interface Stack {
  /** 'stack:<filter>' */
  id: string;
  filter: string;
  image: FitsImage;
  count: number;
  method: CombineMethod;
}

/** Images computed from the frames with one set of settings. */
export interface Products {
  masters: Map<string, Master>;
  calibrated: Map<string, FitsImage>;
  aligned: Map<string, FitsImage>;
  alignCrop: Region | null;
  stacks: Map<string, Stack>;
}

export interface StepState {
  done: boolean;
  /** The student took the app's suggestion instead of their own choice. */
  acceptedAuto?: boolean;
}

export interface Answer {
  value: string;
  correct?: boolean;
  attempts: number;
}

export type ChangeKind = 'frames' | 'selection' | 'profile' | 'settings' | 'masters' | 'calibrated' | 'aligned' | 'stacks'
  | 'auto' | 'compositions' | 'versions' | 'comments' | 'report' | 'mentor' | 'steps' | 'answers' | 'overlay' | 'info' | 'log' | 'saved';

/** Changes that do not need saving. */
const TRANSIENT = new Set<ChangeKind>(['selection', 'overlay', 'saved', 'masters', 'calibrated', 'aligned', 'stacks', 'auto', 'mentor']);

export function masterId(kind: MasterKind, filter = ''): string {
  return kind === 'flat' ? `master:flat:${filter}` : `master:${kind}`;
}

export function defaultSettings(): ProcessingSettings {
  return {
    trim: undefined,
    combine: { bias: 'median', dark: 'median', flat: 'median', stack: 'median' },
    useBias: true,
    useDark: true,
    useFlat: true,
    darkForFlats: false,
    alignModel: 'shift',
    transforms: {},
    manualStars: {},
  };
}

class State {
  frames: Frame[] = [];
  profile: InstrumentProfile | null = null;
  settings: ProcessingSettings = defaultSettings();
  steps: Partial<Record<StepId, StepState>> = {};
  masters = new Map<string, Master>();
  /** Calibrated light frames, keyed by frame id. */
  calibrated = new Map<string, FitsImage>();
  /** Calibrated lights moved onto the reference and cropped to the common area, keyed by frame id. */
  aligned = new Map<string, FitsImage>();
  /** Common area of the aligned frames, in calibrated (trimmed) coordinates. */
  alignCrop: Region | null = null;
  /** Stacked image per filter. */
  stacks = new Map<string, Stack>();
  /** The app's own alignment of each light (null = it found no match), for comparison. */
  auto = new Map<string, AutoResult | null>();
  /** Colour images made from the stacks. */
  compositions: Composition[] = [];
  /** Saved settings for comparisons. */
  versions: Version[] = [];
  /** Images computed with a version's settings, keyed by version id (see versions.ts). */
  versionProducts = new Map<string, Products>();
  /** Mentor comments, keyed by 'step:<id>' or 'task:<id>'. */
  comments: Record<string, MentorComment[]> = {};
  /** Report sections and the figures and measurements added to it. */
  report: ReportSettings = { sections: {}, items: [] };
  info: ProjectInfo = newInfo();
  log: LogEntry[] = [];
  /** Changed since the last save. */
  dirty = false;
  /** Keyed by `<taskId>.<partId>`. */
  answers: Record<string, Answer> = {};
  /** Hint levels opened per task. */
  hintsUsed: Record<string, number> = {};
  /** Selected image: a frame id or a master id. */
  selectedId: string | null = null;
  /** A trim region being edited, drawn on raw frames before it is confirmed. */
  trimPreview: Region | null = null;
  private listeners = new Set<(kind: ChangeKind) => void>();
  private muted = 0;
  private nextId = 1;

  newId(): string {
    return `f${this.nextId++}`;
  }

  frame(id: string | null): Frame | undefined {
    return this.frames.find((f) => f.meta.id === id);
  }

  /** Frames of a kind that are not excluded; flats and lights optionally of one filter. */
  framesOf(kind: Kind, filter?: string): Frame[] {
    return this.frames.filter((f) => !f.meta.excluded && f.meta.kind === kind && (filter === undefined || f.meta.filter === filter));
  }

  /** Filters of the included frames of a kind, in name order. */
  filtersOf(kind: 'flat' | 'light'): string[] {
    return [...new Set(this.framesOf(kind).map((f) => f.meta.filter))].sort();
  }

  /**
   * The image shown for an id: a frame, a master ('master:…'), a calibrated light ('cal:<frame id>'),
   * an aligned light ('aligned:<frame id>') or a stack ('stack:<filter>'). 'v:<version id>:<id>'
   * is the same image computed with a saved version's settings. Colour images
   * ('color:<composition id>') are not single images; see composition().
   */
  viewable(id: string | null): { title: string; image: FitsImage; isMaster: boolean } | undefined {
    if (!id) return undefined;
    if (id.startsWith('v:')) {
      const [, vid, ...rest] = id.split(':');
      const p = this.versionProducts.get(vid);
      const image = p && productImage(p, rest.join(':'));
      return image ? { title: id, image, isMaster: true } : undefined;
    }
    // Derived images are trimmed like the masters
    const derived = productImage(this, id);
    if (derived) return { title: id, image: derived, isMaster: true };
    if (id.includes(':')) return undefined;
    const f = this.frame(id);
    return f ? { title: f.meta.fileName, image: f.image, isMaster: false } : undefined;
  }

  composition(id: string | null): Composition | undefined {
    return id?.startsWith('color:') ? this.compositions.find((c) => c.id === id.slice(6)) : undefined;
  }

  /** Runs `fn` without change events, e.g. while computing a version's images. */
  quietly(fn: () => void): void {
    this.muted++;
    try {
      fn();
    } finally {
      this.muted--;
    }
  }

  addVersion(v: Version): void {
    this.versions.push(v);
    this.emit('versions');
  }

  updateVersion(id: string, patch: Partial<Version>): void {
    const v = this.versions.find((x) => x.id === id);
    if (!v) return;
    Object.assign(v, patch);
    this.emit('versions');
  }

  removeVersion(id: string): void {
    this.versions = this.versions.filter((v) => v.id !== id);
    this.versionProducts.delete(id);
    if (this.selectedId?.startsWith(`v:${id}:`)) this.select(null);
    this.emit('versions');
  }

  addComment(key: string, text: string): void {
    (this.comments[key] ??= []).push({ text, date: new Date().toISOString() });
    this.emit('comments');
  }

  removeComment(key: string, index: number): void {
    const list = this.comments[key];
    if (!list) return;
    list.splice(index, 1);
    if (!list.length) delete this.comments[key];
    this.emit('comments');
  }

  addReportItem(item: Omit<ReportItem, 'id' | 'added'>): ReportItem {
    let n = 1;
    while (this.report.items.some((x) => x.id === `r${n}`)) n++;
    const full = { ...item, id: `r${n}`, added: new Date().toISOString() };
    this.report.items.push(full);
    this.emit('report');
    return full;
  }

  updateReportItem(id: string, patch: Partial<Pick<ReportItem, 'caption' | 'snapshot'>>): void {
    const item = this.report.items.find((x) => x.id === id);
    if (!item) return;
    Object.assign(item, patch);
    this.emit('report');
  }

  removeReportItem(id: string): void {
    const i = this.report.items.findIndex((x) => x.id === id);
    if (i < 0) return;
    this.report.items.splice(i, 1);
    // The next item would otherwise be put beside another one
    this.unpair(i);
    this.emit('report');
  }

  /** Moves an item up (−1) or down (+1) in the report. Moving separates images shown side by side. */
  moveReportItem(id: string, by: -1 | 1): void {
    const list = this.report.items;
    const i = list.findIndex((x) => x.id === id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    for (let k = Math.min(i, j); k <= Math.max(i, j) + 1; k++) this.unpair(k);
    this.emit('report');
  }

  /** Shows an item beside the previous one, or on its own. */
  setReportItemBeside(id: string, beside: boolean): void {
    const item = this.report.items.find((x) => x.id === id);
    if (!item) return;
    if (beside) item.beside = true;
    else delete item.beside;
    this.emit('report');
  }

  private unpair(index: number): void {
    const item = this.report.items[index];
    if (item) delete item.beside;
  }

  setReportSection(id: ReportSectionId, on: boolean): void {
    this.report.sections[id] = on;
    this.emit('report');
  }

  addComposition(c: Composition): void {
    this.compositions.push(c);
    this.emit('compositions');
  }

  updateComposition(id: string, patch: Partial<Composition>): void {
    const c = this.compositions.find((x) => x.id === id);
    if (!c) return;
    Object.assign(c, patch);
    this.emit('compositions');
  }

  removeComposition(id: string): void {
    this.compositions = this.compositions.filter((c) => c.id !== id);
    if (this.selectedId === `color:${id}`) this.select(null);
    this.emit('compositions');
  }

  /** An id for a new composition. */
  newCompositionId(): string {
    let n = 1;
    while (this.compositions.some((c) => c.id === `c${n}`)) n++;
    return `c${n}`;
  }

  addFrames(frames: Frame[]): void {
    if (frames.length === 0) return;
    this.frames.push(...frames);
    this.emit('frames');
  }

  removeFrame(id: string): void {
    this.frames = this.frames.filter((f) => f.meta.id !== id);
    if (this.selectedId === id) this.select(null);
    this.emit('frames');
  }

  clear(): void {
    this.frames = [];
    this.profile = null;
    this.settings = defaultSettings();
    this.steps = {};
    this.masters.clear();
    this.answers = {};
    this.hintsUsed = {};
    this.calibrated.clear();
    this.aligned.clear();
    this.alignCrop = null;
    this.stacks.clear();
    this.auto.clear();
    this.compositions = [];
    this.versions = [];
    this.versionProducts.clear();
    this.comments = {};
    this.report = { sections: {}, items: [] };
    this.info = newInfo();
    this.log = [];
    this.trimPreview = null;
    this.nextId = 1;
    this.select(null);
    for (const k of ['frames', 'profile', 'settings', 'masters', 'calibrated', 'aligned', 'stacks', 'auto', 'compositions', 'versions', 'comments', 'report', 'steps', 'answers', 'info', 'log'] as const) this.emit(k);
    this.markSaved();
  }

  /** Makes sure new ids do not clash with ids loaded from a project. */
  reserveIds(ids: string[]): void {
    for (const id of ids) {
      const n = Number(id.replace(/^f/, ''));
      if (Number.isInteger(n) && n >= this.nextId) this.nextId = n + 1;
    }
  }

  setInfo(patch: Partial<ProjectInfo>): void {
    Object.assign(this.info, patch);
    this.emit('info');
  }

  addLog(step: StepId, code: string, params: Record<string, string | number> = {}): void {
    this.log.push({ date: new Date().toISOString(), step, code, params });
    this.emit('log');
  }

  setCalibrated(images: Map<string, FitsImage>): void {
    this.calibrated = images;
    if (this.selectedId?.startsWith('cal:') && !this.viewable(this.selectedId)) this.select(null);
    this.emit('calibrated');
  }

  setAligned(images: Map<string, FitsImage>, crop: Region | null): void {
    this.aligned = images;
    this.alignCrop = crop;
    if (this.selectedId?.startsWith('aligned:') && !this.viewable(this.selectedId)) this.select(null);
    this.emit('aligned');
  }

  setStacks(stacks: Map<string, Stack>): void {
    this.stacks = stacks;
    if (this.selectedId?.startsWith('stack:') && !this.viewable(this.selectedId)) this.select(null);
    this.emit('stacks');
  }

  setAuto(auto: Map<string, AutoResult | null>): void {
    this.auto = auto;
    this.emit('auto');
  }

  markSaved(): void {
    this.dirty = false;
    this.emit('saved');
  }

  updateMeta(id: string, patch: Partial<FrameMeta>): void {
    const f = this.frame(id);
    if (!f) return;
    Object.assign(f.meta, patch);
    this.emit('frames');
  }

  setProfile(profile: InstrumentProfile): void {
    this.profile = profile;
    this.emit('profile');
  }

  /** Uses a changed or loaded profile and reads the frame headers again with it. */
  applyProfile(profile: InstrumentProfile): void {
    this.profile = profile;
    let changed = false;
    for (const f of this.frames) {
      const meta = redescribe(f.meta, profile);
      if (READ_FROM_HEADER.some((k) => meta[k] !== f.meta[k])) {
        f.meta = meta;
        changed = true;
      }
    }
    this.emit('profile');
    if (changed) this.emit('frames');
  }

  updateSettings(patch: Partial<ProcessingSettings>): void {
    Object.assign(this.settings, patch);
    this.emit('settings');
  }

  setStep(id: StepId, s: StepState | undefined): void {
    if (s) this.steps[id] = s;
    else delete this.steps[id];
    this.emit('steps');
  }

  isDone(id: StepId): boolean {
    return !!this.steps[id]?.done;
  }

  setMaster(m: Master): void {
    this.masters.set(m.id, m);
    this.emit('masters');
  }

  /** Removes masters of a kind (all filters for flats). */
  clearMasters(kind: MasterKind): void {
    let changed = false;
    for (const [id, m] of this.masters) {
      if (m.kind === kind) {
        this.masters.delete(id);
        changed = true;
      }
    }
    if (this.selectedId && !this.viewable(this.selectedId)) this.select(null);
    if (changed) this.emit('masters');
  }

  setAnswer(key: string, a: Answer): void {
    this.answers[key] = a;
    this.emit('answers');
  }

  useHint(taskId: string, level: number): void {
    this.hintsUsed[taskId] = Math.max(this.hintsUsed[taskId] ?? 0, level);
    this.emit('answers');
  }

  setTrimPreview(r: Region | null): void {
    this.trimPreview = r;
    this.emit('overlay');
  }

  select(id: string | null): void {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.emit('selection');
  }

  /** Bytes used by pixel data (float32). */
  memoryBytes(): number {
    let sum = this.frames.reduce((s, f) => s + f.image.data.byteLength + f.raw.byteLength, 0);
    for (const m of this.masters.values()) sum += m.image.data.byteLength;
    for (const c of this.calibrated.values()) sum += c.data.byteLength;
    for (const c of this.aligned.values()) sum += c.data.byteLength;
    for (const c of this.stacks.values()) sum += c.image.data.byteLength;
    for (const p of this.versionProducts.values()) {
      for (const m of [...p.masters.values(), ...p.stacks.values()]) sum += m.image.data.byteLength;
      for (const c of [...p.calibrated.values(), ...p.aligned.values()]) sum += c.data.byteLength;
    }
    return sum;
  }

  on(fn: (kind: ChangeKind) => void): void {
    this.listeners.add(fn);
  }

  emit(kind: ChangeKind): void {
    if (this.muted) return;
    if (!TRANSIENT.has(kind)) this.dirty = true;
    for (const fn of this.listeners) fn(kind);
  }
}

/** The frame metadata a profile can change. */
const READ_FROM_HEADER = ['kind', 'kindSource', 'filter', 'exposure', 'dateObs', 'temperature', 'xbin', 'ybin'] as const;

/** A master, stack, calibrated or aligned image of a set of products. */
function productImage(p: Products, id: string): FitsImage | undefined {
  return p.masters.get(id)?.image ?? p.stacks.get(id)?.image
    ?? (id.startsWith('cal:') ? p.calibrated.get(id.slice(4)) : id.startsWith('aligned:') ? p.aligned.get(id.slice(8)) : undefined);
}

function newInfo(): ProjectInfo {
  return { title: '', student: '', created: new Date().toISOString() };
}

export const state = new State();
