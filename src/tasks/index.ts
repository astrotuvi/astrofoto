// Task definitions and how answers are checked. Texts and hints are in src/content/*/tasks/.

import { getLang } from '../i18n';
import { state } from '../state';
import type { StepId } from '../types';
import { MeasureContext } from './context';

export type Requirement = 'pixelScale' | 'overscan' | 'bias' | 'darks' | 'flats';

export interface TaskPart {
  id: string;
  label: { et: string; en: string };
  type: 'number' | 'text' | 'keyword';
  unit?: string;
  /** Expected value; undefined when it cannot be computed yet (e.g. no master frame). */
  expected?: (ctx: MeasureContext) => number | number[] | undefined;
  /** An answer is right when it is within rel·|expected| or abs of an expected value. */
  tolerance?: { rel?: number; abs?: number };
  /** For keyword parts: is this keyword right? */
  check?: (value: string, ctx: MeasureContext) => boolean;
}

export interface Task {
  id: string;
  step: StepId;
  parts: TaskPart[];
  requires?: Requirement[];
  params?: (ctx: MeasureContext) => Record<string, string>;
}

/** Hint levels per task; the last one is the full explanation. */
export const HINT_LEVELS = 3;
/** Wrong attempts before the full explanation can be opened. */
export const FULL_HINT_AFTER = 3;

function keywordPart(id: string, concept: 'kind' | 'filter' | 'exposure', et: string, en: string): TaskPart {
  return {
    id,
    label: { et, en },
    type: 'keyword',
    check: (value, ctx) => {
      const used = ctx.headerKeyword(concept);
      const key = value.trim().toUpperCase();
      const header = ctx.sampleFrame?.meta.header;
      if (!used || !header || header[key] === undefined) return false;
      // Any keyword with the same value as the one the app used is right (e.g. EXPOSURE = EXPTIME)
      return String(header[key]).trim() === String(used.value).trim();
    },
  };
}

export const TASKS: Task[] = [
  {
    id: 'header-keywords',
    step: 'files',
    parts: [
      keywordPart('kind', 'kind', 'Kaadri liik', 'Frame type'),
      keywordPart('filter', 'filter', 'Filter', 'Filter'),
      keywordPart('exposure', 'exposure', 'Säriaeg', 'Exposure time'),
    ],
  },
  {
    id: 'plate-scale',
    step: 'files',
    requires: ['pixelScale'],
    parts: [
      { id: 'scale', label: { et: 'Pikslimõõt', en: 'Pixel scale' }, type: 'number', unit: '″/px', expected: (c) => c.pixelScale, tolerance: { rel: 0.03 } },
      { id: 'fov', label: { et: 'Vaatevälja laius', en: 'Field of view (width)' }, type: 'number', unit: '′', expected: (c) => c.fieldOfView, tolerance: { rel: 0.04 } },
    ],
  },
  {
    id: 'trim-columns',
    step: 'trim',
    requires: ['overscan'],
    parts: [
      { id: 'first', label: { et: 'Esimene valgust saav veerg', en: 'First column that gets light' }, type: 'number', expected: (c) => (c.detectedTrim ? c.detectedTrim.x0 + 1 : undefined), tolerance: { abs: 1 } },
      { id: 'last', label: { et: 'Viimane valgust saav veerg', en: 'Last column that gets light' }, type: 'number', expected: (c) => (c.detectedTrim ? c.detectedTrim.x1 + 1 : undefined), tolerance: { abs: 1 } },
      { id: 'why', label: { et: 'Miks on pildil veerge, mis valgust ei saa?', en: 'Why does the image have columns that get no light?' }, type: 'text' },
    ],
  },
  {
    id: 'bias-noise',
    step: 'bias',
    requires: ['bias'],
    parts: [
      { id: 'mean', label: { et: 'Keskmine', en: 'Mean' }, type: 'number', unit: 'ADU', expected: (c) => c.singleBias?.mean, tolerance: { rel: 0.005 } },
      { id: 'std', label: { et: 'Standardhälve (müra)', en: 'Standard deviation (noise)' }, type: 'number', unit: 'ADU', expected: (c) => c.singleBias?.std, tolerance: { rel: 0.2 } },
    ],
  },
  {
    id: 'bias-master-noise',
    step: 'bias',
    requires: ['bias'],
    params: (c) => ({ n: String(c.singleBias?.n ?? '') }),
    parts: [
      {
        id: 'predict', label: { et: 'Ennustus', en: 'Prediction' }, type: 'number', unit: 'ADU',
        expected: (c) => (c.singleBias ? c.singleBias.std / Math.sqrt(c.singleBias.n) : undefined), tolerance: { rel: 0.25 },
      },
      { id: 'measured', label: { et: 'Mõõdetud koondkaadris', en: 'Measured in the master' }, type: 'number', unit: 'ADU', expected: (c) => c.masterBiasNoise, tolerance: { rel: 0.2 } },
    ],
  },
  {
    id: 'dark-current',
    step: 'dark',
    requires: ['darks'],
    parts: [
      { id: 'rate', label: { et: 'Pimevool', en: 'Dark current' }, type: 'number', unit: 'ADU/s', expected: (c) => c.darkCurrent, tolerance: { rel: 0.3, abs: 0.03 } },
      { id: 'needed', label: { et: 'Kas pimekaadrit on vaja? Mida see veel parandab?', en: 'Is a dark frame needed? What else does it fix?' }, type: 'text' },
    ],
  },
  {
    id: 'flat-corners',
    step: 'flat',
    requires: ['flats'],
    params: (c) => ({ filter: c.flatFilter }),
    parts: [
      { id: 'centre', label: { et: 'Mediaan keskel', en: 'Median in the centre' }, type: 'number', expected: (c) => c.flatCorners?.centre, tolerance: { rel: 0.02 } },
      { id: 'corner', label: { et: 'Kõige tumedam nurk on keskkohast tumedam', en: 'The darkest corner is darker than the centre by' }, type: 'number', unit: '%', expected: (c) => c.flatCorners?.darkestPercent, tolerance: { abs: 2.5 } },
    ],
  },
];

