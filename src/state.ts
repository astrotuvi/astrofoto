// In-memory application state and change events.

import type { FitsImage } from './fits';
import type { FrameMeta, InstrumentProfile } from './types';

export interface Frame {
  meta: FrameMeta;
  image: FitsImage;
}

export type ChangeKind = 'frames' | 'selection' | 'profile';

class State {
  frames: Frame[] = [];
  profile: InstrumentProfile | null = null;
  selectedId: string | null = null;
  private listeners = new Set<(kind: ChangeKind) => void>();
  private nextId = 1;

  newId(): string {
    return `f${this.nextId++}`;
  }

  frame(id: string | null): Frame | undefined {
    return this.frames.find((f) => f.meta.id === id);
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
    this.select(null);
    this.emit('frames');
    this.emit('profile');
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

  select(id: string | null): void {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.emit('selection');
  }

  /** Bytes used by pixel data (float32). */
  memoryBytes(): number {
    return this.frames.reduce((sum, f) => sum + f.image.data.byteLength, 0);
  }

  on(fn: (kind: ChangeKind) => void): void {
    this.listeners.add(fn);
  }

  private emit(kind: ChangeKind): void {
    for (const fn of this.listeners) fn(kind);
  }
}

export const state = new State();
