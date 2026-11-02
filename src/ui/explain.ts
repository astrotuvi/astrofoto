// "Miks?" panel with an optional "Uuri lähemalt" section. See docs/DESIGN.md §4.2.

import { stepContent } from '../content';
import { h } from '../dom';
import { t } from '../i18n';

const STORAGE_KEY = 'astrofoto.whyClosed';
const closed = new Set<string>(load());

function load(): string[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...closed]));
  } catch {
    // not saved; the panel just opens again next time
  }
}

function html(content: string): HTMLDivElement {
  const div = h('div', { class: 'md' });
  div.innerHTML = content; // bundled Markdown written by us
  return div;
}

/** Open the first time; once the student closes it, it stays closed. */
export function renderWhy(id: string, params?: Record<string, string>): HTMLElement {
  const { why, more } = stepContent(id, params);
  const details = h('details', { class: 'why', open: !closed.has(id) },
    h('summary', {}, t('why.title')),
    html(why),
    more ? h('details', { class: 'more' }, h('summary', {}, t('why.more')), html(more)) : null,
  );
  details.addEventListener('toggle', () => {
    if (details.open) closed.delete(id);
    else closed.add(id);
    save();
  });
  return details;
}
