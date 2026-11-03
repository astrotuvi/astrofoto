// Colour images: stacked filter images mapped to the red, green and blue channels, with black and
// white points, weights and a stretch. See docs/DESIGN.md §3.4.

import { backgroundNoise } from './align';
import type { FitsImage } from './fits';
import { filterInfo } from './instrument/profile';
import { finite } from './stats';
import type { Channel, ChannelSettings, Composition, InstrumentProfile, Stretch } from './types';

/** Channels in display order. */
export const CHANNELS: Channel[] = ['R', 'G', 'B'];

export const DEFAULT_STRENGTH = 100;

/** Stretched display level 0–1 of a value already scaled so that black = 0 and white = 1. */
export function stretchValue(x: number, s: Stretch): number {
  if (!(x > 0)) return 0; // also NaN
  const y = s.type === 'asinh' ? Math.asinh(s.strength * x) / Math.asinh(s.strength) : x;
  return y > 1 ? 1 : y;
}

/** Display level 0–1 of a stack value in a channel: weight · (v − black) / (white − black), stretched. */
export function channelLevel(v: number, c: ChannelSettings, s: Stretch): number {
  return stretchValue((c.weight * (v - c.black)) / (c.white - c.black || 1), s);
}

export interface Background {
  /** Median of the image, i.e. the sky background. */
  median: number;
  /** Noise of the background (from the median absolute deviation). */
  noise: number;
  min: number;
  max: number;
}

const bgCache = new WeakMap<Float32Array, Background>();

export function background(img: FitsImage): Background {
  let b = bgCache.get(img.data);
  if (!b) {
    const { bg, sigma } = backgroundNoise(img);
    const v = finite(img.data);
    let min = Infinity;
    let max = -Infinity;
    for (const x of v) {
      if (x < min) min = x;
      if (x > max) max = x;
    }
    b = { median: bg, noise: sigma, min, max };
    bgCache.set(img.data, b);
  }
  return b;
}

/** Display level 0–1 of the sky background after "Auto": dark grey, so the faint sky noise stays visible. */
export const SKY_LEVEL = 0.1;

/** The black point that shows the sky at `level` with the channel's white point, weight and stretch; null if none does. */
function blackForLevel(img: FitsImage, c: ChannelSettings, s: Stretch, level: number): number | null {
  const m = background(img).median;
  // The scaled value x that the stretch shows at `level`, then black from weight·(m − black)/(white − black) = x
  const x = s.type === 'asinh' ? Math.sinh(level * Math.asinh(s.strength)) / s.strength : level;
  const k = x / c.weight;
  if (!(k > 0) || k >= 1 || !(c.white > m)) return null;
  return (m - k * c.white) / (1 - k);
}

/**
 * The "Neutral sky" black point: just below the background median, so that the sky is shown at
 * `level` in every channel, whatever its white point and weight.
 */
export function autoBlack(img: FitsImage, c: ChannelSettings, s: Stretch, level = SKY_LEVEL): number {
  return blackForLevel(img, c, s, level) ?? background(img).median;
}

/**
 * The black point for new settings `after` (white point, weight, stretch) that keeps the sky as
 * bright as it was with `before`. So the white point and weight change only the object, and the
 * sky stays where the student put it. A sky shown fully black or white keeps its black point.
 */
export function keepSky(img: FitsImage, before: ChannelSettings, sBefore: Stretch, after: ChannelSettings, sAfter: Stretch): number {
  const level = channelLevel(background(img).median, before, sBefore);
  if (!(level > 0 && level < 1)) return after.black;
  return blackForLevel(img, after, sAfter, level) ?? after.black;
}

/**
 * Settings for a newly chosen filter: the full range of the image, from its faintest to its
 * brightest pixel. On a linear scale the image then looks nearly black, which shows why a
 * stretch is needed (§4.2).
 */
export function initialChannel(filter: string | null, img: FitsImage | undefined): ChannelSettings {
  if (!filter || !img) return { filter, black: 0, white: 1, weight: 1 };
  const b = background(img);
  return { filter, black: b.min, white: b.max, weight: 1 };
}

export function newComposition(id: string): Composition {
  const empty = (): ChannelSettings => ({ filter: null, black: 0, white: 1, weight: 1 });
  return { id, name: '', channels: { R: empty(), G: empty(), B: empty() }, stretch: { type: 'linear', strength: DEFAULT_STRENGTH } };
}

/** E.g. "BVR" or "OIII·Ha·SII": the filters of the blue, green and red channels. */
export function compositionName(c: Composition): string {
  const f = (['B', 'G', 'R'] as Channel[]).map((ch) => c.channels[ch].filter ?? '–');
  return f.every((x) => x.length === 1) ? f.join('') : f.join('·');
}

export interface ColorImage {
  width: number;
  height: number;
  /** RGBA bytes in file row order. */
  rgba: Uint8ClampedArray;
}

/**
 * Renders a composition. `images` gives the stack of each filter; channels without a filter or
 * stack stay dark. Returns null when no channel has an image.
 */
export function render(c: Composition, images: (filter: string) => FitsImage | undefined): ColorImage | null {
  const chans = CHANNELS.map((ch) => {
    const s = c.channels[ch];
    return { s, img: s.filter === null ? undefined : images(s.filter) };
  });
  const first = chans.find((x) => x.img)?.img;
  if (!first) return null;
  const { width, height } = first;
  const n = width * height;
  const rgba = new Uint8ClampedArray(n * 4);
  for (let k = 0; k < 3; k++) {
    const { s, img } = chans[k];
    if (!img || img.width !== width || img.height !== height) continue;
    const d = img.data;
    // Same formula as channelLevel, inlined for speed
    const scale = s.weight / (s.white - s.black || 1);
    const asinh = c.stretch.type === 'asinh';
    const st = c.stretch.strength;
    const norm = 255 / (asinh ? Math.asinh(st) : 1);
    for (let i = 0; i < n; i++) {
      const x = (d[i] - s.black) * scale;
      if (!(x > 0)) continue;
      rgba[i * 4 + k] = (asinh ? Math.asinh(st * x) : x) * norm;
    }
  }
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  return { width, height, rgba };
}

/** Background brightness of each channel on the 0–255 scale; equal values mean a neutral grey sky. */
export function backgroundLevels(c: Composition, images: (filter: string) => FitsImage | undefined): Partial<Record<Channel, number>> {
  const out: Partial<Record<Channel, number>> = {};
  for (const ch of CHANNELS) {
    const s = c.channels[ch];
    const img = s.filter === null ? undefined : images(s.filter);
    if (img) out[ch] = Math.round(channelLevel(background(img).median, s, c.stretch) * 255);
  }
  return out;
}

export type Order = 'ordered' | 'reversed' | 'mixed' | 'unknown' | 'incomplete';

/**
 * Whether the filters go from short (blue) to long (red) wavelength, as the eye sees colours.
 * The same filter in two channels counts as in order (e.g. two-filter images).
 */
export function wavelengthOrder(c: Composition, profile: InstrumentProfile | null): Order {
  const f = (['B', 'G', 'R'] as Channel[]).map((ch) => c.channels[ch].filter);
  if (f.some((x) => x === null)) return 'incomplete';
  const nm = f.map((x) => (profile ? filterInfo(profile, x!)?.wavelengthNm : undefined));
  if (nm.some((x) => x === undefined)) return 'unknown';
  const [b, g, r] = nm as number[];
  if (b <= g && g <= r) return 'ordered';
  if (b >= g && g >= r) return 'reversed';
  return 'mixed';
}
