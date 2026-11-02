// A task with answer fields, checking and hint levels. See docs/DESIGN.md §4.5.

import { taskContent } from '../content';
import { h } from '../dom';
import { fmt, getLang, type Key, t } from '../i18n';
import { isMentor } from '../mentor';
import { state } from '../state';
import { MeasureContext } from '../tasks/context';
import {
  attempts, type CheckResult, checkPart, FULL_HINT_AFTER, HINT_LEVELS, isSolved, partLabel, type Task, type TaskPart, unmet,
} from '../tasks';
import { renderComments } from './comments';

function html(content: string): HTMLDivElement {
  const div = h('div', { class: 'md' });
  div.innerHTML = content; // bundled Markdown written by us, not user input
  return div;
}

export function renderTasks(tasks: Task[]): HTMLElement | null {
  if (tasks.length === 0) return null;
  const ctx = new MeasureContext();
  return h('section', { class: 'tasks' },
    h('h3', {}, t('task.heading')),
    tasks.map((task, i) => renderTask(task, i + 1, ctx)));
}

/** The expected answer for the mentor, e.g. "0,4469 ″/px (±3 %)"; null for free text. */
export function answerKey(p: TaskPart, ctx: MeasureContext): string | null {
  if (p.type === 'text') return null;
  if (p.type === 'choice') return p.options?.find((o) => o.id === p.correct)?.label[getLang()] ?? null;
  if (p.type === 'keyword') return p.answer?.(ctx) ?? t('task.keyUnavailable');
  const e = p.expected?.(ctx);
  if (e === undefined || (Array.isArray(e) && !e.length)) return t('task.keyUnavailable');
  const values = (Array.isArray(e) ? e : [e]).map((v) => fmt(v, 4)).join(' / ');
  const tol = [
    p.tolerance?.rel ? `±${fmt(p.tolerance.rel * 100, 1)} %` : '',
    p.tolerance?.abs ? `±${fmt(p.tolerance.abs, 3)}${p.unit ? ' ' + p.unit : ''}` : '',
  ].filter(Boolean).join(t('task.keyOr'));
  return `${values}${p.unit ? ' ' + p.unit : ''}${tol ? ` (${tol})` : ''}`;
}

