// Step 3: alignment and stacking. The student marks stars by hand first, then compares with the
// app's own result (§3.3, §4.1).

import { transformDifference } from '../align';
import { h } from '../dom';
import { fmt, type Key, t } from '../i18n';
import {
  centre, lightsByTime, MAX_MANUAL_STARS, referenceFrame, refreshAligned, resetAlignment, runAuto, stackLights,
  starAt, transformOf, trimOffset, updateManualTransforms, useAuto,
} from '../stack';
import { type Frame, state } from '../state';
import { tasksFor } from '../tasks';
import type { AlignModel, AlignTransform, CombineMethod } from '../types';
import type { Marker } from '../viewer';
import { renderWhy } from './explain';
import type { AlignSub } from './resume';
import { renderTasks } from './task';
import { stackTitle, type ViewerPanel } from './viewerpanel';

type Sub = AlignSub;
const SUBS: Sub[] = ['manual', 'auto', 'stack'];
const SUB_LABEL: Record<Sub, Key> = { manual: 'align.manual', auto: 'align.auto', stack: 'align.stack' };

/** Agreement between two alignments, in px at the image corners. */
const GOOD = 0.5;
const POOR = 1;

/** Clicks this close to the last star (px) remove it. */
const UNDO_DISTANCE = 6;

function degrees(rad: number): number {
  return (rad * 180) / Math.PI;
}

function frameLabel(f: Frame): string {
  return `${f.meta.filter ? f.meta.filter + ' · ' : ''}${f.meta.fileName}`;
}

function timeOf(f: Frame): string {
  const m = /T(\d\d:\d\d:\d\d)/.exec(f.meta.dateObs);
  return m ? m[1] : f.meta.dateObs;
}

export class AlignStep {
  readonly element = h('section', { class: 'step-panel align-step' });
  private sub: Sub = 'manual';
  private filter: string | null = null;
  private active = false;
  private busy = false;
  private error: string | null = null;
  private message: string | null = null;

  constructor(private viewer: ViewerPanel, private toColor: () => void) {
    state.on((kind) => {
      if (!this.active) return;
      if (kind === 'steps' || kind === 'settings' || kind === 'frames' || kind === 'calibrated' || kind === 'aligned'
        || kind === 'stacks' || kind === 'auto') this.render();
      // The marked row follows the image shown
      if (kind === 'selection' && this.sub === 'manual') this.render();
    });
  }

  setActive(active: boolean): void {
    this.active = active;
    if (!active) this.viewer.setPicker(null);
    else this.render();
  }

  open(sub: Sub): void {
    this.sub = sub;
    this.error = null;
    this.message = null;
  }

  private unlocked(sub: Sub): boolean {
    if (sub === 'manual') return true;
    if (sub === 'auto') return this.hasManual() || state.isDone('align');
    return state.isDone('align');
  }

  private hasManual(): boolean {
    return Object.values(state.settings.transforms).some((x) => x.source === 'manual');
  }

