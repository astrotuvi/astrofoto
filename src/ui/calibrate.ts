// Step 2: trim and master frames. Each part follows look → decide → do → check (§4.1).

import { hasErrors, runChecks } from '../checks';
import { h } from '../dom';
import { fmt, type Key, t } from '../i18n';
import { term } from '../i18n/glossary';
import { darkScale, refreshAll, suggestedTrim } from '../masters';
import { type MasterKind, masterId, state } from '../state';
import { tasksFor } from '../tasks';
import type { CombineMethod, Region, StepId } from '../types';
import { isMentor } from '../mentor';
import { renderChecks } from './checks';
import { renderComments } from './comments';
import { renderWhy } from './explain';
import { renderTasks } from './task';
import type { CalSub } from './resume';
import type { ViewerPanel } from './viewerpanel';

type Sub = CalSub;
const SUBS: Sub[] = ['trim', 'bias', 'dark', 'flat', 'apply'];
const SUB_LABEL: Record<Sub, Key> = { trim: 'cal.trim', bias: 'cal.bias', dark: 'cal.dark', flat: 'cal.flat', apply: 'cal.apply' };
const STEP: Record<Sub, StepId> = { trim: 'trim', bias: 'bias', dark: 'dark', flat: 'flat', apply: 'calibrate' };

interface TrimDraft { mode: 'trim' | 'none'; x0: string; x1: string; y0: string; y1: string }

export function regionEquals(a: Region | null | undefined, b: Region | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.x0 === b.x0 && a.x1 === b.x1 && a.y0 === b.y0 && a.y1 === b.y1;
}

function regionText(r: Region): string {
  return t('cal.regionText', { x0: String(r.x0 + 1), x1: String(r.x1 + 1), y0: String(r.y0 + 1), y1: String(r.y1 + 1) });
}

export class CalibrationStep {
  readonly element = h('section', { class: 'step-panel calibration-step' });
  private sub: Sub = 'trim';
  private draft: TrimDraft | null = null;
  private error: string | null = null;
  private active = false;
  private busy = false;

  /** `toAlign` opens the next step. */
  constructor(private viewer: ViewerPanel, private toAlign: () => void) {
    state.on((kind) => {
      if (!this.active) return;
      if (kind === 'steps' || kind === 'masters' || kind === 'calibrated' || kind === 'frames' || kind === 'settings' || kind === 'profile') this.render();
    });
  }

  /** Called when the step is shown or hidden. */
  setActive(active: boolean): void {
    this.active = active;
    if (!state.isDone('trim')) this.draft = null;
    if (!active) state.setTrimPreview(null);
    else this.render();
  }

  private unlocked(sub: Sub): boolean {
    const i = SUBS.indexOf(sub);
    return i === 0 || isMentor() || state.isDone(STEP[SUBS[i - 1]]);
  }

  /** Opens a part, e.g. from the resume page. */
  open(sub: Sub): void {
    this.sub = sub;
    this.error = null;
  }

