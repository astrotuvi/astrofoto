// Histogram of the whole image or the selected box.

import { h } from '../dom';
import { fmtSig, t } from '../i18n';
import { histogram, sortedPercentile, values } from '../stats';
import type { Region } from '../types';
import { createPlotCanvas, drawPlot } from './plot';

export interface HistogramInput {
  data: Float32Array;
  width: number;
  box: Region | null;
  useBox: boolean;
  log: boolean;
  /** 'full' = min to max; 'clipped' = 0.1 % to 99.9 %. */
  range: 'full' | 'clipped';
  black: number;
  white: number;
}

export interface HistogramChange {
  useBox?: boolean;
  log?: boolean;
  range?: 'full' | 'clipped';
}

const BINS = 256;

function toggle(label: string, on: boolean, onclick: () => void): HTMLButtonElement {
  return h('button', { type: 'button', class: on ? 'active' : '', 'aria-pressed': String(on), onclick }, label);
}

export interface HistogramData {
  xs: number[];
  counts: Uint32Array;
  binWidth: number;
}

/** The bins of the whole image or the box. */
export function histogramData(data: Float32Array, width: number, box: Region | null, range: 'full' | 'clipped'): HistogramData {
  const v = values(data, width, box ?? undefined).sort();
  const lo = range === 'full' ? v[0] : sortedPercentile(v, 0.1);
  let hi = range === 'full' ? v[v.length - 1] : sortedPercentile(v, 99.9);
  if (!(hi > lo)) hi = lo + 1;
  // Whole-number bins for integer data, so no bin is empty only because of rounding
  const integer = v.every(Number.isInteger);
  const binWidth = integer ? Math.max(1, Math.ceil((hi - lo) / BINS)) : (hi - lo) / BINS;
  const bins = integer ? Math.max(1, Math.ceil((hi - lo + 1) / binWidth)) : BINS;
  const counts = histogram(v, lo, lo + bins * binWidth, bins).counts;
  return { xs: Array.from(counts, (_, i) => lo + i * binWidth), counts, binWidth };
}

/** Black and white markers drawn on a histogram. */
export function rangeMarkers(black: number, white: number): { x: number; color: string }[] {
  return [{ x: black, color: '#2e7d32' }, { x: white, color: '#c62828' }];
}

export function renderHistogram(input: HistogramInput, change: (c: HistogramChange) => void, extra?: HTMLElement): HTMLElement {
  const useBox = input.useBox && !!input.box;
  const { xs, counts, binWidth } = histogramData(input.data, input.width, useBox ? input.box : null, input.range);

  const canvas = createPlotCanvas();
  const out = h('div', { class: 'tool-out' },
    h('div', { class: 'toolbar' },
      h('div', { class: 'segmented', role: 'group' },
        toggle(t('hist.whole'), !useBox, () => change({ useBox: false })),
        toggle(t('hist.box'), useBox, () => change({ useBox: true })),
      ),
      h('div', { class: 'segmented', role: 'group' },
        toggle(t('hist.linear'), !input.log, () => change({ log: false })),
        toggle(t('hist.log'), input.log, () => change({ log: true })),
      ),
      h('div', { class: 'segmented', role: 'group' },
        toggle(t('hist.full'), input.range === 'full', () => change({ range: 'full' })),
        toggle(t('hist.clipped'), input.range === 'clipped', () => change({ range: 'clipped' })),
      ),
    ),
    !input.box && input.useBox ? h('p', { class: 'hint' }, t('hist.noBox')) : null,
    canvas,
    h('p', { class: 'hint' }, t('hist.legend', { bin: fmtSig(binWidth, 3) })),
    extra,
  );
  requestAnimationFrame(() =>
    drawPlot(canvas, xs, counts, {
      xLabel: t('axis.adu'),
      yLabel: t('axis.count'),
      style: 'steps',
      logY: input.log,
      markers: rangeMarkers(input.black, input.white),
    }));
  return out;
}
