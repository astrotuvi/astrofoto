// Task definitions and how answers are checked. Texts and hints are in src/content/*/tasks/.

import { getLang } from '../i18n';
import { state } from '../state';
import type { StepId } from '../types';
import { MeasureContext } from './context';

export type Requirement = 'pixelScale' | 'overscan' | 'bias' | 'darks' | 'flats';

export interface TaskPart {
  id: string;
  label: { et: string; en: string };
  type: 'number' | 'text' | 'keyword' | 'choice';
  unit?: string;
  /** Expected value; undefined when it cannot be computed yet (e.g. no master frame). */
  expected?: (ctx: MeasureContext) => number | number[] | undefined;
  /** An answer is right when it is within rel·|expected| or abs of an expected value. */
  tolerance?: { rel?: number; abs?: number };
  /** For keyword parts: is this keyword right? */
  check?: (value: string, ctx: MeasureContext) => boolean;
  /** For choice parts: the options, and the id of the right one. */
  options?: { id: string; label: { et: string; en: string } }[];
  correct?: string;
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
  {
    id: 'calibrate-background',
    step: 'calibrate',
    params: (c) => ({ file: c.calibrationLight?.meta.fileName ?? '' }),
    parts: [
      { id: 'drop', label: { et: 'Taust vähenes', en: 'The background dropped by' }, type: 'number', unit: 'ADU', expected: (c) => c.backgroundDrop, tolerance: { rel: 0.06, abs: 20 } },
      { id: 'why', label: { et: 'Miks just nii palju?', en: 'Why by this much?' }, type: 'text' },
    ],
  },
  {
    id: 'no-flat',
    step: 'calibrate',
    requires: ['flats'],
    parts: [
      { id: 'observation', label: { et: 'Mida märkasid?', en: 'What did you notice?' }, type: 'text' },
    ],
  },
  {
    id: 'align-shift',
    step: 'align',
    requires: ['pixelScale'],
    params: (c) => ({ first: c.firstLast?.first.meta.fileName ?? '', last: c.firstLast?.last.meta.fileName ?? '' }),
    parts: [
      { id: 'px', label: { et: 'Nihe', en: 'Shift' }, type: 'number', unit: 'px', expected: (c) => c.firstLastShift, tolerance: { rel: 0.15, abs: 0.4 } },
      {
        id: 'arcsec', label: { et: 'Nihe nurgasekundites', en: 'Shift in arcseconds' }, type: 'number', unit: '″',
        expected: (c) => (c.pixelScale ? c.firstLastShift.map((s) => s * c.pixelScale!) : undefined), tolerance: { rel: 0.15, abs: 0.2 },
      },
      { id: 'cause', label: { et: 'Mis võis nihke põhjustada?', en: 'What could have caused the shift?' }, type: 'text' },
    ],
  },
  {
    id: 'stack-cosmic',
    step: 'stack',
    parts: [
      { id: 'where', label: { et: 'Kus see on? (kaader, x ja y)', en: 'Where is it? (frame, x and y)' }, type: 'text' },
      {
        id: 'method', label: { et: 'Milline liitmise viis selle eemaldab?', en: 'Which stacking method removes it?' }, type: 'choice',
        options: [
          { id: 'mean', label: { et: 'keskmine', en: 'mean' } },
          { id: 'median', label: { et: 'mediaan', en: 'median' } },
          { id: 'both', label: { et: 'mõlemad', en: 'both' } },
        ],
        correct: 'median',
      },
      { id: 'why', label: { et: 'Miks?', en: 'Why?' }, type: 'text' },
    ],
  },
  {
    id: 'color-mapping',
    step: 'color',
    parts: [
      {
        id: 'channel', label: { et: 'Lühima lainepikkusega filter läheb kanalisse', en: 'The filter with the shortest wavelength goes into the channel' }, type: 'choice',
        options: [
          { id: 'R', label: { et: 'punane', en: 'red' } },
          { id: 'G', label: { et: 'roheline', en: 'green' } },
          { id: 'B', label: { et: 'sinine', en: 'blue' } },
        ],
        correct: 'B',
      },
      { id: 'why', label: { et: 'Miks?', en: 'Why?' }, type: 'text' },
    ],
  },
  {
    id: 'color-compare',
    step: 'color',
    params: (c) => c.colorFilters,
    parts: [
      { id: 'stars', label: { et: 'Kumb täht on sinises filtris suhteliselt heledam ja mida see ütleb temperatuuri kohta?', en: 'Which star is relatively brighter in the blue filter, and what does it tell about the temperature?' }, type: 'text' },
      { id: 'sets', label: { et: 'Miks erinevad kahe filtrikomplekti värvipildid?', en: 'Why do the colour images of two filter sets differ?' }, type: 'text' },
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
  if (part.type === 'choice') return value === part.correct ? 'correct' : 'wrong';
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

/** All number/keyword parts right and all text parts answered. */
export function isSolved(task: Task): boolean {
  return task.parts.every((p) => {
    const a = state.answers[`${task.id}.${p.id}`];
    return p.type === 'text' ? !!a?.value.trim() : !!a?.correct;
  });
}