function renderTask(task: Task, n: number, ctx: MeasureContext): HTMLElement {
  const missing = unmet(task, ctx);
  const text = taskContent(task.id, task.params?.(ctx));
  if (missing) {
    return h('article', { class: 'task na' },
      h('h4', {}, t('task.number', { n: String(n) }), ' ', text.title),
      h('p', { class: 'hint' }, t(`task.na.${missing}` as Key)));
  }

  const results = new Map<string, HTMLElement>();
  const inputs = new Map<string, HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>();
  const allCorrect = isSolved(task);

  const parts = task.parts.map((p) => {
    const key = `${task.id}.${p.id}`;
    const saved = state.answers[key];
    const input = p.type === 'text'
      ? h('textarea', { rows: 2, value: saved?.value ?? '', 'aria-label': partLabel(p) })
      : p.type === 'choice'
        ? h('select', { 'aria-label': partLabel(p) },
            h('option', { value: '', selected: !saved?.value }, t('task.choose')),
            (p.options ?? []).map((o) => h('option', { value: o.id, selected: saved?.value === o.id }, o.label[getLang()])))
        : h('input', {
          type: 'text',
          inputmode: p.type === 'number' ? 'decimal' : 'text',
          autocapitalize: p.type === 'keyword' ? 'characters' : undefined,
          value: saved?.value ?? '',
          'aria-label': partLabel(p),
          size: 10,
        });
    inputs.set(p.id, input);
    const result = h('span', { class: 'result', 'aria-live': 'polite' });
    if (saved) showResult(result, p.type === 'text' ? (saved.value ? 'saved' : 'empty') : saved.correct ? 'correct' : 'wrong');
    results.set(p.id, result);
    const expected = isMentor() ? answerKey(p, ctx) : null;
    return h('div', { class: 'part' },
      h('label', {}, partLabel(p), p.type === 'text' ? h('br') : ' ', input, p.unit ? h('span', { class: 'unit' }, ' ', p.unit) : null),
      result,
      expected ? h('span', { class: 'answer-key' }, t('task.key', { value: expected })) : null);
  });

  const check = () => {
    for (const p of task.parts) {
      const key = `${task.id}.${p.id}`;
      const value = inputs.get(p.id)!.value;
      const r = checkPart(p, value, ctx);
      const prev = state.answers[key];
      if (r === 'correct' || r === 'wrong' || r === 'saved') {
        const changed = prev?.value !== value;
        state.answers[key] = {
          value,
          correct: r === 'saved' ? undefined : r === 'correct',
          attempts: (prev?.attempts ?? 0) + (changed && r !== 'saved' ? 1 : 0),
        };
      }
      showResult(results.get(p.id)!, r);
    }
    state.emit('answers');
    hintArea.replaceChildren(...hintButtons());
  };

  const used = () => state.hintsUsed[task.id] ?? 0;
  const hintArea = h('div', { class: 'hints' });
  const hintButtons = (): HTMLElement[] => {
    // The mentor sees all hints, without counting them as the student's
    if (isMentor()) {
      return text.hints.map((hint, i) => h('div', { class: 'hint-text' },
        h('strong', {}, t(i + 1 === HINT_LEVELS ? 'task.fullHint' : 'task.hintN', { n: String(i + 1) })), html(hint)));
    }
    const out: HTMLElement[] = [];
    for (let level = 1; level <= Math.min(used(), text.hints.length); level++) {
      out.push(h('div', { class: 'hint-text' }, h('strong', {}, t(level === HINT_LEVELS ? 'task.fullHint' : 'task.hintN', { n: String(level) })), html(text.hints[level - 1])));
    }
    const next = used() + 1;
    if (next <= Math.min(HINT_LEVELS, text.hints.length)) {
      const locked = next === HINT_LEVELS && attempts(task) < FULL_HINT_AFTER;
      out.push(h('button', {
        type: 'button',
        class: 'hint-button',
        disabled: locked,
        title: locked ? t('task.fullHintLocked', { n: String(FULL_HINT_AFTER) }) : undefined,
        onclick: () => {
          state.useHint(task.id, next);
          hintArea.replaceChildren(...hintButtons());
        },
      }, t(next === HINT_LEVELS ? 'task.showFull' : 'task.showHint', { n: String(next) })));
      if (locked) out.push(h('p', { class: 'hint' }, t('task.fullHintLocked', { n: String(FULL_HINT_AFTER) })));
    }
    return out;
  };
  hintArea.replaceChildren(...hintButtons());

  return h('article', { class: 'task' + (allCorrect ? ' solved' : '') },
    h('h4', {}, t('task.number', { n: String(n) }), ' ', text.title),
    html(text.body),
    h('form', {
      class: 'parts',
      onsubmit: (e: Event) => {
        e.preventDefault();
        check();
      },
    }, parts, h('button', { type: 'submit' }, t('task.check'))),
    isMentor() ? h('p', { class: 'mentor-info' }, t('task.studentRecord', { attempts: attempts(task), hints: used() })) : null,
    hintArea,
    renderComments(`task:${task.id}`),
  );
}

const RESULT_KEY: Record<CheckResult, Key> = {
  correct: 'task.correct',
  wrong: 'task.wrong',
  invalid: 'task.invalid',
  unavailable: 'task.unavailable',
  saved: 'task.saved',
  empty: 'task.empty',
};

function showResult(el: HTMLElement, r: CheckResult): void {
  el.className = `result ${r}`;
  el.textContent = (r === 'correct' ? '✓ ' : r === 'wrong' ? '✗ ' : '') + t(RESULT_KEY[r]);
}
