// Step 4: colour. The student maps the stacked filter images to the red, green and blue channels,
// then sets the black and white points, the colour balance and the stretch (§3.4). The second
// part saves the colour image as PNG and the masters and stacks as FITS (§3.5).

import {
  autoBlack, background, backgroundLevels, CHANNELS, compositionName, DEFAULT_STRENGTH, initialChannel,
  newComposition, render as renderColor, wavelengthOrder,
} from '../color';
import { h } from '../dom';
import { exportBase, type FitsExport, fitsBytes, fitsExports, fitsZip, pngBytes } from '../export';
import { Cancelled, saveFile } from '../fileio';
import { bottomUp, type FitsImage } from '../fits';
import { type Key, t } from '../i18n';
import { filterInfo } from '../instrument/profile';
import { stackImage } from '../stack';
import { state } from '../state';
import { finite } from '../stats';
import { tasksFor } from '../tasks';
import { asinhScale, createPlotCanvas, drawPlot } from '../tools/plot';
import type { Channel, ChannelSettings, Composition } from '../types';
import { renderComments } from './comments';
import { renderWhy } from './explain';
import type { ColorSub } from './resume';
import { renderTasks } from './task';
import { colorTitle, masterTitle, stackTitle, type ViewerPanel } from './viewerpanel';

type Sub = ColorSub;
const SUBS: Sub[] = ['compose', 'export'];
const SUB_LABEL: Record<Sub, Key> = { compose: 'color.compose', export: 'color.export' };

const PNG = { description: 'PNG', accept: { 'image/png': ['.png'] } };
const FITS = { description: 'FITS', accept: { 'application/fits': ['.fits'] } };
const ZIP = { description: 'Zip', accept: { 'application/zip': ['.zip'] } };

/** Slider positions run from 0 to this. */
const STEPS = 1000;
const HIST_HEIGHT = 140;
const HIST_BINS = 200;

/** Background levels (0–255) closer than this count as neutral grey. */
const NEUTRAL = 4;

const sortedCache = new WeakMap<Float32Array, Float32Array>();

function sorted(img: FitsImage): Float32Array {
  let s = sortedCache.get(img.data);
  if (!s) {
    s = finite(img.data).sort();
    sortedCache.set(img.data, s);
  }
  return s;
}

/** Number input text: a few significant digits, with a decimal point as inputs expect. */
function inputValue(v: number): string {
  return String(Number(v.toPrecision(5)));
}

interface Slider {
  label: string;
  value: number;
  toPos(v: number): number;
  fromPos(p: number): number;
  set(v: number): void;
  tip?: string;
  extra?: HTMLElement;
}

export class ColorStep {
  readonly element = h('section', { class: 'step-panel color-step' });
  private sub: Sub = 'compose';
  private compId: string | null = null;
  private active = false;
  private busy = false;
  private error: string | null = null;
  private message: string | null = null;
  private scale: 1 | 2 = 1;
  /** Set while a slider changes the composition: the panel is not rebuilt under the pointer. */
  private quiet = false;
  /** Updates the histograms and checks after a slider moved. */
  private live: (() => void)[] = [];

  constructor(private viewer: ViewerPanel) {
    state.on((kind) => {
      if (!this.active || (kind === 'compositions' && this.quiet)) return;
      if (kind === 'steps' || kind === 'stacks' || kind === 'compositions' || kind === 'profile') this.render();
    });
  }

  setActive(active: boolean): void {
    this.active = active;
    if (!active) return;
    // The first visit starts an empty colour image; the student chooses its filters
    if (!state.compositions.length) state.addComposition(newComposition(state.newCompositionId()));
    this.render();
    const c = this.current();
    if (c && this.sub === 'compose') this.show(c);
  }

  open(sub: Sub): void {
    this.sub = sub;
    this.error = null;
    this.message = null;
  }

  private current(): Composition | undefined {
    return state.compositions.find((c) => c.id === this.compId) ?? state.compositions[0];
  }

