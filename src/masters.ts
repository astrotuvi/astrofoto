// Builds master frames and calibrated lights from the loaded frames and the student's settings.

import { calibrateLight, detectTrim, masterBias, masterDark, masterFlat, type Plane, trimPlane } from './calibrate';
import { type FitsImage, type HeaderCard, type HeaderValue, valueCard } from './fits';
import { refreshAligned } from './stack';
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
export function toImage(p: Plane, source: { image: FitsImage }, kind: string, history: string[], imageType = `MASTER ${kind.toUpperCase()}`): FitsImage {
  const keep = (c: HeaderCard) => !['NAXIS1', 'NAXIS2', 'BZERO', 'BSCALE', 'BITPIX', 'CHECKSUM', 'DATASUM', 'IMAGETYP'].includes(c.key);
  const extra = [
    { key: 'IMAGETYP', value: imageType },
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
  const bias = state.masters.get(masterId('bias'));
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
  const bias = state.masters.get(masterId('bias'));
  const dark = state.settings.darkForFlats ? state.masters.get(masterId('dark')) : undefined;
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
 * Rebuilds the results of the steps already done, in order (masters, calibration, alignment,
 * stacks), after the frames or settings have changed. A step done without frames
 * ("continue without") stays done.
 */
export function refreshAll(): void {
  for (const kind of ['bias', 'dark', 'flat'] as MasterKind[]) {
    if (state.isDone(STEP_OF[kind])) computeMasters(kind);
    else state.clearMasters(kind);
  }
  if (state.isDone('calibrate')) calibrateLights();
  else if (state.calibrated.size) state.setCalibrated(new Map());
  refreshAligned();
}

/** Dark scale factor for a light: t_light / t_dark, or 1 when the dark still contains the bias. */
export function darkScale(lightExposure: number): number {
  const dark = state.masters.get(masterId('dark'));
  if (!dark || !state.masters.has(masterId('bias')) || !(dark.exposure > 0)) return 1;
  return lightExposure / dark.exposure;
}

/** calibrated = (light − master bias − scale · master dark) / master flat, for each light. */
export function calibrateLights(): void {
  const s = state.settings;
  const bias = s.useBias ? state.masters.get(masterId('bias')) : undefined;
  const dark = s.useDark ? state.masters.get(masterId('dark')) : undefined;
  const out = new Map<string, FitsImage>();
  for (const f of state.framesOf('light')) {
    const flat = s.useFlat ? state.masters.get(masterId('flat', f.meta.filter)) : undefined;
    const scale = darkScale(f.meta.exposure);
    const p = calibrateLight(plane(f), bias?.image ?? null, dark ? { plane: dark.image, scale } : null, flat?.image ?? null);
    const history = [
      ...trimHistory(),
      bias ? 'Subtracted master bias' : 'No bias subtracted',
      dark ? `Subtracted master dark × ${Number(scale.toFixed(4))}` : 'No dark subtracted',
      flat ? `Divided by master flat ${f.meta.filter}` : 'Not divided by a flat',
    ];
    out.set(f.meta.id, toImage(p, f, 'light', history, 'LIGHT'));
  }
  state.setCalibrated(out);
}

/** The trim region the app finds from a flat (or a light, if there are no flats). */
export function suggestedTrim(): Region | null | undefined {
  const f = state.framesOf('flat')[0] ?? state.framesOf('light')[0];
  return f ? detectTrim(f.image) : undefined;
}

// Results depend on the frames: rebuild them whenever frames are added, removed or changed
state.on((kind) => {
  if (kind !== 'frames') return;
  try {
    refreshAll();
  } catch {
    // e.g. frames of different sizes; the consistency checks explain it
  }
});
