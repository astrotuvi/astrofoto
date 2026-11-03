// Builds the report document from the project (§4.6): the automatic sections from the student's
// data, decisions and answers, and the figures and measurements the student added.

import { compositionName } from '../color';
import { taskContent } from '../content';
import { fmt, getLang, type Key, t } from '../i18n';
import { term } from '../i18n/glossary';
import { darkScale } from '../masters';
import { projectTitle } from '../project';
import { quickLook } from '../quicklook';
import { referenceFrame } from '../stack';
import { masterId, state } from '../state';
import { stats, values } from '../stats';
import { partLabel, TASKS, unmet } from '../tasks';
import { MeasureContext } from '../tasks/context';
import { statDigits } from '../tools/boxstats';
import { type Composition, KINDS, type Region, type ReportItem, type ReportSectionId, type ReportSnapshot } from '../types';
import { differenceText, imageTitle } from '../ui/compare';
import { formatCommentDate } from '../ui/comments';
import { computeVersion, differences, isFresh } from '../versions';
import { type Block, type FigureSnapshot, type ReportDoc, type Run, type Section, slug } from './model';

export const SECTIONS: ReportSectionId[] = ['title', 'data', 'processing', 'items', 'tasks', 'colour', 'mentorComments'];

export function sectionOn(id: ReportSectionId): boolean {
  return state.report.sections[id] ?? id !== 'mentorComments';
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const method = (m: string) => t(`method.${m}` as Key).toLowerCase();

function regionText(r: Region): string {
  return t('cal.regionText', { x0: String(r.x0 + 1), x1: String(r.x1 + 1), y0: String(r.y0 + 1), y1: String(r.y1 + 1) });
}

function baseId(id: string): string {
  return id.startsWith('v:') ? id.split(':').slice(2).join(':') : id;
}

/** The image of a viewer id, computing a version's images when needed. */
export function reportImage(id: string) {
  if (id.startsWith('v:')) {
    const vid = id.split(':')[1];
    if (!state.versions.some((v) => v.id === vid)) return undefined;
    if (!isFresh(vid)) computeVersion(vid);
  }
  return state.viewable(id)?.image;
}

/** E.g. "Koondkaader: tasaväljakaader g (versioon „ilma tasaväljata”)". */
export function imageLabel(id: string): string {
  const title = imageTitle(id);
  if (!id.startsWith('v:')) return title;
  const v = state.versions.find((x) => x.id === id.split(':')[1]);
  return `${title} ${t('report.inVersion', { name: v?.name ?? '?' })}`;
}

/** The black and white levels with as many decimals as their difference needs, e.g. "0,9" and "1,1". */
export function levelText(black: number, white: number): [string, string] {
  const d = Math.max(0, Math.min(6, 1 - Math.floor(Math.log10(Math.abs(white - black) || 1))));
  return [fmt(black, d, d), fmt(white, d, d)];
}

/** Normalised flats have no unit. */
export function unitOf(id: string): string {
  return baseId(id).startsWith('master:flat:') ? '' : ' ADU';
}

function colorCaption(c: Composition): string {
  const ch = (k: 'R' | 'G' | 'B') => c.channels[k].filter ?? '–';
  return t('report.cap.color', {
    name: c.name || compositionName(c),
    B: ch('B'), G: ch('G'), R: ch('R'),
    stretch: c.stretch.type === 'asinh' ? t('report.cap.asinh', { s: fmt(c.stretch.strength, 1) }) : t('report.cap.linear'),
  });
}

function quickCaption(frames: Record<'R' | 'G' | 'B', string>): string {
  const name = (id: string) => state.frame(id)?.meta.fileName ?? id;
  return t('report.cap.quick', { B: name(frames.B), G: name(frames.G), R: name(frames.R) });
}

/** The caption shown when the student has not written one, in the current language. */
export function defaultCaption(s: ReportSnapshot): string {
  switch (s.type) {
    case 'image': {
      const [black, white] = levelText(s.range.black, s.range.white);
      const scale = s.range.scale ?? 'linear';
      const parts = [scale === 'linear'
        ? t('report.cap.image', { title: imageLabel(s.imageId), black, white, unit: unitOf(s.imageId) })
        : t('report.cap.imageScaled', { title: imageLabel(s.imageId), black, white, unit: unitOf(s.imageId), scale: t(`report.cap.scale.${scale}` as Key) })];
      if (s.view) parts.push(t('report.cap.view', { region: regionText(s.view) }));
      if (s.box) parts.push(t('report.cap.box'));
      if (s.line) parts.push(t(s.line.axis === 'row' ? 'report.cap.lineRow' : 'report.cap.lineColumn', { n: s.line.index + 1 }));
      return parts.join(' ');
    }
    case 'color':
      return colorCaption(s.composition) + (s.view ? ' ' + t('report.cap.view', { region: regionText(s.view) }) : '');
    case 'quickLook':
      return quickCaption(s.frames) + (s.view ? ' ' + t('report.cap.view', { region: regionText(s.view) }) : '');
    case 'profile':
      return t('report.cap.profile', {
        line: lower(t(s.axis === 'row' ? 'profile.titleRow' : 'profile.titleColumn', { n: String(s.index + 1) })),
        title: imageLabel(s.imageId),
      });
    case 'histogram':
      return t('report.cap.histogram', {
        title: imageLabel(s.imageId),
        where: s.box ? regionText(s.box) : t('report.cap.whole'),
      }) + (s.log ? ' ' + t('report.cap.log') : '');
    case 'boxStats':
      return t('report.cap.boxStats', { title: imageLabel(s.imageId), region: regionText(s.box) });
    case 'text':
      return '';
  }
}

/** Short name of an item, e.g. for the figure file name and the item list. */
export function itemTitle(s: ReportSnapshot): string {
  switch (s.type) {
    case 'image':
    case 'boxStats':
      return imageLabel(s.imageId);
    case 'color':
      return t('color.title', { name: s.composition.name || compositionName(s.composition) });
    case 'quickLook':
      return t('quick.title');
    case 'profile':
      return `${t('tab.profile')} ${imageLabel(s.imageId)}`;
    case 'histogram':
      return `${t('tab.histogram')} ${imageLabel(s.imageId)}`;
    case 'text':
      return s.text.slice(0, 40);
  }
}

function formatDate(iso: string | undefined, time = false): string {
  if (!iso) return '–';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(getLang() === 'et' ? 'et-EE' : 'en-GB', time ? { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' } : { dateStyle: 'long' });
}

function field(label: Key, value: string): Block {
  return { type: 'paragraph', runs: [{ text: `${t(label)}: `, bold: true }, { text: value }] };
}

function para(text: string, itemId?: string): Block {
  return { type: 'paragraph', runs: [{ text }], ...(itemId ? { itemId } : {}) };
}

class Builder {
  private figure = 0;
  private table = 0;

  constructor(private ctx: MeasureContext) {}

  addFigure(snapshot: FigureSnapshot, caption: string, name: string, itemId?: string): Block {
    const number = ++this.figure;
    return {
      type: 'figure', number, caption, snapshot, itemId,
      fileName: `${t('report.figureFile')}-${String(number).padStart(2, '0')}-${slug(name)}.png`,
    };
  }

  addTable(caption: string, header: string[], rows: string[][], itemId?: string): Block {
    return { type: 'table', number: ++this.table, caption, header, rows, itemId };
  }

  title(): Block[] {
    const out: Block[] = [{ type: 'heading', level: 1, text: projectTitle() }];
    if (state.info.student) out.push(field('report.author', state.info.student));
    out.push(field('report.date', formatDate(new Date().toISOString())));
    return out;
  }

  data(): Block[] {
    const light = state.framesOf('light')[0] ?? state.frames[0];
    const header = light?.meta.header ?? {};
    const out: Block[] = [{ type: 'heading', level: 2, text: t('report.section.data') }];
    const text = (v: unknown) => (v === undefined || v === '' ? undefined : String(v).trim());
    const object = text(header.OBJECT);
    if (object) out.push(field('report.data.object', object));
    const telescope = text(header.TELESCOP);
    if (telescope) out.push(field('report.data.telescope', telescope));
    const camera = text(header.INSTRUME);
    if (camera) out.push(field('report.data.camera', camera));
    const dates = state.framesOf('light').map((f) => f.meta.dateObs).filter(Boolean).sort();
    if (dates.length) out.push(field('report.data.date', formatDate(dates[0], true) + ' UTC'));
    const scale = this.ctx.pixelScale;
    if (scale && light) {
      const tr = state.settings.trim;
      const w = tr ? tr.x1 - tr.x0 + 1 : light.meta.width;
      const h = tr ? tr.y1 - tr.y0 + 1 : light.meta.height;
      out.push(field('report.data.scale', `${fmt(scale, 3)} ″/px`));
      out.push(field('report.data.fov', `${fmt((w * scale) / 60, 1)}′ × ${fmt((h * scale) / 60, 1)}′`));
    }
    const rows: string[][] = [];
    for (const kind of KINDS) {
      const frames = state.framesOf(kind);
      const filters = [...new Set(frames.map((f) => f.meta.filter))].sort();
      for (const filter of filters) {
        const list = frames.filter((f) => f.meta.filter === filter);
        const exps = [...new Set(list.map((f) => f.meta.exposure))].sort((a, b) => a - b);
        // Twilight flats each have their own exposure: then only the range
        const exp = exps.length > 3 ? `${fmt(exps[0], 3)}–${fmt(exps[exps.length - 1], 3)}` : exps.map((e) => fmt(e, 3)).join(', ');
        rows.push([cap(term(kind)), filter || '–', String(list.length), exp]);
      }
    }
    if (rows.length) {
      out.push(this.addTable(t('report.data.tableCaption'),
        [t('files.kind'), t('files.filter'), t('report.data.count'), t('report.data.exposure')], rows));
    }
    const excluded = state.frames.filter((f) => f.meta.excluded).length;
    if (excluded) out.push(para(t('report.data.excluded', { n: excluded })));
    return out;
  }

  processing(): Block[] {
    const s = state.settings;
    const out: Block[] = [{ type: 'heading', level: 2, text: t('report.section.processing') }];
    if (state.isDone('trim')) {
      const r = s.trim;
      out.push(para(r ? t('report.proc.trim', { region: regionText(r), w: r.x1 - r.x0 + 1, h: r.y1 - r.y0 + 1 }) : t('report.proc.noTrim')));
    }
    const bias = state.masters.get(masterId('bias'));
    const dark = state.masters.get(masterId('dark'));
    const flats = [...state.masters.values()].filter((m) => m.kind === 'flat');
    for (const kind of ['bias', 'dark', 'flat'] as const) {
      if (!state.isDone(kind)) continue;
      if (!state.framesOf(kind).length) out.push(para(t('report.proc.skipped', { kind: term(kind) })));
    }
    if (bias) out.push(para(t('report.proc.bias', { n: bias.count, method: method(bias.method) })));
    if (dark) {
      out.push(para(t('report.proc.dark', { n: dark.count, exp: fmt(dark.exposure, 3), method: method(dark.method) })
        + (bias ? ' ' + t('report.proc.darkMinusBias') : '')));
    }
    if (flats.length) {
      const minus = [bias ? t('formula.bias') : '', s.darkForFlats && dark ? t('formula.dark') : ''].filter(Boolean).join(t('report.and'));
      out.push(para(t('report.proc.flat', {
        filters: flats.map((m) => `${m.filter} (${m.count})`).join(', '),
        method: method(flats[0].method),
      }) + (minus ? ' ' + t('report.proc.flatMinus', { what: minus }) : '')));
    }
    if (state.isDone('calibrate') && state.calibrated.size) {
      const lights = state.framesOf('light');
      const useBias = s.useBias && !!bias;
      const useDark = s.useDark && !!dark;
      const useFlat = s.useFlat && flats.length > 0;
      const scale = darkScale(lights[0]?.meta.exposure ?? 0);
      const parts = [
        t('formula.light'),
        useBias ? ` − ${t('formula.bias')}` : '',
        useDark ? ` − ${scale === 1 ? '' : fmt(scale, 3) + ' × '}${t('formula.dark')}` : '',
      ].join('');
      out.push(para(t('report.proc.calibrate', { n: state.calibrated.size })));
      out.push(para(`${t('formula.result')} = ${useFlat ? `(${parts}) / ${t('formula.flat')}` : parts}`));
      if (useDark && scale !== 1) out.push(para(t('report.proc.darkScale', { scale: fmt(scale, 3) })));
    }
    const ref = referenceFrame();
    if (state.isDone('align') && ref && state.aligned.size) {
      const sources = state.framesOf('light').filter((f) => f !== ref).map((f) => s.transforms[f.meta.id]?.source);
      const crop = state.alignCrop;
      const manual = sources.filter((x) => x === 'manual').length;
      const auto = sources.filter((x) => x === 'auto').length;
      const how = auto === 0 ? 'report.proc.alignManual' : manual === 0 ? 'report.proc.alignAuto' : 'report.proc.alignBoth';
      out.push(para(t('report.proc.align', {
        file: ref.meta.fileName,
        model: t(`align.model.${s.alignModel}` as Key).toLowerCase(),
      }) + ' ' + t(how, { manual, auto }) + (crop ? ' ' + t('report.proc.crop', { w: crop.x1 - crop.x0 + 1, h: crop.y1 - crop.y0 + 1 }) : '')));
    }
    if (state.isDone('stack') && state.stacks.size) {
      const stacks = [...state.stacks.values()];
      out.push(para(t('report.proc.stack', {
        method: method(stacks[0].method),
        counts: stacks.map((x) => `${x.filter || '–'} ${x.count}`).join(', '),
      })));
    }
    for (const v of state.versions) {
      const diff = differences(v.settings, s);
      out.push(para(t('report.proc.version', {
        name: v.name,
        what: diff.length ? diff.map(differenceText).join(', ') : t('compare.noDifference'),
      })));
    }
    if (out.length === 1) out.push(para(t('report.proc.none')));
    return out;
  }

  items(): Block[] {
    const items = state.report.items;
    if (!items.length) return [];
    return [{ type: 'heading', level: 2, text: t('report.section.items') }, ...items.map((item) => this.item(item))];
  }

  item(item: ReportItem): Block {
    const s = item.snapshot;
    const caption = item.caption.trim() || defaultCaption(s);
    if (s.type === 'text') return para(s.text, item.id);
    if (s.type === 'boxStats') {
      const img = reportImage(s.imageId);
      if (!img) return para(`${caption} ${t('report.missing')}`, item.id);
      const st = stats(values(img.data, img.width, s.box));
      const d = statDigits(st);
      const unit = unitOf(s.imageId).trim();
      const v = (x: number) => fmt(x, d) + (unit ? ` ${unit}` : '');
      return this.addTable(caption, [t('report.stat'), t('report.value')], [
        [t('stat.n'), fmt(st.n, 0)],
        [t('stat.mean'), v(st.mean)],
        [t('stat.median'), v(st.median)],
        [t('stat.std'), v(st.std)],
        [t('stat.min'), v(st.min)],
        [t('stat.max'), v(st.max)],
      ], item.id);
    }
    return this.addFigure(s, caption, itemTitle(s), item.id);
  }

  tasks(): Block[] {
    const out: Block[] = [];
    for (const task of TASKS) {
      if (unmet(task, this.ctx)) continue;
      const answered = task.parts.some((p) => state.answers[`${task.id}.${p.id}`]?.value.trim());
      if (!answered) continue;
      out.push({ type: 'heading', level: 3, text: taskContent(task.id, task.params?.(this.ctx)).title });
      for (const p of task.parts) {
        const a = state.answers[`${task.id}.${p.id}`];
        const raw = a?.value.trim() ?? '';
        const value = !raw ? '–'
          : p.type === 'choice' ? (p.options?.find((o) => o.id === raw)?.label[getLang()] ?? raw)
            : p.type === 'keyword' ? raw.toUpperCase()
              : raw + (p.unit && p.type === 'number' ? ` ${p.unit}` : '');
        const runs: Run[] = [{ text: `${partLabel(p)}: `, bold: true }, { text: value }];
        if (a?.correct) runs.push({ text: ` ✓` });
        out.push({ type: 'paragraph', runs });
      }
    }
    if (!out.length) return [];
    return [{ type: 'heading', level: 2, text: t('report.section.tasks') }, ...out];
  }

  colour(): Block[] {
    const ready = state.compositions.filter((c) => (['R', 'G', 'B'] as const).some((k) => {
      const f = c.channels[k].filter;
      return f !== null && state.stacks.has(`stack:${f}`);
    }));
    if (!ready.length) return [];
    // The quick look of the raw frames first, as the "before" image
    const q = quickLook();
    const frames = q && { R: q.frames.R.meta.id, G: q.frames.G.meta.id, B: q.frames.B.meta.id };
    return [
      { type: 'heading', level: 2, text: t('report.section.colour') },
      ...(frames ? [this.addFigure({ type: 'quickLook', frames, view: null }, quickCaption(frames), t('quick.title'))] : []),
      ...ready.map((c) => this.addFigure({ type: 'color', composition: structuredClone(c), view: null }, colorCaption(c), c.name || compositionName(c))),
    ];
  }

  mentorComments(): Block[] {
    const entries = Object.entries(state.comments).flatMap(([key, list]) => {
      const [kind, id] = key.split(':');
      const task = kind === 'task' ? TASKS.find((x) => x.id === id) : undefined;
      const where = task ? taskContent(task.id, task.params?.(this.ctx)).title : t(STEP_LABEL[id] ?? 'step.files');
      return list.map((c) => ({ ...c, where }));
    }).sort((a, b) => a.date.localeCompare(b.date));
    if (!entries.length) return [];
    return [
      { type: 'heading', level: 2, text: t('report.section.mentorComments') },
      ...entries.map((c): Block => ({ type: 'paragraph', runs: [{ text: `${c.where} (${formatCommentDate(c.date)}): `, bold: true }, { text: c.text }] })),
    ];
  }
}

const STEP_LABEL: Record<string, Key> = {
  files: 'step.files', trim: 'cal.trim', bias: 'cal.bias', dark: 'cal.dark', flat: 'cal.flat', calibrate: 'cal.apply',
  align: 'align.step', stack: 'align.stack', color: 'step.color',
};

/** The report in the current language, with the sections that are switched on. */
export function buildReport(): ReportDoc {
  const b = new Builder(new MeasureContext());
  const sections: Section[] = [];
  for (const id of SECTIONS) {
    if (!sectionOn(id)) continue;
    const blocks = b[id]();
    if (blocks.length) sections.push({ id, blocks });
  }
  return { title: projectTitle(), author: state.info.student, lang: getLang(), sections };
}
