// Explanations and task texts, written as Markdown files per language. See docs/DESIGN.md §4.2, §4.5.
//
// Step files: the "Miks?" text, then optionally a line `<!-- more -->` and the "Uuri lähemalt" text.
// Task files: `# Title`, the task text, then each hint level after a line `<!-- hint -->`.
// `{name}` placeholders are filled from the data (e.g. a filter name).

import { marked } from 'marked';
import { getLang } from '../i18n';

const files = import.meta.glob('./*/*/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

function source(kind: 'steps' | 'tasks', id: string): string {
  return files[`./${getLang()}/${kind}/${id}.md`] ?? files[`./et/${kind}/${id}.md`] ?? '';
}

function fill(text: string, params: Record<string, string> = {}): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => params[k] ?? m);
}

export function md(text: string): string {
  return marked.parse(text, { async: false });
}

export function stepContent(id: string, params?: Record<string, string>): { why: string; more: string | null } {
  const [why, more] = fill(source('steps', id), params).split(/^<!-- more -->$/m);
  return { why: md(why), more: more?.trim() ? md(more) : null };
}

export interface TaskText {
  title: string;
  body: string;
  hints: string[];
}

export function taskContent(id: string, params?: Record<string, string>): TaskText {
  const [main, ...hints] = fill(source('tasks', id), params).split(/^<!-- hint -->$/m);
  const m = /^#\s+(.+)$/m.exec(main);
  return {
    title: m ? m[1].trim() : id,
    body: md(m ? main.replace(m[0], '') : main),
    hints: hints.map((h) => md(h)),
  };
}

/** True when a content file exists in at least one language (used by tests). */
export function hasContent(kind: 'steps' | 'tasks', id: string, lang: 'et' | 'en'): boolean {
  return `./${lang}/${kind}/${id}.md` in files;
}