  private go(sub: Sub): void {
    this.sub = sub;
    this.error = null;
    this.message = null;
    this.render();
    this.element.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  render(): void {
    if (!this.unlocked(this.sub)) this.sub = SUBS.filter((s) => this.unlocked(s)).pop()!;
    const filters = state.filtersOf('light');
    if (this.filter === null || !filters.includes(this.filter)) this.filter = referenceFrame()?.meta.filter ?? filters[0] ?? '';
    this.viewer.setPicker({
      markers: (id) => this.markers(id),
      pick: this.sub === 'manual' ? (id, x, y) => this.pick(id, x, y) : undefined,
      hint: this.sub === 'manual' ? (id) => this.pickHint(id) : undefined,
    });
    const done = (s: Sub) => s === 'manual' ? this.hasManual() : s === 'auto' ? state.isDone('align') : state.isDone('stack');
    const body = this.sub === 'manual' ? this.manual() : this.sub === 'auto' ? this.auto() : this.stack();
    this.element.replaceChildren(h('div', {},
      h('h2', {}, t('step.align')),
      h('nav', { class: 'subtabs', 'aria-label': t('step.align') },
        SUBS.map((s, i) => h('button', {
          type: 'button',
          class: s === this.sub ? 'active' : '',
          disabled: !this.unlocked(s),
          title: this.unlocked(s) ? undefined : t(s === 'auto' ? 'align.lockedAuto' : 'align.lockedStack'),
          'aria-current': s === this.sub ? 'step' : undefined,
          onclick: () => this.go(s),
        }, `${i + 1}. ${t(SUB_LABEL[s])}`, done(s) ? ' ✓' : ''))),
      this.error ? h('p', { class: 'error', role: 'alert' }, this.error) : null,
      body,
    ));
  }

  /** Shows the busy state, then runs `fn` after the browser has painted it. */
  private later(fn: () => void): void {
    this.busy = true;
    this.render();
    requestAnimationFrame(() => setTimeout(() => {
      try {
        fn();
      } catch (e) {
        this.error = t('cal.computeFailed', { detail: String(e) });
      } finally {
        this.busy = false;
        this.render();
      }
    }, 0));
  }

  // ------------------------------------------------------------- markers and clicks

  /**
   * Stars clicked in this frame, and dashed circles where the reference stars are. On aligned
   * frames and stacks the reference stars only: aligned stars should sit inside them.
   */
  private markers(id: string): Marker[] {
    const ref = referenceFrame();
    if (!ref) return [];
    const o = trimOffset();
    const crop = state.alignCrop;
    const own = id.startsWith('cal:') ? id.slice(4) : null;
    const aligned = id.startsWith('aligned:') || id.startsWith('stack:');
    if (!own && !aligned) return [];
    const shift = aligned && crop ? { x: o.x + crop.x0, y: o.y + crop.y0 } : o;
    const toMarker = (p: [number, number], k: number, style: Marker['style']): Marker =>
      ({ x: p[0] - shift.x, y: p[1] - shift.y, label: String(k + 1), style });
    const out: Marker[] = [];
    if (own !== ref.meta.id) out.push(...(state.settings.manualStars[ref.meta.id] ?? []).map((p, k) => toMarker(p, k, 'ghost')));
    if (own) out.push(...(state.settings.manualStars[own] ?? []).map((p, k) => toMarker(p, k, 'star')));
    return out;
  }

  private pickHint(id: string | null): string {
    const fid = id?.startsWith('cal:') ? id.slice(4) : null;
    const f = fid ? state.frame(fid) : undefined;
    if (!f || f.meta.kind !== 'light') return t('align.pickChoose');
    const n = (state.settings.manualStars[f.meta.id] ?? []).length;
    const ref = referenceFrame()!;
    if (n >= MAX_MANUAL_STARS) return t('align.pickFull', { n: MAX_MANUAL_STARS });
    if (f !== ref && n >= (state.settings.manualStars[ref.meta.id] ?? []).length) return t('align.pickRefFirst');
    return t(f === ref ? 'align.pickRef' : 'align.pickNext', { n: n + 1 });
  }

  private pick(id: string, x: number, y: number): void {
    if (!id.startsWith('cal:')) return;
    const f = state.frame(id.slice(4));
    if (!f || f.meta.kind !== 'light') return;
    const fid = f.meta.id;
    const stars = [...(state.settings.manualStars[fid] ?? [])];
    const o = trimOffset();
    const last = stars[stars.length - 1];
    this.message = null;
    if (last && Math.hypot(last[0] - o.x - x, last[1] - o.y - y) <= UNDO_DISTANCE) {
      stars.pop();
    } else if (stars.length >= MAX_MANUAL_STARS) {
      this.message = t('align.pickFull', { n: MAX_MANUAL_STARS });
    } else if (f !== referenceFrame() && stars.length >= (state.settings.manualStars[referenceFrame()!.meta.id] ?? []).length) {
      this.message = t('align.pickRefFirst');
    } else {
      const s = starAt(fid, x, y);
      if (!s) this.message = t('align.noStar');
      else stars.push([Number(s.x.toFixed(3)), Number(s.y.toFixed(3))]);
    }
    this.setStars(fid, stars);
  }

  private setStars(fid: string, stars: [number, number][]): void {
    const manualStars = { ...state.settings.manualStars };
    if (stars.length) manualStars[fid] = stars;
    else delete manualStars[fid];
    state.updateSettings({ manualStars });
    // Stars on the reference change every frame's result; elsewhere the frame takes its own stars
    updateManualTransforms(fid === referenceFrame()?.meta.id ? [] : [fid]);
    if (state.isDone('align')) refreshAligned();
    this.viewer.updateMarkers();
    this.viewer.render();
  }

  // ------------------------------------------------------------- 1. by hand

  private manual(): HTMLElement {
    const lights = lightsByTime();
    const ref = referenceFrame();
    if (!ref || !state.calibrated.size) return h('div', { class: 'sub' }, renderWhy('align'), h('p', { class: 'warning' }, t('align.noCalibrated')));
    const filters = state.filtersOf('light');
    const frames = lights.filter((f) => f.meta.filter === this.filter);
    const rotation = state.settings.alignModel === 'shiftRotation';
    const refStars = (state.settings.manualStars[ref.meta.id] ?? []).length;

    const model = (m: AlignModel, label: Key, tip: Key) => h('label', { class: 'choice' },
      h('input', {
        type: 'radio',
        name: 'align-model',
        checked: state.settings.alignModel === m,
        onchange: () => {
          state.updateSettings({ alignModel: m });
          resetAlignment();
          state.addLog('align', 'modelSet', { what: label });
        },
      }), ' ', h('strong', {}, t(label)), ' – ', t(tip));

    const row = (f: Frame) => {
      const isRef = f === ref;
      const n = (state.settings.manualStars[f.meta.id] ?? []).length;
      const tr = state.settings.transforms[f.meta.id];
      const showing = state.selectedId === `cal:${f.meta.id}`;
      return h('tr', { class: showing ? 'selected' : '' },
        h('td', { class: 'name' }, frameLabel(f), isRef ? h('span', { class: 'badge' }, t('align.reference')) : null),
        h('td', {}, timeOf(f)),
        h('td', { class: 'num' }, String(n)),
        ...this.transformCells(isRef ? { dx: 0, dy: 0, rotation: 0 } : tr, rotation),
        h('td', { class: 'buttons-cell' },
          h('button', { type: 'button', onclick: () => this.viewer.show(`cal:${f.meta.id}`, { tab: 'pixel' }) }, t('align.mark')),
          n ? h('button', { type: 'button', onclick: () => this.setStars(f.meta.id, []) }, t('align.clear')) : null));
    };

    const filterDone = frames.every((f) => f === ref || state.settings.transforms[f.meta.id]?.source === 'manual');
    const rest = lights.filter((f) => f !== ref && f.meta.filter !== this.filter && !state.settings.transforms[f.meta.id]);

    return h('div', { class: 'sub' },
      renderWhy('align'),
      h('section', { class: 'phase' },
        h('h3', {}, t('phase.look')),
        h('p', {}, t('align.look')),
        h('div', { class: 'buttons left' },
          h('button', { type: 'button', onclick: () => this.viewer.show(`cal:${lights[0].meta.id}`, { tab: 'pixel' }) }, t('align.showFirst')),
          h('button', { type: 'button', onclick: () => this.viewer.show(`cal:${lights[lights.length - 1].meta.id}`, { tab: 'pixel' }) }, t('align.showLast')))),
      h('section', { class: 'phase' },
        h('h3', {}, t('phase.decide')),
        h('label', { class: 'field' }, t('align.referenceLabel'),
          h('select', {
            onchange: (e: Event) => {
              const id = (e.target as HTMLSelectElement).value;
              state.updateSettings({ referenceId: id });
              resetAlignment();
              state.addLog('align', 'referenceSet', { file: state.frame(id)?.meta.fileName ?? id });
            },
          }, lights.map((f) => h('option', { value: f.meta.id, selected: f === ref }, `${timeOf(f)} · ${frameLabel(f)}`)))),
        h('p', { class: 'hint' }, t('align.referenceTip')),
        h('fieldset', { class: 'methods' },
          h('legend', {}, t('align.model')),
          model('shift', 'align.model.shift', 'align.model.shiftTip'),
          model('shiftRotation', 'align.model.shiftRotation', 'align.model.shiftRotationTip'))),
      h('section', { class: 'phase' },
        h('h3', {}, t('phase.do')),
        h('p', {}, t('align.manualDo', { n: MAX_MANUAL_STARS })),
        filters.length > 1 ? h('div', { class: 'segmented', role: 'group', 'aria-label': t('files.filter') },
          filters.map((fl) => h('button', {
            type: 'button',
            class: fl === this.filter ? 'active' : '',
            'aria-pressed': String(fl === this.filter),
            onclick: () => {
              this.filter = fl;
              this.render();
            },
          }, fl || '–'))) : null,
        h('div', { class: 'table-wrap' }, h('table', { class: 'grid compact align-table' },
          h('thead', {}, h('tr', {},
            h('th', {}, t('files.name')), h('th', {}, t('align.time')), h('th', { class: 'num' }, t('align.stars')),
            ...this.transformHeads(rotation), h('th', {}, ''))),
          h('tbody', {}, (ref.meta.filter === this.filter ? frames : [ref, ...frames]).map(row)))),
        this.message ? h('p', { class: 'warning', role: 'status' }, this.message) : null,
        refStars === 0 ? h('p', { class: 'hint' }, t('align.startWithRef')) : null,
        rotation && refStars === 1 ? h('p', { class: 'hint' }, t('align.rotationNeedsTwo')) : null,
        filterDone && rest.length ? h('div', { class: 'buttons left' },
          h('button', {
            type: 'button',
            disabled: this.busy,
            onclick: () => this.later(() => {
              const ids = rest.map((f) => f.meta.id);
              runAuto(ids);
              const failed = useAuto(ids);
              state.addLog('align', 'restAuto', { n: ids.length - failed.length });
              if (failed.length) this.error = t('align.autoFailedSome', { n: failed.length });
            }),
          }, this.busy ? t('cal.computing') : t('align.doRest', { n: rest.length })),
          h('span', { class: 'hint' }, t('align.doRestTip'))) : null),
      this.hasManual() ? this.next('auto') : null,
    );
  }

  private transformHeads(rotation: boolean): HTMLElement[] {
    return [
      h('th', { class: 'num' }, 'Δx'), h('th', { class: 'num' }, 'Δy'),
      ...(rotation ? [h('th', { class: 'num' }, t('align.rotation'))] : []),
    ];
  }

  private transformCells(tr: Pick<AlignTransform, 'dx' | 'dy' | 'rotation'> | undefined, rotation: boolean): HTMLElement[] {
    const cell = (v: string) => h('td', { class: 'num' }, v);
    if (!tr) return [cell('–'), cell('–'), ...(rotation ? [cell('–')] : [])];
    return [cell(fmt(tr.dx, 2)), cell(fmt(tr.dy, 2)), ...(rotation ? [cell(`${fmt(degrees(tr.rotation), 2)}°`)] : [])];
  }

  private next(sub: Sub): HTMLElement {
    return h('div', { class: 'next' }, h('button', { type: 'button', class: 'primary', onclick: () => this.go(sub) }, t('cal.next', { what: t(SUB_LABEL[sub]) })));
  }

  // ------------------------------------------------------------- 2. automatic check

  private auto(): HTMLElement {
    const lights = lightsByTime();
    const ref = referenceFrame()!;
    const rotation = state.settings.alignModel === 'shiftRotation';
    const c = centre(ref);
    const { width: w, height: hgt } = ref.meta;
    const ran = state.auto.size > 0;
    const done = state.isDone('align');
    const missing = lights.filter((f) => !transformOf(f.meta.id));
    const rotated = [...state.auto.values()].some((a) => a && Math.abs(degrees(a.rotation)) > 0.5);

    const row = (f: Frame) => {
      const isRef = f === ref;
      const own = state.settings.transforms[f.meta.id];
      const a = state.auto.get(f.meta.id);
      const diff = own && a ? transformDifference(own, a, c, w, hgt) : undefined;
      const use = (source: 'manual' | 'auto') => {
        if (source === 'auto') useAuto([f.meta.id]);
        else updateManualTransforms([f.meta.id]);
        if (done) refreshAligned();
      };
      const canManual = (state.settings.manualStars[f.meta.id] ?? []).length > 0;
      return h('tr', {},
        h('td', { class: 'name' }, frameLabel(f), isRef ? h('span', { class: 'badge' }, t('align.reference')) : null),
        ...this.transformCells(isRef ? undefined : own, rotation),
        ...(isRef ? this.transformCells(undefined, rotation) : a ? this.transformCells(a, rotation) : [h('td', { class: 'warning', colSpan: rotation ? 3 : 2 }, ran ? t('align.autoFailed') : '–')]),
        h('td', { class: 'num' }, a && !isRef ? String(a.matched) : ''),
        h('td', { class: 'num ' + (diff === undefined ? '' : diff < GOOD ? 'ok' : diff >= POOR ? 'warning' : '') }, diff === undefined ? '' : fmt(diff, 2)),
        h('td', {}, isRef ? t('align.reference')
          : own?.source === 'auto'
            ? [t('align.usingAuto'), canManual ? h('button', { type: 'button', class: 'small', onclick: () => use('manual') }, t('align.useOwn')) : null]
            : own
              ? [t('align.usingOwn'), a ? h('button', { type: 'button', class: 'small', onclick: () => use('auto') }, t('align.useApp')) : null]
              : a ? h('button', { type: 'button', class: 'small', onclick: () => use('auto') }, t('align.useApp')) : '–'));
    };

    return h('div', { class: 'sub' },
      h('section', { class: 'phase' },
        h('h3', {}, t('phase.do')),
        h('p', {}, t('align.autoDo')),
        h('button', {
          type: 'button',
          class: ran ? '' : 'primary',
          disabled: this.busy,
          onclick: () => this.later(() => {
            runAuto();
            state.addLog('align', 'autoRun', {});
          }),
        }, this.busy ? t('cal.computing') : ran ? t('align.autoAgain') : t('align.autoRun'))),
      ran ? h('section', { class: 'phase' },
        h('h3', {}, t('phase.check')),
        h('p', {}, t('align.autoCheck', { good: fmt(GOOD, 1) })),
        h('div', { class: 'table-wrap' }, h('table', { class: 'grid compact align-table' },
          h('thead', {},
            h('tr', {},
              h('th', { rowSpan: 2 }, t('files.name')),
              h('th', { colSpan: rotation ? 3 : 2 }, t('align.yours')),
              h('th', { colSpan: rotation ? 4 : 3 }, t('align.app')),
              h('th', { rowSpan: 2, class: 'num', title: t('align.diffTip') }, t('align.diff')),
              h('th', { rowSpan: 2 }, t('align.used'))),
            h('tr', {}, ...this.transformHeads(rotation), ...this.transformHeads(rotation), h('th', { class: 'num', title: t('align.matchedTip') }, t('align.stars')))),
          h('tbody', {}, lights.map(row)))),
        rotated && !rotation ? h('p', { class: 'warning' }, t('align.rotationFound')) : null,
        h('div', { class: 'buttons left' },
          h('button', {
            type: 'button',
            onclick: () => {
              useAuto(lights.map((f) => f.meta.id));
              if (done) refreshAligned();
            },
          }, t('align.useAppAll')))) : null,
      h('section', { class: 'phase' },
        h('h3', {}, done ? t('align.confirmed') : t('align.confirmHeading')),
        missing.length ? h('p', { class: 'warning' }, t('align.missing', { n: missing.length })) : null,
        h('button', {
          type: 'button',
          class: 'primary',
          disabled: this.busy || missing.length > 0,
          onclick: () => this.later(() => {
            const used = Object.values(state.settings.transforms);
            state.setStep('align', { done: true, acceptedAuto: used.every((x) => x.source === 'auto') });
            refreshAligned();
            state.addLog('align', 'aligned', {
              n: lights.length,
              manual: used.filter((x) => x.source === 'manual').length,
              auto: used.filter((x) => x.source === 'auto').length,
            });
            this.viewer.show(`aligned:${lights[lights.length - 1].meta.id}`, { tab: 'pixel' });
          }),
        }, done ? t('align.realign') : t('align.confirm')),
        done && state.alignCrop ? h('p', {}, t('align.crop', {
          w: state.alignCrop.x1 - state.alignCrop.x0 + 1,
          h: state.alignCrop.y1 - state.alignCrop.y0 + 1,
        })) : null,
        done ? h('p', { class: 'hint' }, t('align.alignedCheck')) : null),
      renderTasks(tasksFor('align')),
      done ? this.next('stack') : null,
    );
  }

  // ------------------------------------------------------------- 3. stacking

  private stack(): HTMLElement {
    const filters = state.filtersOf('light');
    const count = (fl: string) => state.framesOf('light', fl).filter((f) => state.aligned.has(f.meta.id)).length;
    const fewest = Math.min(...filters.map(count));
    const methods: CombineMethod[] = fewest >= 5 ? ['median', 'mean', 'sigmaClip'] : ['median', 'mean'];
    const current = state.settings.combine.stack;
    const done = state.isDone('stack');
    const stale = done && [...state.stacks.values()].some((s) => s.method !== current);

    return h('div', { class: 'sub' },
      renderWhy('stack'),
      h('section', { class: 'phase' },
        h('h3', {}, t('phase.look')),
        h('p', {}, t('stack.look')),
        h('table', { class: 'grid compact' },
          h('thead', {}, h('tr', {}, h('th', {}, t('files.filter')), h('th', { class: 'num' }, t('cal.count')))),
          h('tbody', {}, filters.map((fl) => h('tr', {}, h('th', { scope: 'row' }, fl || '–'), h('td', { class: 'num' }, String(count(fl)))))))),
      h('section', { class: 'phase' },
        h('h3', {}, t('phase.decide')),
        h('fieldset', { class: 'methods' },
          h('legend', {}, t('cal.method')),
          methods.map((m) => h('label', { class: 'choice' },
            h('input', {
              type: 'radio',
              name: 'method-stack',
              checked: m === current,
              onchange: () => state.updateSettings({ combine: { ...state.settings.combine, stack: m } }),
            }),
            ' ', h('strong', {}, t(`method.${m}` as Key)), ' – ', t(`stack.${m}Tip` as Key))),
          fewest < 5 ? h('p', { class: 'hint' }, t('stack.sigmaNeedsFive')) : null)),
      h('section', { class: 'phase' },
        h('h3', {}, t('phase.do')),
        h('button', {
          type: 'button',
          class: 'primary',
          disabled: this.busy,
          onclick: () => this.later(() => {
            state.setStep('stack', { done: true });
            stackLights();
            state.addLog('stack', 'stacked', { n: state.stacks.size, method: current });
            const first = [...state.stacks.keys()][0];
            if (first) this.viewer.show(first, { tab: 'histogram' });
          }),
        }, this.busy ? t('cal.computing') : done ? t('stack.again') : t('stack.run', { n: filters.length })),
        stale ? h('p', { class: 'warning' }, t('cal.stale')) : null),
      done && state.stacks.size ? h('section', { class: 'phase' },
        h('h3', {}, t('phase.check')),
        h('table', { class: 'grid compact' },
          h('thead', {}, h('tr', {}, h('th', {}, t('files.filter')), h('th', { class: 'num' }, t('cal.count')), h('th', {}, t('cal.method')), h('th', {}, ''))),
          h('tbody', {}, [...state.stacks.values()].map((s) => h('tr', {},
            h('th', { scope: 'row' }, s.filter || '–'),
            h('td', { class: 'num' }, String(s.count)),
            h('td', {}, t(`method.${s.method}` as Key)),
            h('td', {}, h('button', { type: 'button', onclick: () => this.viewer.show(s.id, { tab: 'box' }), title: stackTitle(s.id) }, t('cal.show'))))))),
        h('p', { class: 'hint' }, t('stack.check'))) : null,
      renderTasks(tasksFor('stack')),
      done && state.stacks.size ? h('div', { class: 'next' },
        h('span', { class: 'ok' }, t('stack.allDone')),
        h('button', { type: 'button', class: 'primary', onclick: () => this.toColor() }, t('cal.next', { what: t('step.color') }))) : null,
    );
  }
}
