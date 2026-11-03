// Image viewer with toolbar, pixel readout and the measuring tool tabs.

import { CHANNELS, compositionName, render as renderColor } from '../color';
import { h } from '../dom';
import { bottomUp } from '../fits';
import { fmt, type Key, t } from '../i18n';
import { term } from '../i18n/glossary';
import { QUICK_ID, quickLook, quickLookFrames, renderQuickLook } from '../quicklook';
import { DISPLAY_SCALES, displayRange, finite } from '../stats';
import { stackImage } from '../stack';
import { state } from '../state';
import { renderBoxStats } from '../tools/boxstats';
import { type HistogramChange, renderHistogram } from '../tools/histogram';
import { renderProfile } from '../tools/profile';
import { type DisplayScale, KINDS, type RangeMode, type ReportSnapshot } from '../types';
import { type Marker, type ProfileAxis, type Tool, Viewer } from '../viewer';
import { CompareTool } from './compare';
import { HeightGrip } from './heightgrip';
import { renderHeader } from './header';

export type Tab = 'pixel' | 'profile' | 'box' | 'histogram' | 'compare' | 'header';

const TABS: { id: Tab; label: Key; tool: Tool }[] = [
  { id: 'pixel', label: 'tab.pixel', tool: 'pixel' },
  { id: 'profile', label: 'tab.profile', tool: 'profile' },
  { id: 'box', label: 'tab.box', tool: 'box' },
  { id: 'histogram', label: 'tab.histogram', tool: 'pixel' },
  { id: 'compare', label: 'tab.compare', tool: 'pixel' },
  { id: 'header', label: 'tab.header', tool: 'pixel' },
];

export interface ShowOptions {
  tab?: Tab;
  profile?: { axis: ProfileAxis; index: number | null };
}

/** Lets a step take clicks on the image, e.g. to mark stars, and draw markers. */
export interface Picker {
  /** Markers for the image with this id. */
  markers(id: string): Marker[];
  /** A click on the image with this id, in 0-based image coordinates. Undefined = only markers. */
  pick?(id: string, x: number, y: number): void;
  /** Shown on the pixel tab, for the image with this id. */
  hint?(id: string | null): string;
}

/** A readable name for a master id, e.g. "koondtasaväljakaader g". */
export function masterTitle(id: string): string {
  const m = state.masters.get(id);
  if (!m) return id;
  return t('master.title', { kind: term(m.kind), filter: m.filter ? ' ' + m.filter : '' });
}

/** E.g. "värvipilt BVR". */
export function colorTitle(id: string): string {
  if (id === QUICK_ID) return t('quick.title');
  const c = state.composition(id);
  return c ? t('color.title', { name: c.name || compositionName(c) }) : id;
}

/** E.g. "liidetud pilt g". */
export function stackTitle(id: string): string {
  const st = state.stacks.get(id);
  return st ? t('stack.title', { filter: st.filter || '–' }) : id;
}

export class ViewerPanel {
  readonly element = h('section', { class: 'viewer-panel' });
  private viewer: Viewer;
  private tab: Tab = 'pixel';
  private rangeMode: RangeMode = 'minmax';
  private black = 0;
  private white = 1;
  private scale: DisplayScale = 'linear';
  private hist = { useBox: false, log: false, range: 'full' as 'full' | 'clipped' };
  private headerFilter = '';
  private readout = h('div', { class: 'readout', 'aria-live': 'off' });
  private grip: HeightGrip;
  private zoomLabel = h('span', { class: 'zoom-label' });
  private toolArea = h('div', { class: 'tool-area' });
  private sortedCache = new WeakMap<Float32Array, Float32Array>();
  private shownData: Float32Array | null = null;
  private picker: Picker | null = null;
  private colorPending = false;
  private compare: CompareTool;
  private reportStatus = h('span', { class: 'report-status', role: 'status' });
  private statusTimer: number | undefined;

  constructor() {
    this.viewer = new Viewer({
      hover: (p) => this.showReadout(p),
      profile: () => this.renderTool(),
      box: (box) => {
        if (box) this.hist.useBox = true;
        this.renderTool();
      },
      zoom: (s) => (this.zoomLabel.textContent = `${fmt(s * 100, 0)} %`),
      pick: (p) => {
        if (state.selectedId) this.picker?.pick?.(state.selectedId, p.x, p.y);
      },
    });
    this.compare = new CompareTool(this.viewer);
    this.grip = new HeightGrip(this.viewer.element, this.element);
    state.on((kind) => {
      if (kind === 'selection' || kind === 'frames' || kind === 'masters' || kind === 'calibrated' || kind === 'aligned' || kind === 'stacks') this.showImage();
      if (kind === 'overlay' || kind === 'settings') this.updateOverlay();
      // Colour images follow their settings live, at most once per frame
      if ((kind === 'compositions' || kind === 'stacks') && state.composition(state.selectedId)) this.scheduleColor();
    });
    this.render();
  }