  private go(sub: Sub): void {
    this.sub = sub;
    this.error = null;
    if (sub !== 'trim') state.setTrimPreview(null);
    this.render();
    this.element.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  render(): void {
    if (!this.unlocked(this.sub)) this.sub = SUBS.filter((s) => this.unlocked(s)).pop()!;
    const body = this.sub === 'trim' ? this.trim() : this.sub === 'flat' ? this.flat() : this.sub === 'apply' ? this.apply() : this.biasOrDark(this.sub);
    this.element.replaceChildren(h('div', {},
      h('h2', {}, t('step.calibration')),
      this.checks(),
      h('nav', { class: 'subtabs', 'aria-label': t('step.calibration') },
        SUBS.map((s, i) => h('button', {
          type: 'button',
          class: s === this.sub ? 'active' : '',
          disabled: !this.unlocked(s),
          title: this.unlocked(s) ? undefined : t('cal.locked'),
          'aria-current': s === this.sub ? 'step' : undefined,
          onclick: () => this.go(s),
        }, `${i + 1}. ${t(SUB_LABEL[s])}`, state.isDone(STEP[s]) ? ' ✓' : ''))),
      this.error ? h('p', { class: 'error', role: 'alert' }, this.error) : null,
      renderComments(`step:${STEP[this.sub]}`),
      body,
    ));
  }

  private checks(): HTMLElement | null {
    const list = runChecks().filter((c) => c.level !== 'info' || c.code === 'darkExposure');
    if (!list.length) return null;
    return renderChecks(list);
  }

  // ------------------------------------------------------------- trim

  private currentDraft(): TrimDraft {
    if (this.draft) return this.draft;
    const f = state.framesOf('flat')[0] ?? state.frames[0];
    const r = state.settings.trim ?? { x0: 0, x1: f.meta.width - 1, y0: 0, y1: f.meta.height - 1 };
    this.draft = {
      mode: state.settings.trim === null ? 'none' : 'trim',
      x0: String(r.x0 + 1), x1: String(r.x1 + 1), y0: String(r.y0 + 1), y1: String(r.y1 + 1),
    };
    return this.draft;
  }

  /** The draft as a 0-based region, or an error key. */
  private parseDraft(d: TrimDraft): Region | null | Key {
    if (d.mode === 'none') return null;
    const f = state.frames[0];
    const v = [d.x0, d.x1, d.y0, d.y1].map((s) => Number(s.trim()));
    if (v.some((x) => !Number.isInteger(x))) return 'cal.trimNotInteger';
    const [x0, x1, y0, y1] = v;
    if (x0 < 1 || y0 < 1 || x1 > f.meta.width || y1 > f.meta.height) return 'cal.trimOutside';
    if (x0 > x1 || y0 > y1) return 'cal.trimOrder';
    return { x0: x0 - 1, x1: x1 - 1, y0: y0 - 1, y1: y1 - 1 };
  }

  private showProfile(axis: 'row' | 'column'): void {
    const f = state.framesOf('flat')[0] ?? state.framesOf('light')[0] ?? state.frames[0];
    const mid = Math.floor((axis === 'row' ? f.meta.height : f.meta.width) / 2);
    this.viewer.show(f.meta.id, { tab: 'profile', profile: { axis, index: mid } });
  }

  private trim(): HTMLElement {
    const d = this.currentDraft();
    const f = state.frames[0];
    const preview = () => {
      const r = this.parseDraft(d);
      state.setTrimPreview(typeof r === 'object' ? r : null);
    };
    preview();
    const num = (key: 'x0' | 'x1' | 'y0' | 'y1', label: string) =>
      h('label', { class: 'inline' }, label, ' ', h('input', {
        type: 'number', min: 1, step: 1, value: d[key], disabled: d.mode === 'none',
        oninput: (e: Event) => { d[key] = (e.target as HTMLInputElement).value; preview(); },
      }));
    const radio = (mode: TrimDraft['mode'], label: Key) =>
      h('label', { class: 'choice' }, h('input', {
        type: 'radio', name: 'trim-mode', checked: d.mode === mode,
        onchange: () => { d.mode = mode; this.render(); },
      }), ' ', t(label));

    const done = state.isDone('trim');
    return h('div', { class: 'sub' },
      renderWhy('trim'),
      h('section', { class: 'phase' },
        h('h3', {}, t('phase.look')),
        h('p', {}, t('cal.trimLook')),
        h('div', { class: 'buttons left' },
          h('button', { type: 'button', onclick: () => this.showProfile('row') }, t('cal.showRowProfile')),
          h('button', { type: 'button', onclick: () => this.showProfile('column') }, t('cal.showColumnProfile')))),
      h('section', { class: 'phase' },
        h('h3', {}, t('phase.decide')),
        h('p', {}, t('cal.trimDecide', { w: String(f.meta.width), h: String(f.meta.height) })),
        radio('trim', 'cal.trimYes'),
        h('div', { class: 'trim-inputs' },
          h('span', {}, 'x:'), num('x0', t('cal.from')), num('x1', t('cal.to')),
          h('span', {}, 'y:'), num('y0', t('cal.from')), num('y1', t('cal.to'))),
        radio('none', 'cal.trimNo'),
        h('p', { class: 'hint' }, t('cal.trimPreview'))),
      h('section', { class: 'phase' },
        h('h3', {}, t('phase.do')),
        h('button', {
          type: 'button',
          class: 'primary',
          onclick: () => {
            const r = this.parseDraft(d);
            if (typeof r === 'string') {
              this.error = t(r);
              this.render();
              return;
            }
            this.error = null;
            const changed = !done || !regionEquals(r, state.settings.trim);
            state.updateSettings({ trim: r });
            state.setStep('trim', { done: true, acceptedAuto: false });
            if (changed) {
              state.addLog('trim', r ? 'trimSet' : 'trimNone', r ? { region: regionText(r) } : {});
              this.recompute();
            }
          },
        }, done ? t('cal.trimUpdate') : t('cal.trimConfirm'))),
      // The mentor sees the app's suggestion before deciding
      done || isMentor() ? this.trimCheck() : null,
      renderTasks(tasksFor('trim')),
      done ? this.next('bias') : null,
    );
  }

  private trimCheck(): HTMLElement {
    const own = state.settings.trim;
    const auto = suggestedTrim();
    const profileTrim = state.profile?.trim;
    const decided = own !== undefined;
    const lines: (HTMLElement | null)[] = [
      decided ? h('p', {}, t('cal.yourChoice'), ' ', own ? regionText(own) : t('cal.noTrim')) : null,
    ];
    if (auto !== undefined) {
      lines.push(h('p', {}, t('cal.appFound'), ' ', auto ? regionText(auto) : t('cal.noTrim')));
      // In mentor mode the suggestion is shown before the student has decided
      if (decided && regionEquals(own, auto)) {
        lines.push(h('p', { class: 'ok' }, t('cal.trimSame')));
      } else if (decided) {
        lines.push(h('p', { class: 'warning' }, t('cal.trimDiffers')));
        lines.push(h('div', { class: 'buttons left' },
          h('button', {
            type: 'button',
            onclick: () => {
              state.updateSettings({ trim: auto });
              state.setStep('trim', { done: true, acceptedAuto: true });
              state.addLog('trim', auto ? 'trimAuto' : 'trimNone', auto ? { region: regionText(auto) } : {});
              this.draft = null;
              this.recompute();
            },
          }, t('cal.useApp')),
          h('span', { class: 'hint' }, t('cal.keepOwn'))));
      }
    }
    if (profileTrim && auto && !regionEquals(profileTrim, auto)) {
      lines.push(h('p', { class: 'hint' }, t('cal.profileTrim', { region: regionText(profileTrim) })));
    }
    return h('section', { class: 'phase' }, h('h3', {}, t('phase.check')), lines);
  }

  // ------------------------------------------------------------- bias and dark

  private methodChoice(kind: MasterKind, n: number): HTMLElement {
    const methods: CombineMethod[] = n >= 5 ? ['median', 'mean', 'sigmaClip'] : ['median', 'mean'];
    const current = state.settings.combine[kind];
    return h('fieldset', { class: 'methods' },
      h('legend', {}, t('cal.method')),
      methods.map((m) => h('label', { class: 'choice' },
        h('input', {
          type: 'radio',
          name: `method-${kind}`,
          checked: m === current,
          onchange: () => state.updateSettings({ combine: { ...state.settings.combine, [kind]: m } }),
        }),
        ' ', h('strong', {}, t(`method.${m}` as Key)), ' – ', t(`method.${m}Tip` as Key))),
      n < 5 ? h('p', { class: 'hint' }, t('cal.sigmaNeedsFive')) : null,
    );
  }

  private computeButton(kind: MasterKind, label: Key): HTMLElement {
    const blocked = hasErrors();
    const master = kind === 'flat' ? [...state.masters.values()].find((m) => m.kind === 'flat') : state.masters.get(masterId(kind));
    const stale = master && master.method !== state.settings.combine[kind];
    return h('div', {},
      h('button', {
        type: 'button',
        class: 'primary',
        disabled: blocked || this.busy,
        onclick: () => this.compute(kind),
      }, this.busy ? t('cal.computing') : master ? t('cal.recompute') : t(label)),
      blocked ? h('p', { class: 'error' }, t('cal.fixErrors')) : null,
      stale ? h('p', { class: 'warning' }, t('cal.stale')) : null,
    );
  }

  /** Shows the busy state, then runs `fn` after the browser has painted it. */
  private later(fn: () => void): void {
    this.busy = true;
    this.render();
    requestAnimationFrame(() => setTimeout(() => {
      try {
        fn();
      } finally {
        this.busy = false;
        this.render();
      }
    }, 0));
  }

  private compute(kind: MasterKind): void {
    this.error = null;
    this.later(() => this.computeNow(kind));
  }

  private computeNow(kind: MasterKind): void {
    try {
      state.setStep(kind, { done: true });
      refreshAll();
      const first = kind === 'flat' ? [...state.masters.values()].find((m) => m.kind === 'flat') : state.masters.get(masterId(kind));
      if (first) {
        state.addLog(kind, 'masterBuilt', { kind, n: first.count, method: first.method });
        this.viewer.show(first.id, { tab: kind === 'flat' ? 'histogram' : 'box' });
      }
    } catch (e) {
      state.setStep(kind, undefined);
      this.error = t('cal.computeFailed', { detail: String(e) });
      this.render();
    }
  }

  private recompute(): void {
    this.later(() => {
      try {
        refreshAll();
      } catch (e) {
        this.error = t('cal.computeFailed', { detail: String(e) });
      }
    });
  }

  private skip(kind: MasterKind): HTMLElement {
    const use = kind === 'bias' ? 'useBias' : kind === 'dark' ? 'useDark' : 'useFlat';
    if (state.isDone(kind)) return h('section', { class: 'phase' }, h('p', {}, t(`cal.no.${kind}` as Key)), h('p', { class: 'ok' }, t('cal.skipped')));
    return h('section', { class: 'phase' },
      h('p', {}, t(`cal.no.${kind}` as Key)),
      h('button', {
        type: 'button',
        class: 'primary',
        onclick: () => {
          state.updateSettings({ [use]: false });
          state.clearMasters(kind);
          state.setStep(kind, { done: true });
          state.addLog(kind, 'skipped', { kind });
          this.recompute();
        },
      }, t(`cal.skip.${kind}` as Key)),
    );
  }

  private biasOrDark(kind: 'bias' | 'dark'): HTMLElement {
    const frames = state.framesOf(kind);
    const next: Sub = kind === 'bias' ? 'dark' : 'flat';
    if (frames.length === 0) {
      return h('div', { class: 'sub' }, renderWhy(kind), this.skip(kind), state.isDone(kind) ? this.next(next) : null);
    }
    const master = state.masters.get(masterId(kind));
    const exposures = [...new Set(frames.map((f) => f.meta.exposure))].map((e) => fmt(e, 3)).join(', ');
    const lights = state.framesOf('light');
    const lightExp = [...new Set(lights.map((f) => f.meta.exposure))].map((e) => fmt(e, 3)).join(', ');
    const temps = frames.map((f) => f.meta.temperature).filter((x): x is number => x !== undefined);

    return h('div', { class: 'sub' },
      renderWhy(kind),
      h('section', { class: 'phase' },
        h('h3', {}, t('phase.look')),
        h('p', {}, t(kind === 'bias' ? 'cal.biasLook' : 'cal.darkLook', { n: frames.length, exp: exposures })),
        kind === 'dark' && lights.length ? h('p', {}, t('cal.lightExposures', { exp: lightExp })) : null,
        kind === 'dark' && temps.length ? h('p', {}, t('cal.temperature', { t: fmt(temps.reduce((a, b) => a + b, 0) / temps.length, 1) })) : null,
        h('div', { class: 'buttons left' },
          h('button', { type: 'button', onclick: () => this.viewer.show(frames[0].meta.id, { tab: 'box' }) },
            t('cal.showFirst', { what: term(kind) })),
          frames.length > 1 ? h('button', { type: 'button', onclick: () => this.viewer.show(frames[1].meta.id, { tab: 'box' }) },
            t('cal.showSecond')) : null)),
      h('section', { class: 'phase' },
        h('h3', {}, t('phase.decide')),
        this.methodChoice(kind, frames.length),
        kind === 'dark' && state.masters.get(masterId('bias'))
          ? h('p', { class: 'hint' }, t('cal.darkMinusBias')) : null),
      h('section', { class: 'phase' },
        h('h3', {}, t('phase.do')),
        this.computeButton(kind, kind === 'bias' ? 'cal.computeBias' : 'cal.computeDark')),
      master ? h('section', { class: 'phase' },
        h('h3', {}, t('phase.check')),
        h('p', {}, t('cal.masterReady', { what: term(kind), n: master.count, method: t(`method.${master.method}` as Key).toLowerCase() })),
        h('div', { class: 'buttons left' },
          h('button', { type: 'button', onclick: () => this.viewer.show(master.id, { tab: 'box' }) }, t('cal.showMaster'))),
        h('p', { class: 'hint' }, t(kind === 'bias' ? 'cal.biasCheck' : 'cal.darkCheck'))) : null,
      renderTasks(tasksFor(kind)),
      state.isDone(kind) ? this.next(next) : null,
    );
  }

  // ------------------------------------------------------------- flat

  private flat(): HTMLElement {
    const filters = state.filtersOf('flat');
    if (filters.length === 0) {
      return h('div', { class: 'sub' }, renderWhy('flat'), this.skip('flat'), state.isDone('flat') ? this.next('apply') : null);
    }
    const darkMaster = state.masters.get(masterId('dark'));
    const lightFilters = new Set(state.filtersOf('light'));
    const flats = [...state.masters.values()].filter((m) => m.kind === 'flat');

    return h('div', { class: 'sub' },
      renderWhy('flat'),
      h('section', { class: 'phase' },
        h('h3', {}, t('phase.look')),
        h('p', {}, t('cal.flatLook')),
        h('table', { class: 'grid compact' },
          h('thead', {}, h('tr', {},
            h('th', {}, t('files.filter')), h('th', { class: 'num' }, t('cal.count')), h('th', { class: 'num' }, t('files.exposure')), h('th', {}, ''))),
          h('tbody', {}, filters.map((f) => {
            const frames = state.framesOf('flat', f);
            const exps = frames.map((x) => x.meta.exposure);
            return h('tr', {},
              h('th', { scope: 'row' }, f, lightFilters.has(f) ? '' : h('span', { class: 'badge', title: t('cal.noLightsTip') }, t('cal.noLights'))),
              h('td', { class: 'num' }, String(frames.length)),
              h('td', { class: 'num' }, `${fmt(Math.min(...exps), 1)}–${fmt(Math.max(...exps), 1)}`),
              h('td', {}, h('button', { type: 'button', onclick: () => this.viewer.show(frames[0].meta.id, { tab: 'box' }) }, t('cal.show'))));
          })))),
      h('section', { class: 'phase' },
        h('h3', {}, t('phase.decide')),
        this.methodChoice('flat', Math.min(...filters.map((f) => state.framesOf('flat', f).length))),
        h('label', { class: 'choice', title: darkMaster ? undefined : t('cal.darkForFlatsNoDark') },
          h('input', {
            type: 'checkbox',
            checked: state.settings.darkForFlats && !!darkMaster,
            disabled: !darkMaster,
            onchange: (e: Event) => state.updateSettings({ darkForFlats: (e.target as HTMLInputElement).checked }),
          }), ' ', t('cal.darkForFlats')),
        h('p', { class: 'hint' }, t('cal.darkForFlatsTip'))),
      h('section', { class: 'phase' },
        h('h3', {}, t('phase.do')),
        this.computeButton('flat', 'cal.computeFlat')),
      flats.length ? h('section', { class: 'phase' },
        h('h3', {}, t('phase.check')),
        h('p', {}, t('cal.flatLevels')),
        h('table', { class: 'grid compact' },
          h('thead', {}, h('tr', {},
            h('th', {}, t('files.filter')), h('th', { class: 'num' }, t('cal.count')),
            h('th', { class: 'num' }, t('cal.levelMin')), h('th', { class: 'num' }, t('cal.levelMax')), h('th', {}, ''))),
          h('tbody', {}, flats.map((m) => h('tr', {},
            h('th', { scope: 'row' }, m.filter),
            h('td', { class: 'num' }, String(m.count)),
            h('td', { class: 'num' }, fmt(Math.min(...m.levels!), 0)),
            h('td', { class: 'num' }, fmt(Math.max(...m.levels!), 0)),
            h('td', {}, h('button', { type: 'button', onclick: () => this.viewer.show(m.id, { tab: 'histogram' }) }, t('cal.show'))))))),
        h('p', { class: 'hint' }, t('cal.flatCheck'))) : null,
      renderTasks(tasksFor('flat')),
      state.isDone('flat') ? this.next('apply') : null,
    );
  }

  private next(sub: Sub): HTMLElement {
    return h('div', { class: 'next' }, h('button', { type: 'button', class: 'primary', onclick: () => this.go(sub) }, t('cal.next', { what: t(SUB_LABEL[sub]) })));
  }

  // ------------------------------------------------------------- apply

  private apply(): HTMLElement {
    const lights = state.framesOf('light');
    if (lights.length === 0) return h('div', { class: 'sub' }, renderWhy('calibrate'), h('p', { class: 'warning' }, t('cal.noLightFrames')));
    const s = state.settings;
    const has = { bias: state.masters.has(masterId('bias')), dark: state.masters.has(masterId('dark')) };
    const flatFilters = new Set([...state.masters.values()].filter((m) => m.kind === 'flat').map((m) => m.filter));
    const done = state.isDone('calibrate');
    const exps = [...new Set(lights.map((f) => f.meta.exposure))];
    const scale = darkScale(exps[0]);

    const toggle = (key: 'useBias' | 'useDark' | 'useFlat', label: Key, available: boolean) =>
      h('label', { class: 'choice', title: available ? undefined : t('cal.noMaster') },
        h('input', {
          type: 'checkbox',
          checked: s[key] && available,
          disabled: !available || this.busy,
          onchange: (e: Event) => {
            state.updateSettings({ [key]: (e.target as HTMLInputElement).checked });
            if (done) {
              state.addLog('calibrate', 'switched', { what: label, on: (e.target as HTMLInputElement).checked ? 'on' : 'off' });
              this.recompute();
            }
          },
        }), ' ', t(label));

    const parts = [
      t('formula.light'),
      s.useBias && has.bias ? ` − ${t('formula.bias')}` : '',
      s.useDark && has.dark ? ` − ${scale === 1 ? '' : fmt(scale, 3) + ' × '}${t('formula.dark')}` : '',
    ].join('');
    const formula = s.useFlat && flatFilters.size ? `(${parts}) / ${t('formula.flat')}` : parts;

    return h('div', { class: 'sub' },
      renderWhy('calibrate'),
      h('section', { class: 'phase' },
        h('h3', {}, t('phase.look')),
        h('p', {}, t('cal.applyLook', { n: lights.length, exp: exps.map((e) => fmt(e, 3)).join(', ') })),
        h('div', { class: 'buttons left' },
          h('button', { type: 'button', onclick: () => this.viewer.show(lights[0].meta.id, { tab: 'histogram' }) }, t('cal.showRawLight')))),
      h('section', { class: 'phase' },
        h('h3', {}, t('phase.decide')),
        h('p', {}, t('cal.applyDecide')),
        toggle('useBias', 'cal.useBias', has.bias),
        toggle('useDark', 'cal.useDark', has.dark),
        toggle('useFlat', 'cal.useFlat', flatFilters.size > 0),
        h('pre', { class: 'formula' }, `${t('formula.result')} = ${formula}`),
        has.dark && scale !== 1 ? h('p', { class: 'hint' }, t('cal.darkScaled', { scale: fmt(scale, 3) })) : null,
        has.dark && !has.bias ? h('p', { class: 'hint' }, t('cal.darkWithBias')) : null,
        s.useFlat ? lights.filter((f) => !flatFilters.has(f.meta.filter)).slice(0, 1).map((f) =>
          h('p', { class: 'warning' }, t('cal.noFlatFor', { filter: f.meta.filter || '–' }))) : null),
      h('section', { class: 'phase' },
        h('h3', {}, t('phase.do')),
        h('button', {
          type: 'button',
          class: 'primary',
          disabled: this.busy || hasErrors(),
          onclick: () => this.later(() => {
            state.setStep('calibrate', { done: true });
            refreshAll();
            state.addLog('calibrate', 'calibrated', { n: state.calibrated.size, bias: String(s.useBias && has.bias), dark: String(s.useDark && has.dark), flat: String(s.useFlat && flatFilters.size > 0) });
            const first = lights[0].meta.id;
            if (state.calibrated.has(first)) this.viewer.show(`cal:${first}`, { tab: 'histogram' });
          }),
        }, this.busy ? t('cal.computing') : done ? t('cal.recalibrate') : t('cal.calibrate', { n: lights.length }))),
      done ? h('section', { class: 'phase' },
        h('h3', {}, t('phase.check')),
        h('p', {}, t('cal.applyCheck')),
        h('table', { class: 'grid compact' },
          h('thead', {}, h('tr', {}, h('th', {}, t('files.filter')), h('th', {}, t('files.name')), h('th', {}, ''), h('th', {}, ''))),
          h('tbody', {}, lights.map((f) => h('tr', {},
            h('td', {}, f.meta.filter),
            h('td', { class: 'name' }, f.meta.fileName),
            h('td', {}, h('button', { type: 'button', onclick: () => this.viewer.show(f.meta.id) }, t('cal.raw'))),
            h('td', {}, h('button', { type: 'button', onclick: () => this.viewer.show(`cal:${f.meta.id}`) }, t('cal.calibratedShort')))))))) : null,
      renderTasks(tasksFor('calibrate')),
      done ? h('div', { class: 'next' },
        h('p', { class: 'ok' }, t('cal.allDone')),
        h('button', { type: 'button', class: 'primary', onclick: () => this.toAlign() }, t('cal.next', { what: t('step.align') }))) : null,
    );
  }
}
