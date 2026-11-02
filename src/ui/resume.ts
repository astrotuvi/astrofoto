// "Kus ma pooleli jäin" – where I left off: shown when a project is opened. See docs/DESIGN.md §6.5.

import { taskContent } from '../content';
import { h } from '../dom';
import { fmt, getLang, type Key, t } from '../i18n';
import { term, type TermId } from '../i18n/glossary';
import { formatCommentDate } from './comments';
import { state } from '../state';
import { isSolved, TASKS, unmet } from '../tasks';
import { MeasureContext } from '../tasks/context';
import type { StepId } from '../types';

export type Target = { step: 'files' } | { step: 'calibration'; sub: CalSub } | { step: 'align'; sub: AlignSub }
  | { step: 'color'; sub: ColorSub };
export type CalSub = 'trim' | 'bias' | 'dark' | 'flat' | 'apply';
export type AlignSub = 'manual' | 'auto' | 'stack';
export type ColorSub = 'compose' | 'export';

/** Work steps in order, with where each one is opened. */
const WORK: { id: StepId; label: Key; target: Target }[] = [
  { id: 'files', label: 'step.files', target: { step: 'files' } },
  { id: 'trim', label: 'cal.trim', target: { step: 'calibration', sub: 'trim' } },
  { id: 'bias', label: 'cal.bias', target: { step: 'calibration', sub: 'bias' } },
  { id: 'dark', label: 'cal.dark', target: { step: 'calibration', sub: 'dark' } },
  { id: 'flat', label: 'cal.flat', target: { step: 'calibration', sub: 'flat' } },
  { id: 'calibrate', label: 'cal.apply', target: { step: 'calibration', sub: 'apply' } },
  { id: 'align', label: 'align.step', target: { step: 'align', sub: 'manual' } },
  { id: 'stack', label: 'align.stack', target: { step: 'align', sub: 'stack' } },
  { id: 'color', label: 'step.color', target: { step: 'color', sub: 'compose' } },
];

function stepDone(id: StepId): boolean {
  return id === 'files' ? state.frames.length > 0 : state.isDone(id);
}

function targetFor(step: StepId): Target {
  return WORK.find((w) => w.id === step)?.target ?? { step: 'files' };
}

function formatDate(iso: string | undefined): string {
  if (!iso) return '–';
  return new Date(iso).toLocaleString(getLang() === 'et' ? 'et-EE' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Text of a log entry in the current language. Entries store codes, not text:
 * kind → glossary term, method → method name, what → string key, on → on/off.
 */
export function logText(code: string, params: Record<string, string | number>): string {
  const p: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) p[k] = typeof v === 'number' ? fmt(v, 2) : v;
  if (typeof params.kind === 'string') p.kind = term(params.kind as TermId);
  if (typeof params.method === 'string') p.method = t(`method.${params.method}` as Key).toLowerCase();
  if (typeof params.what === 'string') p.what = t(params.what as Key);
  if (typeof params.on === 'string') p.on = t(params.on === 'on' ? 'log.on' : 'log.off');
  if (code === 'calibrated') {
    p.parts = (['bias', 'dark', 'flat'] as const).filter((k) => params[k] === 'true').map((k) => term(k)).join(', ') || '–';
  }
  return t(`log.${code}` as Key, p);
}

export function renderResume(go: (target: Target) => void, warning?: string): HTMLElement {
  const ctx = new MeasureContext();
  const next = WORK.find((w) => !stepDone(w.id));
  const tasks = TASKS.filter((task) => !unmet(task, ctx));
  const open = tasks.filter((task) => !isSolved(task));
  // Mentor comments, newest first, with where they were written
  const comments = Object.entries(state.comments).flatMap(([key, list]) => {
    const [kind, id] = key.split(':');
    const task = kind === 'task' ? TASKS.find((x) => x.id === id) : undefined;
    const where = task ? taskContent(task.id, task.params?.(ctx)).title : t(WORK.find((w) => w.id === id)?.label ?? 'step.files');
    const target = targetFor(task ? task.step : id as StepId);
    return list.map((c) => ({ ...c, where, target }));
  }).sort((a, b) => b.date.localeCompare(a.date));
  const input = (key: 'title' | 'student', label: Key) =>
    h('label', { class: 'field' }, t(label),
      h('input', {
        type: 'text',
        value: state.info[key],
        placeholder: key === 'title' ? t('project.defaultTitle') : '',
        onchange: (e: Event) => state.setInfo({ [key]: (e.target as HTMLInputElement).value.trim() }),
      }));

  return h('section', { class: 'step-panel resume' }, h('div', {},
    h('h2', {}, t('resume.title')),
    warning ? h('p', { class: 'warning', role: 'alert' }, warning) : null,
    h('section', { class: 'phase' },
      h('h3', {}, t('resume.project')),
      input('title', 'resume.projectTitle'),
      input('student', 'resume.student'),
      h('p', { class: 'hint' }, t('resume.dates', { created: formatDate(state.info.created), saved: formatDate(state.info.lastSaved) }))),
    comments.length ? h('section', { class: 'phase' },
      h('h3', {}, t('resume.comments')),
      h('ul', { class: 'resume-comments' }, comments.map((c) => h('li', {},
        h('button', { type: 'button', class: 'link', onclick: () => go(c.target) }, c.where),
        ' ', h('span', { class: 'date' }, formatCommentDate(c.date)),
        h('p', { class: 'comment-text' }, c.text))))) : null,
    h('section', { class: 'phase' },
      h('h3', {}, t('resume.steps')),
      h('ol', { class: 'progress' }, WORK.map((w) => h('li', { class: stepDone(w.id) ? 'done' : '' },
        h('button', { type: 'button', class: 'link', onclick: () => go(w.target) }, t(w.label)),
        ' ', stepDone(w.id) ? '✓' : w === next ? t('resume.next') : ''))),
      next
        ? h('button', { type: 'button', class: 'primary', onclick: () => go(next.target) }, t('resume.continue', { what: t(next.label) }))
        : h('p', { class: 'ok' }, t('resume.allDone'))),
    h('section', { class: 'phase' },
      h('h3', {}, t('resume.tasks')),
      h('p', {}, t('resume.taskCount', { done: tasks.length - open.length, total: tasks.length })),
      open.length ? h('ul', {}, open.map((task) => h('li', {},
        h('button', { type: 'button', class: 'link', onclick: () => go(targetFor(task.step)) },
          taskContent(task.id, task.params?.(ctx)).title),
        ' – ', t(WORK.find((w) => w.id === task.step)?.label ?? 'step.files')))) : null),
    state.log.length ? h('section', { class: 'phase' },
      h('h3', {}, t('resume.log')),
      h('ul', { class: 'log' }, state.log.slice(-6).reverse().map((e) =>
        h('li', {}, h('span', { class: 'date' }, formatDate(e.date)), ' ', logText(e.code, e.params))))) : null,
  ));
}
