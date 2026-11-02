// Values computed from the student's own data, used to check task answers.

import { clippedMean, DEFAULT_SIGMA, trimPlane } from '../calibrate';
import { headerValue, pixelScale } from '../instrument/profile';
import { suggestedTrim } from '../masters';
import { masterId, state } from '../state';
import { median, stats, values } from '../stats';
import type { Region } from '../types';

/** A centred box of up to 100 × 100 pixels. */
export function centreBox(width: number, height: number, size = 100): Region {
  const w = Math.min(size, Math.floor(width / 2));
  const h = Math.min(size, Math.floor(height / 2));
  const x0 = Math.floor((width - w) / 2);
  const y0 = Math.floor((height - h) / 2);
  return { x0, x1: x0 + w - 1, y0, y1: y0 + h - 1 };
}

export class MeasureContext {
  private cache = new Map<string, unknown>();

  private memo<T>(key: string, fn: () => T): T {
    if (!this.cache.has(key)) this.cache.set(key, fn());
    return this.cache.get(key) as T;
  }

  /** A light frame (or any frame) whose header the header tasks are about. */
  get sampleFrame() {
    return state.framesOf('light')[0] ?? state.frames[0];
  }

  headerKeyword(concept: 'kind' | 'filter' | 'exposure') {
    const f = this.sampleFrame;
    return f && state.profile ? headerValue(f.meta.header, state.profile, concept) : undefined;
  }

  get pixelScale(): number | undefined {
    const f = this.sampleFrame;
    return f && state.profile ? pixelScale(f.meta.header, state.profile) : undefined;
  }

  get detectedTrim(): Region | null | undefined {
    return this.memo('trim', suggestedTrim);
  }

  /** Field of view in arcminutes, for the trimmed and the full width. */
  get fieldOfView(): number[] {
    const s = this.pixelScale;
    const f = this.sampleFrame;
    if (!s || !f) return [];
    const t = state.settings.trim ?? this.detectedTrim;
    const widths = [f.meta.width, t ? t.x1 - t.x0 + 1 : f.meta.width];
    return widths.map((w) => (w * s) / 60);
  }

  /** Mean and standard deviation of one bias frame, in the centre box of the exposed area. */
  get singleBias(): { mean: number; std: number; n: number } | undefined {
    return this.memo('bias1', () => {
      const frames = state.framesOf('bias');
      if (!frames.length) return undefined;
      const p = trimPlane(frames[0].image, state.settings.trim ?? this.detectedTrim ?? null);
      const s = stats(values(p.data, p.width, centreBox(p.width, p.height)));
      return { mean: s.mean, std: s.std, n: frames.length };
    });
  }

  get masterBiasNoise(): number | undefined {
    const m = state.masters.get(masterId('bias'));
    if (!m) return undefined;
    return stats(values(m.image.data, m.image.width, centreBox(m.image.width, m.image.height))).std;
  }

  /** Dark current in ADU/s: sigma-clipped mean of the master dark divided by its exposure. */
  get darkCurrent(): number | undefined {
    const m = state.masters.get(masterId('dark'));
    if (!m || !(m.exposure > 0)) return undefined;
    return clippedMean(values(m.image.data, m.image.width), DEFAULT_SIGMA) / m.exposure;
  }

  /** The light frame used in the calibration tasks. */
  get calibrationLight() {
    return state.framesOf('light')[0];
  }

  /** How much the background (median) drops from the trimmed raw light to the calibrated one. */
  get backgroundDrop(): number | undefined {
    const f = this.calibrationLight;
    const cal = f && state.calibrated.get(f.meta.id);
    if (!cal) return undefined;
    const raw = trimPlane(f.image, state.settings.trim ?? null);
    return median(raw.data) - median(cal.data);
  }

  /** The filter used in the flat task: the first one with flats. */
  get flatFilter(): string {
    return state.filtersOf('flat')[0] ?? '';
  }

  /** Median in the centre and in 32 × 32 corner boxes of the master flat. */
  get flatCorners(): { centre: number; darkestPercent: number } | undefined {
    const m = state.masters.get(masterId('flat', this.flatFilter));
    if (!m) return undefined;
    const { data, width: w, height: h } = m.image;
    const b = Math.min(32, Math.floor(Math.min(w, h) / 4));
    const centre = median(values(data, w, centreBox(w, h, 64)));
    const corners = [[0, 0], [w - b, 0], [0, h - b], [w - b, h - b]].map(([x, y]) =>
      median(values(data, w, { x0: x, x1: x + b - 1, y0: y, y1: y + b - 1 })));
    return { centre, darkestPercent: (1 - Math.min(...corners) / centre) * 100 };
  }
}
