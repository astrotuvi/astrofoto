import { describe, expect, it } from 'vitest';
import { hasContent, taskContent } from '../src/content';
import { checkPart, parseNumber, TASKS, type TaskPart } from '../src/tasks';
import type { MeasureContext } from '../src/tasks/context';

const ctx = {} as MeasureContext;
const part = (expected: number | number[], tolerance: TaskPart['tolerance']): TaskPart =>
  ({ id: 'p', label: { et: '', en: '' }, type: 'number', expected: () => expected, tolerance });

describe('tasks', () => {
  it('reads numbers with a decimal comma, spaces and units', () => {
    expect(parseNumber('0,45')).toBe(0.45);
    expect(parseNumber('1 454 ADU')).toBe(1454);
    expect(parseNumber('−3.5')).toBe(-3.5);
    expect(parseNumber('2e-3')).toBe(0.002);
    expect(parseNumber('abc')).toBeNaN();
  });

  it('checks answers within the tolerance', () => {
    const p = part(0.4469, { rel: 0.03 });
    expect(checkPart(p, '0,45', ctx)).toBe('correct');
    expect(checkPart(p, '0.5', ctx)).toBe('wrong');
    expect(checkPart(p, 'x', ctx)).toBe('invalid');
    expect(checkPart(p, '', ctx)).toBe('empty');
    expect(checkPart(part(5, { abs: 1 }), '4', ctx)).toBe('correct');
    expect(checkPart(part([3.81, 3.9], { rel: 0.01 }), '3.9', ctx)).toBe('correct');
    expect(checkPart({ ...part(0, {}), expected: () => undefined }, '1', ctx)).toBe('unavailable');
  });

  it('checks a choice', () => {
    const choice: TaskPart = { id: 'c', label: { et: '', en: '' }, type: 'choice', options: [], correct: 'median' };
    expect(checkPart(choice, 'median', ctx)).toBe('correct');
    expect(checkPart(choice, 'mean', ctx)).toBe('wrong');
    expect(checkPart(choice, '', ctx)).toBe('empty');
  });

  it('has a text with hints for every task in both languages', () => {
    for (const task of TASKS) {
      for (const lang of ['et', 'en'] as const) expect(hasContent('tasks', task.id, lang), `${lang}/${task.id}`).toBe(true);
      const text = taskContent(task.id);
      expect(text.title).not.toBe(task.id);
      expect(text.hints).toHaveLength(3);
    }
  });

  it('has explanations for each step in both languages', () => {
    for (const id of ['trim', 'bias', 'dark', 'flat', 'calibrate', 'align', 'stack']) {
      for (const lang of ['et', 'en'] as const) expect(hasContent('steps', id, lang), `${lang}/${id}`).toBe(true);
    }
  });
});
