// In-memory application state and change events.

import type { FitsImage } from './fits';
import type { AutoResult } from './align';
import type { CombineMethod, Composition, FrameMeta, InstrumentProfile, Kind, ProcessingSettings, Region, StepId } from './types';

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
  | 'auto' | 'compositions' | 'steps' | 'answers' | 'overlay' | 'info' | 'log' | 'saved';

/** Changes that do not need saving. */
const TRANSIENT = new Set<ChangeKind>(['selection', 'overlay', 'saved', 'masters', 'calibrated', 'aligned', 'stacks', 'auto']);

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
   * an aligned light ('aligned:<frame id>') or a stack ('stack:<filter>'). Colour images
   * ('color:<composition id>') are not single images; see composition().
   */
  viewable(id: string | null): { title: string; image: FitsImage; isMaster: boolean } | undefined {
    if (!id) return undefined;
    const m = this.masters.get(id) ?? this.stacks.get(id);
    if (m) return { title: id, image: m.image, isMaster: true };
    // Calibrated and aligned frames are trimmed like the masters
    const derived = id.startsWith('cal:') ? this.calibrated.get(id.slice(4))
      : id.startsWith('aligned:') ? this.aligned.get(id.slice(8)) : undefined;
    if (derived) return { title: id, image: derived, isMaster: true };
    if (id.includes(':')) return undefined;
    const f = this.frame(id);
    return f ? { title: f.meta.fileName, image: f.image, isMaster: false } : undefined;
  }

  composition(id: string | null): Composition | undefined {
    return id?.startsWith('color:') ? this.compositions.find((c) => c.id === id.slice(6)) : undefined;
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
    this.info = newInfo();
    this.log = [];
    this.trimPreview = null;
    this.nextId = 1;
    this.select(null);
    for (const k of ['frames', 'profile', 'settings', 'masters', 'calibrated', 'aligned', 'stacks', 'auto', 'compositions', 'steps', 'answers', 'info', 'log'] as const) this.emit(k);
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
    return sum;
  }

  on(fn: (kind: ChangeKind) => void): void {
    this.listeners.add(fn);
  }

  emit(kind: ChangeKind): void {
    if (!TRANSIENT.has(kind)) this.dirty = true;
    for (const fn of this.listeners) fn(kind);
  }
}

function newInfo(): ProjectInfo {
  return { title: '', student: '', created: new Date().toISOString() };
}

export const state = new State();
