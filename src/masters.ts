// Builds master frames from the loaded frames and the student's settings.

import { detectTrim, masterBias, masterDark, masterFlat, type Plane, trimPlane } from './calibrate';
import { type FitsImage, type HeaderCard, type HeaderValue, valueCard } from './fits';
import { type Frame, type Master, type MasterKind, masterId, state } from './state';
import type { CombineMethod, Region, StepId } from './types';

const METHOD_NAME: Record<CombineMethod, string> = { median: 'median', mean: 'mean', sigmaClip: 'sigma-clipped mean' };

function plane(f: Frame): Plane {
  return trimPlane(f.image, state.settings.trim ?? null);
}

function regionText(r: Region): string {
  return `[${r.x0 + 1}:${r.x1 + 1},${r.y0 + 1}:${r.y1 + 1}]`;
}

/** A float image with the first source frame's header and HISTORY lines. */
function toImage(p: Plane, source: Frame, kind: string, history: string[]): FitsImage {
  const keep = (c: HeaderCard) => !['NAXIS1', 'NAXIS2', 'BZERO', 'BSCALE', 'BITPIX', 'CHECKSUM', 'DATASUM', 'IMAGETYP'].includes(c.key);
  const extra = [
    { key: 'IMAGETYP', value: `MASTER ${kind.toUpperCase()}` },
  ];
  const cards: HeaderCard[] = [
    ...source.image.cards.filter(keep),
    ...extra.map((c) => ({ ...c, raw: valueCard(c.key, c.value) })),
    ...history.map((h) => ({ key: 'HISTORY', comment: h, raw: `HISTORY ${h}` })),
  ];
  const header: Record<string, HeaderValue> = {};
  for (const c of cards) if (c.value !== undefined && !(c.key in header)) header[c.key] = c.value;
  return { width: p.width, height: p.height, data: p.data, cards, header, bitpix: -32, hdu: 0, warnings: [] };
}

function trimHistory(): string[] {
  const t = state.settings.trim;
  return t ? [`Trimmed to ${regionText(t)} (1-based, inclusive)`] : [];
}

export function buildBias(): Master | null {
  const frames = state.framesOf('bias');
  if (frames.length === 0) return null;
  const method = state.settings.combine.bias;
  const p = masterBias(frames.map(plane), method);
  return {
    id: masterId('bias'), kind: 'bias', filter: '', count: frames.length, method, exposure: 0,
    image: toImage(p, frames[0], 'bias', [...trimHistory(), `Master bias: ${METHOD_NAME[method]} of ${frames.length} frames`]),
  };
}

export function buildDark(): Master | null {
  const frames = state.framesOf('dark');
  if (frames.length === 0) return null;
  const method = state.settings.combine.dark;
  const bias = state.settings.useBias ? state.masters.get(masterId('bias')) : undefined;
  const p = masterDark(frames.map(plane), bias ? bias.image : null, method);
  const exposure = frames[0].meta.exposure;
  return {
    id: masterId('dark'), kind: 'dark', filter: '', count: frames.length, method, exposure,
    image: toImage(p, frames[0], 'dark', [
      ...trimHistory(),
      `Master dark: ${METHOD_NAME[method]} of ${frames.length} frames${bias ? ' minus master bias' : ''}`,
      `Dark exposure ${exposure} s`,
    ]),
  };
}

export function buildFlats(): Master[] {
  const method = state.settings.combine.flat;
  const bias = state.settings.useBias ? state.masters.get(masterId('bias')) : undefined;
  const dark = state.settings.useDark && state.settings.darkForFlats ? state.masters.get(masterId('dark')) : undefined;
  return state.filtersOf('flat').map((filter) => {
    const frames = state.framesOf('flat', filter);
    const r = masterFlat(
      frames.map((f) => ({ plane: plane(f), exposure: f.meta.exposure })),
      bias ? bias.image : null,
      dark ? { plane: dark.image, exposure: dark.exposure } : null,
      method,
    );
    return {
      id: masterId('flat', filter), kind: 'flat', filter, count: frames.length, method, exposure: 0, levels: r.levels,
      image: toImage(r.master, frames[0], 'flat', [
        ...trimHistory(),
        `Master flat ${filter}: each flat${bias ? ' minus master bias' : ''}${dark ? ' minus scaled master dark' : ''}, divided by its median`,
        `then ${METHOD_NAME[method]} of ${frames.length} frames, normalised to median 1`,
      ]),
    } satisfies Master;
  });
}

const STEP_OF: Record<MasterKind, StepId> = { bias: 'bias', dark: 'dark', flat: 'flat' };

/** Builds the masters of one kind and stores them. Returns false when there are no frames. */
export function computeMasters(kind: MasterKind): boolean {
  state.clearMasters(kind);
  if (kind === 'flat') {
    const flats = buildFlats();
    for (const m of flats) state.setMaster(m);
    return flats.length > 0;
  }
  const m = kind === 'bias' ? buildBias() : buildDark();
  if (m) state.setMaster(m);
  return !!m;
}

/**
 * Rebuilds the masters of the steps already done, in order, after the frames or settings
 * have changed. A step whose frames have all gone is reopened.
 */
export function refreshMasters(): void {
  for (const kind of ['bias', 'dark', 'flat'] as MasterKind[]) {
    const step = STEP_OF[kind];
    if (!state.isDone(step)) {
      state.clearMasters(kind);
      continue;
    }
    const use = kind === 'bias' ? state.settings.useBias : kind === 'dark' ? state.settings.useDark : state.settings.useFlat;
    if (!use) continue;
    if (!computeMasters(kind)) state.setStep(step, undefined);
  }
}

/** The trim region the app finds from a flat (or a light, if there are no flats). */
export function suggestedTrim(): Region | null | undefined {
  const f = state.framesOf('flat')[0] ?? state.framesOf('light')[0];
  return f ? detectTrim(f.image) : undefined;
}
