// Image viewer with toolbar, pixel readout and the measuring tool tabs.

import { CHANNELS, compositionName, render as renderColor } from '../color';
import { h } from '../dom';
import { bottomUp } from '../fits';
import { fmt, type Key, t } from '../i18n';
import { term } from '../i18n/glossary';
import { finite, sortedPercentile } from '../stats';
import { stackImage } from '../stack';
import { state } from '../state';
import { renderBoxStats } from '../tools/boxstats';
import { type HistogramChange, renderHistogram } from '../tools/histogram';
import { renderProfile } from '../tools/profile';
import { KINDS } from '../types';
import { type Marker, type ProfileAxis, type Tool, Viewer } from '../viewer';
import { CompareTool } from './compare';
import { renderHeader } from './header';

export type Tab = 'pixel' | 'profile' | 'box' | 'histogram' | 'compare' | 'header';
type RangeMode = 'minmax' | 'p995' | 'p99' | 'manual';

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
  private hist = { useBox: false, log: false, range: 'full' as 'full' | 'clipped' };
  private headerFilter = '';
  private readout = h('div', { class: 'readout', 'aria-live': 'off' });
  private zoomLabel = h('span', { class: 'zoom-label' });
  private toolArea = h('div', { class: 'tool-area' });
  private sortedCache = new WeakMap<Float32Array, Float32Array>();
  private shownData: Float32Array | null = null;
  private picker: Picker | null = null;
  private colorPending = false;
  private compare: CompareTool;

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
    return !!state.composition(state.selectedId);
  }

  /** The tab shown: colour images only have the pixel readout. */
  private shownTab(): Tab {
    return this.isColor() ? 'pixel' : this.tab;
  }

  private tool(): Tool {
    if (this.shownTab() === 'pixel' && this.picker?.pick) return 'pick';
    return TABS.find((x) => x.id === this.shownTab())!.tool;
  }

  /** Rebuilds the controls, e.g. after a language change. The canvas is kept. */
  render(): void {
    this.element.replaceChildren(
      h('div', { class: 'viewer-head' }, this.imageSelect()),
      this.toolbar(),
      this.viewer.element,
      this.readout,
      h('div', { class: 'tabs', role: 'tablist' },
        (this.isColor() ? TABS.filter((x) => x.id === 'pixel') : TABS).map((tab) => h('button', {
          type: 'button',
          role: 'tab',
          class: tab.id === this.shownTab() ? 'active' : '',
          'aria-selected': String(tab.id === this.shownTab()),
          onclick: () => this.setTab(tab.id),
        }, t(tab.label)))),
      this.toolArea,
    );
    this.viewer.setTool(this.tool());
    this.compare.setActive(this.shownTab() === 'compare');
    this.showReadout(null);
    this.renderTool();
  }

  private imageSelect(): HTMLElement {
    if (state.frames.length === 0) return h('h2', {}, t('viewer.title'));
    const groups: HTMLElement[] = [];
    const colors = state.compositions.filter((c) => CHANNELS.some((ch) => stackImage(c.channels[ch].filter)));
    if (colors.length) {
      groups.push(h('optgroup', { label: t('viewer.colors') },
        colors.map((c) => h('option', { value: `color:${c.id}`, selected: `color:${c.id}` === state.selectedId }, colorTitle(`color:${c.id}`)))));
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
    return h('label', { class: 'image-select' }, h('span', { class: 'sr-only' }, t('viewer.choose')),
      h('select', {
        onchange: (e: Event) => state.select((e.target as HTMLSelectElement).value),
      },
      state.selectedId ? null : h('option', { value: '', selected: true }, t('viewer.choose')),
      groups));
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
        this.viewer.setRange(this.black, this.white);
        this.render();
      },
    }, (['minmax', 'p995', 'p99', 'manual'] as RangeMode[]).map((m) =>
      h('option', { value: m, selected: m === this.rangeMode }, t(`display.${m}` as Key))));

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
    const p = this.rangeMode === 'p995' ? 0.5 : this.rangeMode === 'p99' ? 1 : 0;
    this.black = p ? sortedPercentile(s, p) : s[0];
    this.white = p ? sortedPercentile(s, 100 - p) : s[s.length - 1];
  }

  private applyRange(): void {
    this.viewer.setRange(this.black, this.white);
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
      return;
    }
    const v = state.viewable(state.selectedId);
    const data = v?.image.data ?? null;
    if (data !== this.shownData) {
      this.shownData = data;
      this.updateRange();
      this.viewer.setRange(this.black, this.white);
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
    } else if (c) {
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

  private renderTool(): void {
    if (this.isColor()) {
      this.toolArea.replaceChildren(h('div', { class: 'tool-out' },
        h('p', { class: 'hint' }, t('pixel.hint')),
        h('p', { class: 'hint' }, t('pixel.color'))));
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
        content = renderProfile({ data, width, height, axis: p.axis, index: p.index }, (axis) => {
          this.viewer.setProfileAxis(axis);
          this.renderTool();
        });
        break;
      }
      case 'box':
        content = renderBoxStats(data, width, this.viewer.getBox());
        break;
      case 'histogram':
        content = renderHistogram({
          data, width,
          box: this.viewer.getBox(),
          ...this.hist,
          black: this.black,
          white: this.white,
        }, (c: HistogramChange) => {
          Object.assign(this.hist, c);
          this.renderTool();
        });
        break;
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
