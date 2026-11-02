// Aligns the calibrated lights onto the reference frame and stacks them per filter. See docs/DESIGN.md §3.3.
//
// Star positions and transforms are in raw (untrimmed) 0-based coordinates, so changing the
// trim region does not move them. The calibrated frames start at the trim origin.

import { type AutoResult, autoAlign, centroid, commonCrop, coverage, findStars, fitTransform, IDENTITY, type Point, type Star, type Transform, warp } from './align';
import { combine, trimPlane } from './calibrate';
import type { FitsImage } from './fits';
import { toImage } from './masters';
import { type Frame, type Stack, state } from './state';
import type { AlignTransform, CombineMethod } from './types';

const METHOD_NAME: Record<CombineMethod, string> = { median: 'median', mean: 'mean', sigmaClip: 'sigma-clipped mean' };

/** At most this many stars are clicked per frame. */
export const MAX_MANUAL_STARS = 3;

export function stackId(filter: string): string {
  return `stack:${filter}`;
}

/** Included light frames, earliest first. */
export function lightsByTime(): Frame[] {
  return state.framesOf('light').slice().sort((a, b) =>
    a.meta.dateObs.localeCompare(b.meta.dateObs) || a.meta.fileName.localeCompare(b.meta.fileName));
}

/** The student's reference frame, or the first light in time. */
export function referenceFrame(): Frame | undefined {
  const lights = lightsByTime();
  return lights.find((f) => f.meta.id === state.settings.referenceId) ?? lights[0];
}

/** Rotation centre: the middle of the raw frame. */
export function centre(f: Frame): Point {
  return { x: (f.meta.width - 1) / 2, y: (f.meta.height - 1) / 2 };
}

/** Where pixel (0, 0) of a calibrated frame is in raw coordinates. */
export function trimOffset(): Point {
  const t = state.settings.trim;
  return { x: t?.x0 ?? 0, y: t?.y0 ?? 0 };
}

/** The transform used for a light: none for the reference, else the chosen one. */
export function transformOf(id: string): AlignTransform | undefined {
  if (id === referenceFrame()?.meta.id) return { ...IDENTITY, source: 'manual' };
  return state.settings.transforms[id];
}

const starCache = new WeakMap<Float32Array, Star[]>();

/** Bright stars of a calibrated light, in raw coordinates. */
export function starsOf(id: string): Star[] | undefined {
  const img = state.calibrated.get(id);
  if (!img) return undefined;
  let stars = starCache.get(img.data);
  if (!stars) {
    const o = trimOffset();
    stars = findStars(img).map((s) => ({ ...s, x: s.x + o.x, y: s.y + o.y }));
    starCache.set(img.data, stars);
  }
  return stars;
}

/** The star nearest to a click on a calibrated light (calibrated coordinates in, raw out). */
export function starAt(id: string, x: number, y: number): Star | null {
  const img = state.calibrated.get(id);
  if (!img) return null;
  const s = centroid(img, x, y);
  if (!s) return null;
  const o = trimOffset();
  return { ...s, x: s.x + o.x, y: s.y + o.y };
}

/** The transform from the stars the student clicked: star k of the frame matches star k of the reference. */
export function manualTransform(id: string): (Transform & { rms: number; pairs: number }) | undefined {
  const ref = referenceFrame();
  if (!ref || id === ref.meta.id) return undefined;
  const a = state.settings.manualStars[id] ?? [];
  const b = state.settings.manualStars[ref.meta.id] ?? [];
  const n = Math.min(a.length, b.length);
  if (n === 0) return undefined;
  const pairs: [Point, Point][] = [];
  for (let k = 0; k < n; k++) pairs.push([{ x: a[k][0], y: a[k][1] }, { x: b[k][0], y: b[k][1] }]);
  return { ...fitTransform(pairs, centre(ref), state.settings.alignModel === 'shiftRotation'), pairs: n };
}

/**
 * Recomputes the transforms that come from clicked stars, e.g. after the stars, the reference or
 * the model changed. `take` also switches these frames from the app's result to their own stars.
 */
export function updateManualTransforms(take: string[] = []): void {
  const transforms = { ...state.settings.transforms };
  const ref = referenceFrame()?.meta.id;
  for (const f of state.framesOf('light')) {
    const id = f.meta.id;
    if (id === ref) {
      delete transforms[id];
      continue;
    }
    if (transforms[id]?.source === 'auto' && !take.includes(id)) continue;
    const m = manualTransform(id);
    if (m) transforms[id] = { dx: m.dx, dy: m.dy, rotation: m.rotation, source: 'manual' };
    // Without stars, a frame keeps the app's result if it has one
    else if (transforms[id]?.source !== 'auto') delete transforms[id];
  }
  state.updateSettings({ transforms });
}

