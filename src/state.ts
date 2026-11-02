// In-memory application state and change events.

import type { FitsImage } from './fits';
import type { CombineMethod, FrameMeta, InstrumentProfile, Kind, ProcessingSettings, Region, StepId } from './types';

export interface Frame {
  meta: FrameMeta;
  image: FitsImage;
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

export type ChangeKind = 'frames' | 'selection' | 'profile' | 'settings' | 'masters' | 'steps' | 'answers' | 'overlay';

export function masterId(kind: MasterKind, filter = ''): string {
  return kind === 'flat' ? `master:flat:${filter}` : `master:${kind}`;
}

export function defaultSettings(): ProcessingSettings {
  return {
    trim: undefined,
    combine: { bias: 'median', dark: 'median', flat: 'median' },
    useBias: true,
    useDark: true,
    useFlat: true,
    darkForFlats: false,
  };
}

class State {
  frames: Frame[] = [];
  profile: InstrumentProfile | null = null;
  settings: ProcessingSettings = defaultSettings();
  steps: Partial<Record<StepId, StepState>> = {};
  masters = new Map<string, Master>();
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

  /** The image shown for an id: a frame or a master. */
  viewable(id: string | null): { title: string; image: FitsImage; isMaster: boolean } | undefined {
    if (!id) return undefined;
    const m = this.masters.get(id);
    if (m) return { title: id, image: m.image, isMaster: true };
    const f = this.frame(id);
    return f ? { title: f.meta.fileName, image: f.image, isMaster: false } : undefined;
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
    this.trimPreview = null;
    this.select(null);
    for (const k of ['frames', 'profile', 'settings', 'masters', 'steps', 'answers'] as const) this.emit(k);
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
    let sum = this.frames.reduce((s, f) => s + f.image.data.byteLength, 0);
    for (const m of this.masters.values()) sum += m.image.data.byteLength;
    return sum;
  }

  on(fn: (kind: ChangeKind) => void): void {
    this.listeners.add(fn);
  }

  emit(kind: ChangeKind): void {
    for (const fn of this.listeners) fn(kind);
  }
}

export const state = new State();
