// Named versions: saved processing settings whose images can be compared with the current ones,
// e.g. calibrated with and without the flat (§4.4).
//
// A version keeps the calibration and stacking choices. Alignment (reference, model, transforms,
// clicked stars) and the steps done always come from the current project, so a version saved
// during calibration can still be compared after stacking. Its images are not stored: they are
// computed when needed and kept for the last few versions only.

import { refreshAll } from './masters';
import { type Products, state } from './state';
import type { CombineMethod, ProcessingSettings, Region, Version } from './types';

/** Versions whose images are kept in memory at a time. */
const KEEP = 2;

const ALIGN_KEYS = ['referenceId', 'alignModel', 'transforms', 'manualStars'] as const;

/** What a version's images depend on apart from its own settings. */
function inputsKey(): string {
  const s = state.settings;
  return JSON.stringify({
    align: ALIGN_KEYS.map((k) => s[k]),
    steps: state.steps,
    frames: state.frames.map((f) => [f.meta.id, f.meta.kind, f.meta.filter, !!f.meta.excluded]),
  });
}

const keys = new Map<string, string>();

export function newVersionId(): string {
  let n = 1;
  while (state.versions.some((v) => v.id === `v${n}`)) n++;
  return `v${n}`;
}

/** Saves the current settings under a name. */
export function saveVersion(name: string): Version {
  const v: Version = { id: newVersionId(), name, settings: structuredClone(state.settings), created: new Date().toISOString() };
  state.addVersion(v);
  state.addLog('calibrate', 'versionSaved', { name });
  return v;
}

/** True when the version's images are computed and still match the frames and alignment. */
export function isFresh(id: string): boolean {
  return state.versionProducts.has(id) && keys.get(id) === inputsKey();
}

/**
 * Computes the images of a version (if they are not fresh already) by running the processing
 * with its settings, without change events, then putting the current images back.
 */
export function computeVersion(id: string): Products | undefined {
  const v = state.versions.find((x) => x.id === id);
  if (!v) return undefined;
  if (isFresh(id)) {
    // Most recently used last
    const p = state.versionProducts.get(id)!;
    state.versionProducts.delete(id);
    state.versionProducts.set(id, p);
    return p;
  }
  const saved = {
    settings: state.settings, masters: state.masters, calibrated: state.calibrated, aligned: state.aligned,
    alignCrop: state.alignCrop, stacks: state.stacks, selectedId: state.selectedId,
  };
  let products: Products | undefined;
  state.quietly(() => {
    try {
      const settings = structuredClone(v.settings);
      for (const k of ALIGN_KEYS) (settings as unknown as Record<string, unknown>)[k] = structuredClone(saved.settings[k]);
      state.settings = settings;
      state.masters = new Map();
      state.calibrated = new Map();
      state.aligned = new Map();
      state.alignCrop = null;
      state.stacks = new Map();
      refreshAll();
      products = { masters: state.masters, calibrated: state.calibrated, aligned: state.aligned, alignCrop: state.alignCrop, stacks: state.stacks };
    } finally {
      Object.assign(state, saved);
    }
  });
  state.versionProducts.delete(id);
  state.versionProducts.set(id, products!);
  keys.set(id, inputsKey());
  while (state.versionProducts.size > KEEP) {
    const oldest = state.versionProducts.keys().next().value!;
    state.versionProducts.delete(oldest);
    keys.delete(oldest);
  }
  return products;
}

export type Difference =
  | { what: 'trim'; value: Region | null | undefined }
  | { what: 'useBias' | 'useDark' | 'useFlat' | 'darkForFlats'; value: boolean }
  | { what: 'combine'; kind: 'bias' | 'dark' | 'flat' | 'stack'; value: CombineMethod };

/** How the settings of a version (`v`) differ from `base`, e.g. the current ones. */
export function differences(v: ProcessingSettings, base: ProcessingSettings): Difference[] {
  const out: Difference[] = [];
  if (JSON.stringify(v.trim) !== JSON.stringify(base.trim)) out.push({ what: 'trim', value: v.trim });
  for (const what of ['useBias', 'useDark', 'useFlat', 'darkForFlats'] as const) {
    if (v[what] !== base[what]) out.push({ what, value: v[what] });
  }
  for (const kind of ['bias', 'dark', 'flat', 'stack'] as const) {
    if (v.combine[kind] !== base.combine[kind]) out.push({ what: 'combine', kind, value: v.combine[kind] });
  }
  return out;
}