  /** Shows an image, optionally on a given tab and profile line. */
  show(id: string, opt: ShowOptions = {}): void {
    if (opt.tab) this.tab = opt.tab;
    state.select(id);
    this.showImage();
    if (opt.profile) this.viewer.setProfile(opt.profile.axis, opt.profile.index);
    this.render();
    this.element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /** Starts or stops taking clicks and drawing markers. */
  setPicker(picker: Picker | null): void {
    this.picker = picker;
    this.updateOverlay();
    this.render();
  }

  /** Redraws the markers, e.g. after a star was added. */
  updateMarkers(): void {
    this.viewer.setMarkers(this.picker && state.selectedId ? this.picker.markers(state.selectedId) : []);
  }

  private scheduleColor(): void {
    if (this.colorPending) return;
    this.colorPending = true;
    requestAnimationFrame(() => {
      this.colorPending = false;
      if (state.composition(state.selectedId)) this.showImage();
    });
  }

  private isColor(): boolean {
    return !!state.composition(state.selectedId) || state.selectedId === QUICK_ID;
  }

  /** Tabs of the image shown: a colour image has the pixel readout and the comparison with the quick look. */
  private tabs(): typeof TABS {
    if (state.selectedId === QUICK_ID) return TABS.filter((x) => x.id === 'pixel');
    if (this.isColor()) return TABS.filter((x) => x.id === 'pixel' || x.id === 'compare');
    return TABS;
  }

  private shownTab(): Tab {
    return this.tabs().some((x) => x.id === this.tab) ? this.tab : 'pixel';
  }

  private tool(): Tool {
    if (this.shownTab() === 'pixel' && this.picker?.pick) return 'pick';
    return TABS.find((x) => x.id === this.shownTab())!.tool;
  }

  /** Rebuilds the controls, e.g. after a language change. The canvas is kept. */
  render(): void {
    this.element.replaceChildren(
      h('div', { class: 'viewer-head' }, this.imageSelect(), this.addButton(() => this.imageSnapshot(), 'report.addImageTip'), this.reportStatus),
      this.toolbar(),
      this.viewer.element,
      this.grip.element,
      this.readout,
      h('div', { class: 'tabs', role: 'tablist' },
        this.tabs().map((tab) => h('button', {
          type: 'button',
          role: 'tab',
          class: tab.id === this.shownTab() ? 'active' : '',
          'aria-selected': String(tab.id === this.shownTab()),
          onclick: () => this.setTab(tab.id),
        }, t(tab.label)))),
      this.toolArea,
    );
    this.grip.render();
    this.viewer.setTool(this.tool());
    this.compare.setActive(this.shownTab() === 'compare');
    this.showReadout(null);
    this.renderTool();
  }

  /** A "Lisa aruandesse" button; disabled when there is nothing to add. */
  private addButton(snapshot: () => ReportSnapshot | null, tip: Key): HTMLElement | null {
    if (!state.selectedId || (!state.viewable(state.selectedId) && !this.isColor())) return null;
    return h('button', {
      type: 'button',
      class: 'small add-report',
      title: t(tip),
      onclick: () => {
        const s = snapshot();
        if (!s) return;
        state.addReportItem({ snapshot: s, caption: '' });
        this.reportStatus.textContent = t('report.added');
        clearTimeout(this.statusTimer);
        this.statusTimer = window.setTimeout(() => (this.reportStatus.textContent = ''), 3000);
      },
    }, t('report.add'));
  }

  /** The image as shown: display range, zoomed part and the measuring marks of the open tab. */
  private imageSnapshot(): ReportSnapshot | null {
    const id = state.selectedId;
    if (!id) return null;
    const view = this.viewer.visibleRegion();
    const c = state.composition(id);
    if (c) return { type: 'color', composition: structuredClone(c), view };
    if (id === QUICK_ID) {
      const q = quickLook();
      return q && { type: 'quickLook', frames: { R: q.frames.R.meta.id, G: q.frames.G.meta.id, B: q.frames.B.meta.id }, view };
    }
    const p = this.viewer.getProfile();
    const box = this.viewer.getBox();
    return {
      type: 'image',
      imageId: id,
      range: { mode: this.rangeMode, black: this.black, white: this.white, scale: this.scale },
      view,
      box: this.tab === 'box' || (this.tab === 'histogram' && this.hist.useBox) ? box : null,
      line: this.tab === 'profile' && p.index !== null ? { axis: p.axis, index: p.index } : null,
    };
  }

  private imageSelect(): HTMLElement {
    if (state.frames.length === 0) return h('h2', {}, t('viewer.title'));
    const groups: HTMLElement[] = [];
    const colors = state.compositions.filter((c) => CHANNELS.some((ch) => stackImage(c.channels[ch].filter))).map((c) => `color:${c.id}`);
    if (quickLookFrames()) colors.push(QUICK_ID);
    if (colors.length) {
      groups.push(h('optgroup', { label: t('viewer.colors') },
        colors.map((id) => h('option', { value: id, selected: id === state.selectedId }, colorTitle(id)))));
    }
    if (state.masters.size) {
      groups.push(h('optgroup', { label: t('viewer.masters') },
        [...state.masters.keys()].map((id) => h('option', { value: id, selected: id === state.selectedId }, masterTitle(id)))));
    }
    const lightGroup = (label: Key, prefix: string, has: (id: string) => boolean) => {
      const frames = state.framesOf('light').filter((f) => has(f.meta.id));
      if (!frames.length) return;
      groups.push(h('optgroup', { label: t(label) }, frames.map((f) => {
        const id = `${prefix}${f.meta.id}`;
        return h('option', { value: id, selected: id === state.selectedId }, `${f.meta.filter ? f.meta.filter + ' · ' : ''}${f.meta.fileName}`);
      })));
    };
    if (state.stacks.size) {
      groups.push(h('optgroup', { label: t('viewer.stacks') },
        [...state.stacks.values()].map((st) => h('option', { value: st.id, selected: st.id === state.selectedId }, stackTitle(st.id)))));
    }
    lightGroup('viewer.aligned', 'aligned:', (id) => state.aligned.has(id));
    lightGroup('viewer.calibrated', 'cal:', (id) => state.calibrated.has(id));
    for (const kind of KINDS) {
      const frames = state.frames.filter((f) => f.meta.kind === kind);
      if (!frames.length) continue;
      groups.push(h('optgroup', { label: term(kind) },
        frames.map((f) => h('option', { value: f.meta.id, selected: f.meta.id === state.selectedId },
          `${f.meta.filter ? f.meta.filter + ' · ' : ''}${f.meta.fileName}`))));
    }
    // Back and forward go through the group of the image shown, e.g. all calibrated lights
    const group = groups.find((g) => [...g.children].some((o) => (o as HTMLOptionElement).value === state.selectedId));
    const ids = group ? [...group.children].map((o) => (o as HTMLOptionElement).value) : [];
    const i = ids.indexOf(state.selectedId ?? '');
    const stepButton = (d: number, text: string, label: Key) => h('button', {
      type: 'button',
      class: 'icon',
      title: t(label),
      'aria-label': t(label),
      'data-step': String(d),
      disabled: i < 0 || !ids[i + d],
      onclick: () => {
        state.select(ids[i + d]);
        // The controls were rebuilt: keep the focus for pressing again
        this.element.querySelector<HTMLButtonElement>(`.image-select button[data-step="${d}"]`)?.focus();
      },
    }, text);
    return h('div', { class: 'image-select' },
      stepButton(-1, '‹', 'viewer.prev'),
      h('label', {}, h('span', { class: 'sr-only' }, t('viewer.choose')),
        h('select', {
          onchange: (e: Event) => state.select((e.target as HTMLSelectElement).value),
        },
        state.selectedId ? null : h('option', { value: '', selected: true }, t('viewer.choose')),
        groups)),
      stepButton(1, '›', 'viewer.next'));
  }

  private toolbar(): HTMLElement {
    const manual = this.rangeMode === 'manual';
    const numberInput = (value: number, onChange: (v: number) => void, label: Key) =>
      h('label', { class: 'inline' }, t(label), ' ',
        h('input', {
          type: 'number',
          step: 'any',
          value: String(Math.round(value * 1000) / 1000),
          disabled: !manual,
          onchange: (e: Event) => {
            const v = Number((e.target as HTMLInputElement).value);
            if (Number.isFinite(v)) onChange(v);
          },
        }));
    const select = h('select', {
      'aria-label': t('display.range'),
      onchange: (e: Event) => {
        this.rangeMode = (e.target as HTMLSelectElement).value as RangeMode;
        this.updateRange();
        this.viewer.setRange(this.black, this.white, this.scale);
        this.render();
      },
    }, (['minmax', 'p999', 'p995', 'p99', 'manual'] as RangeMode[]).map((m) =>
      h('option', { value: m, selected: m === this.rangeMode }, t(`display.${m}` as Key))));
    const scale = h('select', {
      'aria-label': t('display.scale'),
      onchange: (e: Event) => {
        this.scale = (e.target as HTMLSelectElement).value as DisplayScale;
        this.applyRange();
      },
    }, DISPLAY_SCALES.map((m) => h('option', { value: m, selected: m === this.scale }, t(`display.scale.${m}` as Key))));

    const zoom = h('div', { class: 'segmented', role: 'group', 'aria-label': t('zoom.label') },
        h('button', { type: 'button', title: t('zoom.fitTip'), onclick: () => this.viewer.fit() }, t('zoom.fit')),
        h('button', { type: 'button', title: t('zoom.oneTip'), onclick: () => this.viewer.zoomTo(1) }, '1:1'),
        h('button', { type: 'button', 'aria-label': t('zoom.out'), onclick: () => this.viewer.zoomBy(1 / 2) }, '−'),
        h('button', { type: 'button', 'aria-label': t('zoom.in'), onclick: () => this.viewer.zoomBy(2) }, '+'),
    );
    // A colour image has its black and white points in the colour step
    if (this.isColor()) return h('div', { class: 'toolbar' }, zoom, this.zoomLabel);
    return h('div', { class: 'toolbar' },
      zoom,
      this.zoomLabel,
      h('label', { class: 'inline', title: t('display.tip') }, t('display.range'), ' ', select),
      numberInput(this.black, (v) => { this.black = v; this.applyRange(); }, 'display.black'),
      numberInput(this.white, (v) => { this.white = v; this.applyRange(); }, 'display.white'),
      h('label', { class: 'inline', title: t('display.scaleTip') }, t('display.scale'), ' ', scale),
    );
  }

  private setTab(tab: Tab): void {
    this.tab = tab;
    this.render();
  }

  private sorted(data: Float32Array): Float32Array {
    let s = this.sortedCache.get(data);
    if (!s) {
      s = finite(data).sort();
      this.sortedCache.set(data, s);
    }
    return s;
  }

  private updateRange(): void {
    const v = state.viewable(state.selectedId);
    if (!v || this.rangeMode === 'manual') return;
    const s = this.sorted(v.image.data);
    if (s.length === 0) return;
    ({ black: this.black, white: this.white } = displayRange(s, this.rangeMode));
  }

  private applyRange(): void {
    this.viewer.setRange(this.black, this.white, this.scale);
    if (this.tab === 'histogram') this.renderTool();
  }

  private updateOverlay(): void {
    const v = state.viewable(state.selectedId);
    // The trim region only makes sense on raw (untrimmed) frames
    const region = v && !v.isMaster ? (state.trimPreview ?? state.settings.trim ?? null) : null;
    this.viewer.setRegion(region);
    this.updateMarkers();
  }

  private showImage(): void {
    const c = state.composition(state.selectedId);
    if (c) {
      const img = renderColor(c, stackImage);
      const first = [...state.stacks.values()][0]?.image;
      // A new array each time, so switching back to a single image redraws it
      this.shownData = null;
      this.viewer.setImage(img && first ? { width: img.width, height: img.height, data: first.data, rgba: img.rgba, flipY: bottomUp(first) } : null);
      this.updateOverlay();
      this.render();
      this.compare.apply();
      return;
    }
    if (state.selectedId === QUICK_ID) {
      const q = quickLook();
      const img = q && renderQuickLook(q);
      const first = q?.frames.G.image;
      this.shownData = null;
      this.viewer.setImage(img && first ? { width: img.width, height: img.height, data: first.data, rgba: img.rgba, flipY: bottomUp(first) } : null);
      this.updateOverlay();
      this.render();
      return;
    }
    const v = state.viewable(state.selectedId);
    const data = v?.image.data ?? null;
    if (data !== this.shownData) {
      this.shownData = data;
      this.updateRange();
      this.viewer.setRange(this.black, this.white, this.scale);
      this.viewer.setImage(v ? {
        width: v.image.width,
        height: v.image.height,
        data: v.image.data,
        flipY: bottomUp(v.image),
      } : null);
    }
    this.updateOverlay();
    this.render();
    this.compare.apply();
  }

  private showReadout(p: { x: number; y: number; value: number; second?: boolean } | null): void {
    const c = state.composition(state.selectedId);
    if (c && p) {
      // The stack values behind each channel
      const parts = CHANNELS.flatMap((ch) => {
        const f = c.channels[ch].filter;
        const img = stackImage(f);
        return img ? [`${ch} (${f}) ${fmt(img.data[p.y * img.width + p.x], 1)}`] : [];
      });
      this.readout.textContent = t('viewer.readoutColor', { x: String(p.x + 1), y: String(p.y + 1), v: parts.join(' · ') });
    } else if (state.selectedId === QUICK_ID && p) {
      // The raw values behind each channel
      const q = quickLook();
      const parts = q ? CHANNELS.map((ch) => {
        const img = q.frames[ch].image;
        return `${ch} (${q.frames[ch].meta.filter}) ${fmt(img.data[p.y * img.width + p.x], 1)}`;
      }) : [];
      this.readout.textContent = t('viewer.readoutColor', { x: String(p.x + 1), y: String(p.y + 1), v: parts.join(' · ') });
    } else if (c || state.selectedId === QUICK_ID) {
      this.readout.textContent = t('viewer.hover');
    } else if (!state.viewable(state.selectedId)) {
      this.readout.textContent = t('viewer.empty');
    } else if (!p) {
      this.readout.textContent = t('viewer.hover');
    } else {
      const text = t('viewer.readout', { x: String(p.x + 1), y: String(p.y + 1), v: fmt(p.value, 3) });
      this.readout.textContent = p.second === undefined ? text : `${p.second ? 'B' : 'A'} · ${text}`;
    }
  }

  /** "Lisa aruandesse" under a tool's result. */
  private toolAdd(snapshot: ReportSnapshot, tip: Key): HTMLElement {
    return h('div', { class: 'buttons left' }, this.addButton(() => snapshot, tip));
  }

  private renderTool(): void {
    if (this.isColor()) {
      if (this.shownTab() === 'compare') {
        this.toolArea.replaceChildren(this.compare.render());
        return;
      }
      const q = state.selectedId === QUICK_ID ? quickLook() : null;
      this.toolArea.replaceChildren(h('div', { class: 'tool-out' },
        q ? h('p', {}, t('quick.frames', { R: q.frames.R.meta.fileName, G: q.frames.G.meta.fileName, B: q.frames.B.meta.fileName })) : null,
        q ? h('p', { class: 'hint' }, t('quick.look')) : null,
        h('p', { class: 'hint' }, t('pixel.hint')),
        h('p', { class: 'hint' }, t(q ? 'quick.pixel' : 'pixel.color'))));
      return;
    }
    const v = state.viewable(state.selectedId);
    if (!v) {
      this.toolArea.replaceChildren();
      return;
    }
    const { data, width, height } = v.image;
    let content: HTMLElement;
    switch (this.tab) {
      case 'pixel':
        content = h('div', { class: 'tool-out' },
          this.picker?.hint ? h('p', { class: 'pick-hint' }, this.picker.hint(state.selectedId)) : null,
          h('p', { class: 'hint' }, t('pixel.hint')),
          h('p', { class: 'hint' }, t('pixel.coords')),
          v.isMaster && state.settings.trim ? h('p', { class: 'hint' }, t('pixel.trimmed')) : null,
          /^(aligned|stack):/.test(state.selectedId ?? '') ? h('p', { class: 'hint' }, t('pixel.cropped')) : null);
        break;
      case 'profile': {
        const p = this.viewer.getProfile();
        const id = state.selectedId!;
        content = renderProfile({ data, width, height, axis: p.axis, index: p.index }, (axis) => {
          this.viewer.setProfileAxis(axis);
          this.renderTool();
        }, p.index === null ? undefined : this.toolAdd({ type: 'profile', imageId: id, axis: p.axis, index: p.index }, 'report.addPlotTip'));
        break;
      }
      case 'box': {
        const box = this.viewer.getBox();
        content = renderBoxStats(data, width, box,
          box ? this.toolAdd({ type: 'boxStats', imageId: state.selectedId!, box }, 'report.addTableTip') : undefined);
        break;
      }
      case 'histogram': {
        const box = this.viewer.getBox();
        content = renderHistogram({
          data, width,
          box,
          ...this.hist,
          black: this.black,
          white: this.white,
        }, (c: HistogramChange) => {
          Object.assign(this.hist, c);
          this.renderTool();
        }, this.toolAdd({
          type: 'histogram', imageId: state.selectedId!, box: this.hist.useBox ? box : null,
          log: this.hist.log, range: this.hist.range, black: this.black, white: this.white,
        }, 'report.addPlotTip'));
        break;
      }
      case 'compare':
        content = this.compare.render();
        break;
      case 'header':
        content = renderHeader(v.image.cards, state.profile, this.headerFilter, (q) => (this.headerFilter = q));
        break;
    }
    this.toolArea.replaceChildren(content);
  }
}