/** The app's alignment of each light (or the given ones) to the reference; kept in the state unless `store` is false. */
export function runAuto(ids?: string[], store = true): Map<string, AutoResult | null> {
  const ref = referenceFrame();
  const out = new Map(state.auto);
  if (!ref) return out;
  const refStars = starsOf(ref.meta.id) ?? [];
  const c = centre(ref);
  const rotation = state.settings.alignModel === 'shiftRotation';
  for (const f of state.framesOf('light')) {
    const id = f.meta.id;
    if (ids && !ids.includes(id)) continue;
    if (id === ref.meta.id) {
      out.set(id, { ...IDENTITY, matched: refStars.length, rms: 0, method: 'nearest' });
      continue;
    }
    const stars = starsOf(id);
    // The student's own result is a good first guess, e.g. after a meridian flip
    const own = state.settings.transforms[id];
    out.set(id, stars ? autoAlign(stars, refStars, c, rotation, own ? [own] : []) : null);
  }
  if (store) state.setAuto(out);
  return out;
}

/** Uses the app's result for these frames. Returns the ids it could not align. */
export function useAuto(ids: string[]): string[] {
  const transforms = { ...state.settings.transforms };
  const failed: string[] = [];
  const ref = referenceFrame()?.meta.id;
  for (const id of ids) {
    if (id === ref) continue;
    const a = state.auto.get(id);
    if (a) transforms[id] = { dx: a.dx, dy: a.dy, rotation: a.rotation, source: 'auto' };
    else failed.push(id);
  }
  state.updateSettings({ transforms });
  return failed;
}

/** Forgets the alignment, e.g. when the reference or the model changes. Clicked stars are kept. */
export function resetAlignment(): void {
  state.setAuto(new Map());
  state.updateSettings({ transforms: {} });
  updateManualTransforms();
  state.setStep('align', undefined);
  state.setStep('stack', undefined);
}

function degrees(rad: number): string {
  return String(Number(((rad * 180) / Math.PI).toFixed(3)));
}

/** Moves each calibrated light onto the reference and crops all of them to the area they share. */
export function alignLights(): void {
  const ref = referenceFrame();
  if (!state.isDone('align') || !ref || !state.calibrated.size) {
    if (state.aligned.size || state.alignCrop) state.setAligned(new Map(), null);
    return;
  }
  const c = centre(ref);
  const o = trimOffset();
  const items = state.framesOf('light').flatMap((f) => {
    const cal = state.calibrated.get(f.meta.id);
    const t = transformOf(f.meta.id);
    return cal && t ? [{ f, cal, t }] : [];
  });
  const crop = items.length ? commonCrop(items.map(({ cal, t }) => coverage(cal.width, cal.height, t, c, o)), items[0].cal.width, items[0].cal.height) : null;
  const out = new Map<string, FitsImage>();
  if (crop) {
    for (const { f, cal, t } of items) {
      const p = trimPlane(warp(cal, t, c, o), crop);
      out.set(f.meta.id, toImage(p, { image: cal }, 'light', [
        f === ref
          ? `Alignment reference frame`
          : `Aligned to ${ref.meta.fileName}: dx=${Number(t.dx.toFixed(3))}, dy=${Number(t.dy.toFixed(3))} px, rotation=${degrees(t.rotation)} deg (${t.source})`,
        `Cropped to [${crop.x0 + 1}:${crop.x1 + 1},${crop.y0 + 1}:${crop.y1 + 1}] of the calibrated frame, common to all frames`,
      ], 'LIGHT'));
    }
  }
  state.setAligned(out, crop);
}

/** Stacks the aligned frames of each filter. */
export function stackLights(): void {
  const ref = referenceFrame();
  if (!state.isDone('stack') || !state.aligned.size || !ref) {
    if (state.stacks.size) state.setStacks(new Map());
    return;
  }
  const method = state.settings.combine.stack;
  const out = new Map<string, Stack>();
  for (const filter of state.filtersOf('light')) {
    const frames = state.framesOf('light', filter).filter((f) => state.aligned.has(f.meta.id));
    if (!frames.length) continue;
    const p = combine(frames.map((f) => state.aligned.get(f.meta.id)!), method);
    const id = stackId(filter);
    const crop = state.alignCrop!;
    // The header and calibration history come from the first calibrated frame
    out.set(id, {
      id, filter, count: frames.length, method,
      image: toImage(p, { image: state.calibrated.get(frames[0].meta.id)! }, 'light', [
        `Aligned to ${ref.meta.fileName}, cropped to [${crop.x0 + 1}:${crop.x1 + 1},${crop.y0 + 1}:${crop.y1 + 1}] of the calibrated frame`,
        `Stacked: ${METHOD_NAME[method]} of ${frames.length} aligned frames`,
      ], 'STACKED LIGHT'),
    });
  }
  state.setStacks(out);
}

/** Redoes alignment and stacking after the calibrated frames or the transforms changed. */
export function refreshAligned(): void {
  alignLights();
  stackLights();
}
