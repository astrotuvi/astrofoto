// Interface language, translation and number formatting. See docs/DESIGN.md §5.

import { et, type Key } from './et';
import { en } from './en';

export type Lang = 'et' | 'en';
export type { Key };

const STORAGE_KEY = 'astrofoto.lang';
const strings: Record<Lang, Record<Key, string>> = { et, en };
let lang: Lang = loadLang();
const listeners = new Set<() => void>();

function loadLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'et' || saved === 'en') return saved;
  } catch {
    // localStorage may be unavailable (file://, private mode); use the default
  }
  return 'et';
}

export function getLang(): Lang {
  return lang;
}

export function setLang(next: Lang): void {
  if (next === lang) return;
  lang = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // not saved; the choice still applies until the page is closed
  }
  // Tests run without a document
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  for (const fn of listeners) fn();
}

export function onLangChange(fn: () => void): void {
  listeners.add(fn);
}

/** Translates a key. `{name}` placeholders are replaced from `params`. */
export function t(key: Key, params?: Record<string, string | number>): string {
  let s = strings[lang][key];
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replaceAll(`{${k}}`, typeof v === 'number' ? fmt(v) : v);
    }
  }
  return s;
}

const formatters = new Map<string, Intl.NumberFormat>();

/** Formats a number for display (decimal comma in Estonian). */
export function fmt(x: number, maxDigits = 2, minDigits = 0): string {
  if (!Number.isFinite(x)) return '–';
  const id = `${lang}:${minDigits}:${maxDigits}`;
  let f = formatters.get(id);
  if (!f) {
    f = new Intl.NumberFormat(lang === 'et' ? 'et-EE' : 'en-GB', {
      minimumFractionDigits: minDigits,
      maximumFractionDigits: maxDigits,
    });
    formatters.set(id, f);
  }
  return f.format(x);
}

/** Formats a number with about `digits` significant digits, without exponent for usual ADU ranges. */
export function fmtSig(x: number, digits = 4): string {
  if (!Number.isFinite(x)) return '–';
  if (x === 0) return fmt(0);
  const decimals = Math.max(0, digits - 1 - Math.floor(Math.log10(Math.abs(x))));
  return fmt(x, Math.min(decimals, 6), Math.min(decimals, 6));
}
