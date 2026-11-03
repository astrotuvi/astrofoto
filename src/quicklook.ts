// The quick look: a colour image made of one raw light frame per filter, with no calibration,
// alignment or stacking, and automatic settings. It shows what the processing steps will fix,
// and is compared with the finished colour image at the end. See docs/DESIGN.md §3.1.

import { autoBlack, background, CHANNELS, type ColorImage, render } from './color';
import { filterInfo } from './instrument/profile';
import { trimOffset } from './stack';
import { type Frame, state } from './state';
import { finite, sortedPercentile } from './stats';
import type { Channel, ChannelSettings, Composition, Region, Stretch } from './types';

/** The viewer's image id of the quick look. */
export const QUICK_ID = 'quick';

/** Filter sets used as they are when all of them were observed (§2.3), blue first. */
const PREFERRED = [['B', 'V', 'R'], ['g', 'r', 'i']];

const STRETCH: Stretch = { type: 'asinh', strength: 100 };

/** Percentile of each frame shown fully bright: the brightest stars saturate, as in a quick snapshot. */
const WHITE_PERCENTILE = 99.9;

export interface QuickLook {
  frames: Record<Channel, Frame>;
  composition: Composition;
}

/** The blue, green and red filters: a preferred set, else the shortest, middle and longest wavelength. */
export function quickFilters(filters: string[]): Record<Channel, string> | null {
  const set = PREFERRED.find((p) => p.every((f) => filters.includes(f)));
  if (set) return { B: set[0], G: set[1], R: set[2] };
  if (filters.length < 3) return null;
  const nm = (f: string) => filterInfo(state.profile, f)?.wavelengthNm ?? Infinity;
  const s = [...filters].sort((a, b) => nm(a) - nm(b) || a.localeCompare(b));
  return { B: s[0], G: s[Math.floor((s.length - 1) / 2)], R: s[s.length - 1] };
}

/** One frame per filter, taken as close together in time as possible. */
function closestFrames(filters: Record<Channel, string>): Record<Channel, Frame> | null {
  const time = (f: Frame) => Date.parse(f.meta.dateObs) || 0;
  const byFilter = CHANNELS.map((ch) => state.framesOf('light', filters[ch]).slice().sort((a, b) => time(a) - time(b)));
  if (byFilter.some((l) => !l.length)) return null;
  let best: Frame[] | null = null;
  let spread = Infinity;
  for (const anchor of byFilter.flat()) {
    const t = time(anchor);
    const pick = byFilter.map((l) => l.reduce((a, b) => (Math.abs(time(b) - t) < Math.abs(time(a) - t) ? b : a)));
    const ts = pick.map(time);
    const s = Math.max(...ts) - Math.min(...ts);
    if (s < spread) [best, spread] = [pick, s];
  }
  return best && { R: best[0], G: best[1], B: best[2] };
}

const channelCache = new WeakMap<Float32Array, ChannelSettings>();

/** Automatic settings: the white point at a high percentile, and a neutral 10 % grey sky. */
function autoChannel(f: Frame): ChannelSettings {
  let c = channelCache.get(f.image.data);
  if (!c) {
    const b = background(f.image);
    const white = Math.max(sortedPercentile(finite(f.image.data).sort(), WHITE_PERCENTILE), b.median + 10 * b.noise);
    c = { filter: f.meta.filter, black: b.min, white, weight: 1 };
    c.black = autoBlack(f.image, c, STRETCH);
    channelCache.set(f.image.data, c);
  }
  return { ...c };
}

/** The quick look of the given frames (e.g. from a report item), if they are still loaded. */
export function quickLookOf(ids: Record<Channel, string>): QuickLook | null {
  const frames = { R: state.frame(ids.R), G: state.frame(ids.G), B: state.frame(ids.B) };
  if (!frames.R || !frames.G || !frames.B) return null;
  const f = frames as Record<Channel, Frame>;
  return {
    frames: f,
    composition: {
      id: QUICK_ID,
      name: '',
      channels: { R: autoChannel(f.R), G: autoChannel(f.G), B: autoChannel(f.B) },
      stretch: STRETCH,
    },
  };
}

/** The frames of the quick look, if the included lights have at least three filters. Cheap: no settings. */
export function quickLookFrames(): Record<Channel, Frame> | null {
  const filters = quickFilters(state.filtersOf('light'));
  return filters && closestFrames(filters);
}

/** The quick look of the included lights, with its settings. */
export function quickLook(): QuickLook | null {
  const frames = quickLookFrames();
  return frames && quickLookOf({ R: frames.R.meta.id, G: frames.G.meta.id, B: frames.B.meta.id });
}

/** Renders a quick look, optionally cropped to a region of the raw frames. */
export function renderQuickLook(q: QuickLook, region: Region | null = null): ColorImage | null {
  // The channels may share a filter name only if they share the frame, so look frames up by channel
  const byFilter = new Map(CHANNELS.map((ch) => [q.frames[ch].meta.filter, q.frames[ch].image]));
  const img = render(q.composition, (f) => byFilter.get(f));
  return img && region ? cropColor(img, region) : img;
}

/** Where the stacks lie in the raw frames: the trim region, then the area all aligned frames share. */
export function stackRegion(): Region | null {
  const crop = state.alignCrop;
  if (!crop) return null;
  const o = trimOffset();
  return { x0: crop.x0 + o.x, x1: crop.x1 + o.x, y0: crop.y0 + o.y, y1: crop.y1 + o.y };
}

function cropColor(img: ColorImage, r: Region): ColorImage | null {
  if (r.x0 < 0 || r.y0 < 0 || r.x1 >= img.width || r.y1 >= img.height) return null;
  const width = r.x1 - r.x0 + 1;
  const height = r.y1 - r.y0 + 1;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const src = ((y + r.y0) * img.width + r.x0) * 4;
    rgba.set(img.rgba.subarray(src, src + width * 4), y * width * 4);
  }
  return { width, height, rgba };
}
