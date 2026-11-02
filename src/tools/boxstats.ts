// Statistics of a rectangle dragged on the image.

import { h } from '../dom';
import { fmt, t } from '../i18n';
import { type Stats, stats, values } from '../stats';
import type { Region } from '../types';

export function boxStats(data: Float32Array, width: number, box: Region): Stats {
  return stats(values(data, width, box));
}

export function renderBoxStats(data: Float32Array, width: number, box: Region | null): HTMLElement {
  if (!box) return h('div', { class: 'tool-out' }, h('p', { class: 'hint' }, t('box.hint')));
  const s = boxStats(data, width, box);
  const row = (label: string, tip: string, value: string) =>
    h('tr', {}, h('th', { title: tip }, h('span', { class: 'term' }, label)), h('td', { class: 'num' }, value));
  const w = box.x1 - box.x0 + 1;
  const hgt = box.y1 - box.y0 + 1;
  return h('div', { class: 'tool-out' },
    h('p', {}, t('box.region', {
      x0: String(box.x0 + 1), x1: String(box.x1 + 1), y0: String(box.y0 + 1), y1: String(box.y1 + 1),
      w: String(w), h: String(hgt),
    })),
    h('table', { class: 'stats' },
      h('tbody', {},
        row(t('stat.n'), t('stat.nTip'), fmt(s.n, 0)),
        row(t('stat.mean'), t('stat.meanTip'), fmt(s.mean, 2)),
        row(t('stat.median'), t('stat.medianTip'), fmt(s.median, 2)),
        row(t('stat.std'), t('stat.stdTip'), fmt(s.std, 2)),
        row(t('stat.min'), t('stat.minTip'), fmt(s.min, 2)),
        row(t('stat.max'), t('stat.maxTip'), fmt(s.max, 2)),
      )),
  );
}
