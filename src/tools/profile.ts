// Row/column profile: pixel values along one row or column.

import { h } from '../dom';
import { t } from '../i18n';
import type { ProfileAxis } from '../viewer';
import { createPlotCanvas, drawPlot } from './plot';

export interface ProfileInput {
  data: Float32Array;
  width: number;
  height: number;
  axis: ProfileAxis;
  index: number | null;
}

/** Values along a row (y fixed) or column (x fixed), 0-based index. */
export function profileValues(data: Float32Array, width: number, height: number, axis: ProfileAxis, index: number): Float32Array {
  if (axis === 'row') return data.slice(index * width, (index + 1) * width);
  const out = new Float32Array(height);
  for (let y = 0; y < height; y++) out[y] = data[y * width + index];
  return out;
}

export function renderProfile(input: ProfileInput, onAxis: (axis: ProfileAxis) => void): HTMLElement {
  const axisSelect = h('div', { class: 'segmented', role: 'group' },
    (['row', 'column'] as ProfileAxis[]).map((a) =>
      h('button', {
        type: 'button',
        class: a === input.axis ? 'active' : '',
        'aria-pressed': String(a === input.axis),
        onclick: () => onAxis(a),
      }, t(a === 'row' ? 'profile.row' : 'profile.column'))),
  );
  if (input.index === null) {
    return h('div', { class: 'tool-out' }, axisSelect, h('p', { class: 'hint' }, t(input.axis === 'row' ? 'profile.hintRow' : 'profile.hintColumn')));
  }
  const ys = profileValues(input.data, input.width, input.height, input.axis, input.index);
  const xs = Array.from(ys, (_, i) => i + 1);
  const canvas = createPlotCanvas();
  const title = t(input.axis === 'row' ? 'profile.titleRow' : 'profile.titleColumn', { n: String(input.index + 1) });
  const out = h('div', { class: 'tool-out' }, axisSelect, h('p', { class: 'plot-title' }, title), canvas);
  requestAnimationFrame(() =>
    drawPlot(canvas, xs, ys, {
      xLabel: input.axis === 'row' ? t('axis.x') : t('axis.y'),
      yLabel: t('axis.adu'),
      style: 'line',
      integerX: true,
    }));
  return out;
}