  private go(sub: Sub): void {
    this.sub = sub;
    this.error = null;
    this.message = null;
    this.render();
    this.element.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  private ready(c: Composition | undefined): boolean {
    return !!c && CHANNELS.some((ch) => stackImage(c.channels[ch].filter));
  }

  render(): void {
    this.live = [];
    const c = this.current();
    this.compId = c?.id ?? null;
    this.element.replaceChildren(h('div', {},
      h('h2', {}, t('step.color')),
      h('nav', { class: 'subtabs', 'aria-label': t('step.color') },
        SUBS.map((s, i) => h('button', {
          type: 'button',
          class: s === this.sub ? 'active' : '',
          'aria-current': s === this.sub ? 'step' : undefined,
          onclick: () => this.go(s),
        }, `${i + 1}. ${t(SUB_LABEL[s])}`, s === 'export' && state.isDone('color') ? ' ✓' : ''))),
      this.error ? h('p', { class: 'error', role: 'alert' }, this.error) : null,
      this.message ? h('p', { class: 'ok', role: 'status' }, this.message) : null,
      renderComments('step:color'),
      this.sub === 'compose' ? this.compose(c) : this.exports(c),
    ));
  }

  private show(c: Composition): void {
    if (this.ready(c)) this.viewer.show(`color:${c.id}`, { tab: 'pixel' });
  }

  /** Changes the current composition without rebuilding the panel, then updates the live parts. */
  private quietly(patch: Partial<Composition>): void {
    const c = this.current();
    if (!c) return;
    this.quiet = true;
    try {
      state.updateComposition(c.id, patch);
    } finally {
      this.quiet = false;
    }
    for (const fn of this.live) fn();
  }

  private setChannel(ch: Channel, patch: Partial<ChannelSettings>, quiet = true): void {
    const c = this.current()!;
    const channels = { ...c.channels, [ch]: { ...c.channels[ch], ...patch } };
    if (quiet) this.quietly({ channels });
    else state.updateComposition(c.id, { channels });
  }

  // ------------------------------------------------------------- 1. colour image

  private compose(c: Composition | undefined): HTMLElement {
    const stacks = [...state.stacks.values()];
    if (!c || !stacks.length) return h('div', { class: 'sub' }, renderWhy('color'), h('p', { class: 'warning' }, t('color.noStacks')));
    const wavelength = (f: string) => (state.profile ? filterInfo(state.profile, f)?.wavelengthNm : undefined);
    const ready = this.ready(c);

    return h('div', { class: 'sub' },
      renderWhy('color'),
      h('section', { class: 'phase' },
        h('h3', {}, t('phase.look')),
        h('p', {}, t('color.look')),
        h('table', { class: 'grid compact' },
          h('thead', {}, h('tr', {}, h('th', {}, t('files.filter')), h('th', { class: 'num' }, t('color.wavelength')), h('th', {}, t('color.system')), h('th', {}, ''))),
          h('tbody', {}, stacks.map((s) => {
            const info = state.profile ? filterInfo(state.profile, s.filter) : undefined;
            return h('tr', {},
              h('th', { scope: 'row' }, s.filter || '–'),
              h('td', { class: 'num' }, info ? `${info.wavelengthNm} nm` : '?'),
              h('td', {}, info?.system ?? t('color.unknownFilter')),
              h('td', {}, h('button', { type: 'button', onclick: () => this.viewer.show(s.id, { tab: 'histogram' }), title: stackTitle(s.id) }, t('cal.show'))));
          })))),
      h('section', { class: 'phase' },
        h('h3', {}, t('phase.decide')),
        this.chooser(c),
        h('p', {}, t('color.mapping')),
        h('div', { class: 'channel-map' }, CHANNELS.map((ch) => h('label', { class: `inline channel-${ch}` },
          h('span', { class: 'swatch', 'aria-hidden': 'true' }), t(`color.ch.${ch}` as Key), ' ',
          h('select', {
            onchange: (e: Event) => {
              const v = (e.target as HTMLSelectElement).value;
              const filter = v === '' ? null : v;
              const old = compositionName(c);
              this.setChannel(ch, initialChannel(filter, stackImage(filter)), false);
              // The name follows the filters until the student gives it one
              if (!c.name || c.name === old) state.updateComposition(c.id, { name: compositionName(c) });
              this.show(c);
            },
          },
          h('option', { value: '', selected: c.channels[ch].filter === null }, '–'),
          stacks.map((s) => {
            const nm = wavelength(s.filter);
            return h('option', { value: s.filter, selected: s.filter === c.channels[ch].filter }, `${s.filter}${nm ? ` (${nm} nm)` : ''}`);
          }))))),
        this.orderCheck(c)),
      ready ? this.adjust(c) : null,
      ready ? this.check() : null,
      renderTasks(tasksFor('color')),
      ready ? h('div', { class: 'next' }, h('button', { type: 'button', class: 'primary', onclick: () => this.go('export') }, t('cal.next', { what: t('color.export') }))) : null,
    );
  }

  /** Several colour images: pick one, add, rename and remove. */
  private chooser(c: Composition): HTMLElement {
    const list = state.compositions;
    return h('div', { class: 'composition-bar' },
      list.length > 1 ? h('div', { class: 'segmented', role: 'group', 'aria-label': t('color.images') },
        list.map((x) => h('button', {
          type: 'button',
          class: x === c ? 'active' : '',
          'aria-pressed': String(x === c),
          onclick: () => {
            this.compId = x.id;
            this.render();
            this.show(x);
          },
        }, x.name || compositionName(x)))) : null,
      h('label', { class: 'inline' }, t('color.name'), ' ',
        h('input', {
          type: 'text',
          value: c.name,
          placeholder: compositionName(c),
          onchange: (e: Event) => state.updateComposition(c.id, { name: (e.target as HTMLInputElement).value.trim() }),
        })),
      h('button', {
        type: 'button',
        title: t('color.addTip'),
        onclick: () => {
          const n = newComposition(state.newCompositionId());
          this.compId = n.id;
          state.addComposition(n);
        },
      }, t('color.add')),
      list.length > 1 ? h('button', {
        type: 'button',
        class: 'danger',
        onclick: () => {
          if (!confirm(t('color.removeConfirm', { name: c.name || compositionName(c) }))) return;
          this.compId = null;
          state.removeComposition(c.id);
        },
      }, t('color.remove')) : null);
  }

  private orderCheck(c: Composition): HTMLElement | null {
    const order = wavelengthOrder(c, state.profile);
    if (order === 'incomplete' && CHANNELS.every((ch) => c.channels[ch].filter === null)) return null;
    const cls = order === 'ordered' ? 'ok' : order === 'unknown' || order === 'incomplete' ? 'hint' : 'warning';
    return h('p', { class: cls }, t(`color.order.${order}` as Key));
  }

  private adjust(c: Composition): HTMLElement {
    const asinh = c.stretch.type === 'asinh';
    const stretch = (type: 'linear' | 'asinh', label: Key, tip: Key) => h('label', { class: 'choice' },
      h('input', {
        type: 'radio',
        name: 'stretch',
        checked: c.stretch.type === type,
        onchange: () => state.updateComposition(c.id, { stretch: { ...c.stretch, type } }),
      }), ' ', h('strong', {}, t(label)), ' – ', t(tip));

    return h('section', { class: 'phase' },
      h('h3', {}, t('phase.do')),
      h('p', {}, t('color.adjust')),
      CHANNELS.map((ch) => this.channelControls(c, ch)),
      h('fieldset', { class: 'methods' },
        h('legend', {}, t('color.stretch')),
        stretch('linear', 'color.linear', 'color.linearTip'),
        stretch('asinh', 'color.asinh', 'color.asinhTip'),
        asinh ? this.slider({
          label: t('color.strength'),
          tip: t('color.strengthTip'),
          value: c.stretch.strength,
          toPos: (v) => (Math.log10(Math.max(1, v)) / 3) * STEPS,
          fromPos: (p) => Number((10 ** ((3 * p) / STEPS)).toPrecision(2)),
          set: (v) => this.quietly({ stretch: { type: 'asinh', strength: Math.max(0.1, v || DEFAULT_STRENGTH) } }),
        }) : null),
      h('div', { class: 'buttons left' }, h('button', { type: 'button', onclick: () => this.show(c) }, t('color.showImage'))));
  }

  /** Black point, white point and weight of one channel, with its histogram. */
  private channelControls(c: Composition, ch: Channel): HTMLElement | null {
    const s = c.channels[ch];
    const img = stackImage(s.filter);
    if (!img) return null;
    const b = background(img);
    const noise = Math.max(b.noise, 1e-6);
    // Black: linear, from well below the background (a lighter sky) to well above it
    const lo = Math.min(b.min, s.black, b.median - 50 * noise);
    const hi = Math.max(b.median + 20 * noise, s.black);
    // White: logarithmic distance above the background, so faint and bright settings both fit
    const near = 3 * noise;
    const far = Math.max(b.max - b.median, s.white - b.median, 10 * near);
    const span = Math.log(far / near);
    const cur = () => this.current()!.channels[ch];

    const hist = this.histogram(img, () => cur());
    return h('fieldset', { class: `channel channel-${ch}` },
      h('legend', {}, h('span', { class: 'swatch', 'aria-hidden': 'true' }), t(`color.ch.${ch}` as Key), ': ', s.filter ?? '–'),
      this.slider({
        label: t('color.black'),
        tip: t('color.blackTip'),
        value: s.black,
        toPos: (v) => ((v - lo) / (hi - lo)) * STEPS,
        fromPos: (p) => lo + (p / STEPS) * (hi - lo),
        set: (v) => this.setChannel(ch, { black: Math.min(v, cur().white - noise / 10) }),
        extra: h('button', {
          type: 'button',
          title: t('color.autoTip'),
          onclick: () => {
            this.setChannel(ch, { black: autoBlack(img, cur(), this.current()!.stretch) }, false);
            this.show(c);
          },
        }, t('color.auto')),
      }),
      this.slider({
        label: t('color.white'),
        tip: t('color.whiteTip'),
        value: s.white,
        toPos: (v) => (v - b.median <= near ? 0 : (Math.log((v - b.median) / near) / span) * STEPS),
        fromPos: (p) => b.median + near * Math.exp((p / STEPS) * span),
        set: (v) => this.setChannel(ch, { white: Math.max(v, cur().black + noise / 10) }),
      }),
      this.slider({
        label: t('color.weight'),
        tip: t('color.weightTip'),
        value: s.weight,
        toPos: (v) => (v / 3) * STEPS,
        fromPos: (p) => Number(((3 * p) / STEPS).toFixed(2)),
        set: (v) => this.setChannel(ch, { weight: Math.max(0, v) }),
      }),
      hist);
  }

  /** A range slider with a number field; both change the value live. */
  private slider(o: Slider): HTMLElement {
    const clampPos = (v: number) => String(Math.round(Math.min(STEPS, Math.max(0, o.toPos(v)))));
    const range = h('input', { type: 'range', min: '0', max: String(STEPS), step: '1', value: clampPos(o.value), 'aria-label': o.label });
    const num = h('input', { type: 'number', step: 'any', value: inputValue(o.value), 'aria-label': o.label });
    range.addEventListener('input', () => {
      const v = o.fromPos(Number(range.value));
      num.value = inputValue(v);
      o.set(v);
    });
    num.addEventListener('change', () => {
      const v = Number(num.value);
      if (!Number.isFinite(v)) return;
      range.value = clampPos(v);
      o.set(v);
    });
    return h('div', { class: 'slider-row', title: o.tip }, h('span', { class: 'slider-label' }, o.label), range, num, o.extra);
  }

  /**
   * Histogram of a channel's stack from its faintest to its brightest pixel, on an asinh axis
   * around the background: the sky peak keeps its shape and the faint and bright tails both fit.
   */
  private histogram(img: FitsImage, settings: () => ChannelSettings): HTMLElement {
    const b = background(img);
    const v = sorted(img);
    const scale = asinhScale(b.median, 3 * Math.max(b.noise, 1e-6));
    const canvas = createPlotCanvas(HIST_HEIGHT);
    // The range follows the black and white points; the counts are recomputed only when it changes
    let key = '';
    let xs: number[] = [];
    let counts: number[] = [];
    const draw = () => {
      const cur = settings();
      const lo = scale.to(Math.min(b.min, cur.black));
      let hi = scale.to(Math.max(b.max, cur.white));
      if (!(hi > lo)) hi = lo + 1;
      if (key !== `${lo} ${hi}`) {
        key = `${lo} ${hi}`;
        const du = (hi - lo) / HIST_BINS;
        xs = Array.from({ length: HIST_BINS }, (_, i) => scale.from(lo + i * du));
        counts = new Array<number>(HIST_BINS).fill(0);
        // v is sorted, so one pass over the bin edges is enough
        let k = 0;
        for (const x of v) {
          while (k + 1 < HIST_BINS && x >= xs[k + 1]) k++;
          if (x >= xs[0]) counts[k]++;
        }
      }
      if (!canvas.isConnected || !canvas.clientWidth) return;
      drawPlot(canvas, xs, counts, {
        xLabel: t('axis.adu'),
        yLabel: t('axis.count'),
        style: 'steps',
        logY: true,
        xScale: scale,
        height: HIST_HEIGHT,
        markers: [{ x: cur.black, color: '#2e7d32' }, { x: cur.white, color: '#c62828' }],
      });
    };
    draw();
    requestAnimationFrame(draw);
    this.live.push(draw);
    const details = h('details', { class: 'channel-hist', open: true }, h('summary', {}, t('color.histogram')), canvas);
    // A closed panel has no width to draw in
    details.addEventListener('toggle', () => details.open && draw());
    return details;
  }

  private check(): HTMLElement {
    const out = h('div', {});
    const update = () => {
      const cur = this.current();
      if (!cur) return;
      const levels = backgroundLevels(cur, stackImage);
      const chans = CHANNELS.filter((ch) => levels[ch] !== undefined);
      const vals = chans.map((ch) => levels[ch]!);
      const max = Math.max(...vals);
      const min = Math.min(...vals);
      const strongest = chans[vals.indexOf(max)];
      const verdict = chans.length < 2 ? null
        : min > 60 ? h('p', { class: 'warning' }, t('color.bgBright'))
          : max - min <= Math.max(NEUTRAL, 0.15 * max) ? h('p', { class: 'ok' }, t('color.bgNeutral'))
            : h('p', { class: 'warning' }, t('color.bgTint', { tint: t(`color.tint.${strongest}` as Key) }));
      out.replaceChildren(h('p', {}, t('color.bgLevels', { levels: chans.map((ch) => `${ch} ${levels[ch]}`).join(' · ') })));
      if (verdict) out.append(verdict);
    };
    update();
    this.live.push(update);
    return h('section', { class: 'phase' },
      h('h3', {}, t('phase.check')),
      out,
      h('p', { class: 'hint' }, t('color.check')));
  }

  // ------------------------------------------------------------- 2. export

  private exports(c: Composition | undefined): HTMLElement {
    const files = fitsExports();
    const ready = this.ready(c);
    const scaleChoice = (s: 1 | 2, label: Key) => h('label', { class: 'choice' },
      h('input', { type: 'radio', name: 'png-scale', checked: this.scale === s, onchange: () => (this.scale = s) }),
      ' ', t(label));
    const rows = files.map((f) => h('tr', {},
      h('td', { class: 'name' }, f.fileName),
      h('td', {}, f.id.startsWith('stack:') ? stackTitle(f.id) : masterTitle(f.id)),
      h('td', { class: 'num' }, `${f.image.width} × ${f.image.height}`),
      h('td', {}, h('button', { type: 'button', disabled: this.busy, onclick: () => void this.saveFits([f]) }, t('color.save')))));

    return h('div', { class: 'sub' },
      h('section', { class: 'phase' },
        h('h3', {}, t('color.png')),
        ready ? [
          h('p', {}, t('color.pngText', { name: colorTitle(`color:${c!.id}`) })),
          h('fieldset', { class: 'methods' }, h('legend', {}, t('color.size')),
            scaleChoice(1, 'color.scale1'), scaleChoice(2, 'color.scale2')),
          h('div', { class: 'buttons left' },
            h('button', { type: 'button', class: 'primary', disabled: this.busy, onclick: () => void this.savePng(c!) }, t('color.savePng'))),
        ] : h('p', { class: 'warning' }, t('color.notReady'))),
      h('section', { class: 'phase' },
        h('h3', {}, t('color.fits')),
        h('p', {}, t('color.fitsText')),
        files.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'grid compact export-table' },
          h('thead', {}, h('tr', {}, h('th', {}, t('files.name')), h('th', {}, t('color.contents')), h('th', { class: 'num' }, t('color.pixels')), h('th', {}, ''))),
          h('tbody', {}, rows))) : h('p', { class: 'hint' }, t('color.noFits')),
        files.length > 1 ? h('div', { class: 'buttons left' },
          h('button', { type: 'button', disabled: this.busy, onclick: () => void this.saveFits(files) }, t('color.saveAll', { n: files.length }))) : null),
    );
  }

  private async run(fn: () => Promise<void>): Promise<void> {
    this.busy = true;
    this.error = null;
    this.message = null;
    this.render();
    try {
      await fn();
    } catch (e) {
      if (!(e instanceof Cancelled)) this.error = t('color.saveFailed', { detail: String(e) });
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private savePng(c: Composition): Promise<void> {
    return this.run(async () => {
      const img = renderColor(c, stackImage);
      const first = CHANNELS.map((ch) => stackImage(c.channels[ch].filter)).find(Boolean);
      if (!img || !first) return;
      const name = c.name || compositionName(c);
      const bytes = await pngBytes(img, bottomUp(first), this.scale);
      const file = `${exportBase()}-${name.replace(/[^\w.-]+/g, '_')}${this.scale === 2 ? '-2x' : ''}.png`;
      await saveFile(bytes, file, PNG, null);
      state.setStep('color', { done: true });
      state.addLog('color', 'pngSaved', { name, scale: this.scale });
      this.message = t('color.saved', { file });
    });
  }

  private saveFits(files: FitsExport[]): Promise<void> {
    return this.run(async () => {
      const one = files.length === 1;
      const file = one ? files[0].fileName : `${exportBase()}-fits.zip`;
      await saveFile(one ? fitsBytes(files[0]) : fitsZip(files), file, one ? FITS : ZIP, null);
      state.addLog('color', 'fitsSaved', { n: files.length });
      this.message = t('color.saved', { file });
    });
  }
}
