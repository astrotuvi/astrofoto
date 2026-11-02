// List of consistency check results.

import type { Check } from '../checks';
import { h } from '../dom';
import { fmt, type Key, t } from '../i18n';

export function renderChecks(list: Check[]): HTMLElement {
  return h('ul', { class: 'checks' }, list.map((c) => {
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(c.params)) params[k] = typeof v === 'number' ? fmt(v, 2) : v;
    return h('li', { class: c.level }, t(`check.${c.code}` as Key, params));
  }));
}
