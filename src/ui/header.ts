// FITS header viewer with explanations for the important keywords.

import { h } from '../dom';
import type { HeaderCard } from '../fits';
import { type Key, t } from '../i18n';
import { et } from '../i18n/et';
import { keywordsFor } from '../instrument/profile';
import type { InstrumentProfile } from '../types';

function keywordTip(key: string): string | undefined {
  const k = `kw.${key}`;
  return k in et ? t(k as Key) : undefined;
}

function displayValue(c: HeaderCard): string {
  if (c.value === undefined) return '';
  if (typeof c.value === 'boolean') return c.value ? 'T' : 'F';
  if (typeof c.value === 'string') return `'${c.value}'`;
  return String(c.value);
}

export function renderHeader(cards: HeaderCard[], profile: InstrumentProfile | null, filter: string, onFilter: (s: string) => void): HTMLElement {
  const used = new Set<string>();
  if (profile) {
    for (const c of ['kind', 'filter', 'exposure', 'temperature', 'xbin', 'ybin', 'date'] as const) {
      for (const k of keywordsFor(profile, c)) used.add(k);
    }
  }
  const rows = cards.map((c) => {
    const tip = keywordTip(c.key);
    const row = h('tr', { class: used.has(c.key) ? 'used' : '' },
      h('th', { scope: 'row' }, tip ? h('span', { class: 'term', title: tip }, c.key) : c.key),
      h('td', { class: 'value' }, displayValue(c)),
      h('td', { class: 'comment' }, c.comment ?? ''),
    );
    return { row, text: `${c.key} ${displayValue(c)} ${c.comment ?? ''}`.toUpperCase() };
  });
  const apply = (q: string) => {
    const query = q.trim().toUpperCase();
    for (const r of rows) r.row.hidden = !!query && !r.text.includes(query);
  };
  apply(filter);

  const search = h('input', {
    type: 'search',
    placeholder: t('header.search'),
    value: filter,
    'aria-label': t('header.search'),
    oninput: (e: Event) => {
      const q = (e.target as HTMLInputElement).value;
      apply(q);
      onFilter(q);
    },
  });
  return h('div', { class: 'tool-out header-view' },
    h('p', { class: 'hint' }, t('header.hint')),
    search,
    h('div', { class: 'scroll' },
      h('table', { class: 'header-table' },
        h('thead', {}, h('tr', {}, h('th', {}, t('header.key')), h('th', {}, t('header.value')), h('th', {}, t('header.comment')))),
        h('tbody', {}, rows.map((r) => r.row)))),
  );
}