export function tasksFor(step: StepId): Task[] {
  return TASKS.filter((t) => t.step === step);
}

/** The first requirement that the data does not meet, if any. */
export function unmet(task: Task, ctx: MeasureContext): Requirement | undefined {
  return task.requires?.find((r) => {
    switch (r) {
      case 'pixelScale': return !ctx.pixelScale;
      case 'overscan': return !ctx.detectedTrim;
      case 'bias': return state.framesOf('bias').length === 0;
      case 'darks': return state.framesOf('dark').length === 0;
      case 'flats': return state.framesOf('flat').length === 0;
    }
  });
}

export type CheckResult = 'correct' | 'wrong' | 'invalid' | 'unavailable' | 'saved' | 'empty';

/** Reads a number typed by a student: decimal comma or point, spaces and a trailing unit allowed. */
export function parseNumber(s: string): number {
  const m = /^[−-]?\d[\d\s]*(?:[.,]\d*)?(?:[eE][−-]?\d+)?|^[−-]?[.,]\d+/.exec(s.trim().replace(/^\+/, ''));
  if (!m) return NaN;
  return Number(m[0].replace(/\s/g, '').replace(',', '.').replace(/−/g, '-'));
}

export function checkPart(part: TaskPart, value: string, ctx: MeasureContext): CheckResult {
  if (!value.trim()) return 'empty';
  if (part.type === 'text') return 'saved';
  if (part.type === 'keyword') return part.check?.(value, ctx) ? 'correct' : 'wrong';
  const x = parseNumber(value);
  if (!Number.isFinite(x)) return 'invalid';
  const e = part.expected?.(ctx);
  if (e === undefined || (Array.isArray(e) && e.length === 0)) return 'unavailable';
  const options = Array.isArray(e) ? e : [e];
  const ok = options.some((v) => {
    const tol = Math.max((part.tolerance?.rel ?? 0) * Math.abs(v), part.tolerance?.abs ?? 0);
    return Math.abs(x - v) <= tol;
  });
  return ok ? 'correct' : 'wrong';
}

export function partLabel(part: TaskPart): string {
  return part.label[getLang()];
}

/** Wrong attempts so far over all parts of a task. */
export function attempts(task: Task): number {
  return task.parts.reduce((s, p) => s + (state.answers[`${task.id}.${p.id}`]?.attempts ?? 0), 0);
}
