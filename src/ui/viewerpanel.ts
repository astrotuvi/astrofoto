// Image viewer with toolbar, pixel readout and the measuring tool tabs.

import { h } from '../dom';
import { fmt, type Key, t } from '../i18n';
import { term } from '../i18n/glossary';
import { finite, sortedPercentile } from '../stats';
import { state } from '../state';
import { renderBoxStats } from '../tools/boxstats';
import { type HistogramChange, renderHistogram } from '../tools/histogram';
import { renderProfile } from '../tools/profile';
import { KINDS } from '../types';
import { type ProfileAxis, type Tool, Viewer } from '../viewer';
import { renderHeader } from './header';

export type Tab = 'pixel' | 'profile' | 'box' | 'histogram' | 'header';
type RangeMode = 'minmax' | 'p995' | 'p99' | 'manual';

const TABS: { id: Tab; label: Key; tool: Tool }[] = [
  { id: 'pixel', label: 'tab.pixel', tool: 'pixel' },
  { id: 'profile', label: 'tab.profile', tool: 'profile' },
  { id: 'box', label: 'tab.box', tool: 'box' },
  { id: 'histogram', label: 'tab.histogram', tool: 'pixel' },
  { id: 'header', label: 'tab.header', tool: 'pixel' },
];

export interface ShowOptions {
  tab?: Tab;
  profile?: { axis: ProfileAxis; index: number | null };
}

/** A readable name for a master id, e.g. "koondtasaväljakaader g". */
export function masterTitle(id: string): string {
  const m = state.masters.get(id);
  if (!m) return id;
  return t('master.title', { kind: term(m.kind), filter: m.filter ? ' ' + m.filter : '' });
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

  constructor() {
    this.viewer = new Viewer({
      hover: (p) => this.showReadout(p),
      profile: () => this.renderTool(),
      box: (box) => {
        if (box) this.hist.useBox = true;
        this.renderTool();
      },
      zoom: (s) => (this.zoomLabel.textContent = `${fmt(s * 100, 0)} %`),
    });
    state.on((kind) => {
      if (kind === 'selection' || kind === 'frames' || kind === 'masters' || kind === 'calibrated') this.showImage();
      if (kind === 'overlay' || kind === 'settings') this.updateOverlay();
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

  /** Rebuilds the controls, e.g. after a language change. The canvas is kept. */
  render(): void {
    this.element.replaceChildren(
      h('div', { class: 'viewer-head' }, this.imageSelect()),
      this.toolbar(),
      this.viewer.element,
      this.readout,
      h('div', { class: 'tabs', role: 'tablist' },
        TABS.map((tab) => h('button', {
          type: 'button',
          role: 'tab',
          class: tab.id === this.tab ? 'active' : '',
          'aria-selected': String(tab.id === this.tab),
          onclick: () => this.setTab(tab.id),
        }, t(tab.label)))),
      this.toolArea,
    );
    this.viewer.setTool(TABS.find((x) => x.id === this.tab)!.tool);
    this.showReadout(null);
    this.renderTool();
  }

  private imageSelect(): HTMLElement {
    if (state.frames.length === 0) return h('h2', {}, t('viewer.title'));
    const groups: HTMLElement[] = [];
    if (state.masters.size) {
      groups.push(h('optgroup', { label: t('viewer.masters') },
        [...state.masters.keys()].map((id) => h('option', { value: id, selected: id === state.selectedId }, masterTitle(id)))));
    }
    if (state.calibrated.size) {
      groups.push(h('optgroup', { label: t('viewer.calibrated') },
        state.framesOf('light').filter((f) => state.calibrated.has(f.meta.id)).map((f) => {
          const id = `cal:${f.meta.id}`;
          return h('option', { value: id, selected: id === state.selectedId }, `${f.meta.filter ? f.meta.filter + ' · ' : ''}${f.meta.fileName}`);
        })));
    }
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

    return h('div', { class: 'toolbar' },
      h('div', { class: 'segmented', role: 'group', 'aria-label': t('zoom.label') },
        h('button', { type: 'button', title: t('zoom.fitTip'), onclick: () => this.viewer.fit() }, t('zoom.fit')),
        h('button', { type: 'button', title: t('zoom.oneTip'), onclick: () => this.viewer.zoomTo(1) }, '1:1'),
        h('button', { type: 'button', 'aria-label': t('zoom.out'), onclick: () => this.viewer.zoomBy(1 / 2) }, '−'),
        h('button', { type: 'button', 'aria-label': t('zoom.in'), onclick: () => this.viewer.zoomBy(2) }, '+'),
      ),
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
  }

  private showImage(): void {
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
        flipY: String(v.image.header.ROWORDER ?? '').trim().toUpperCase() !== 'TOP-DOWN',
      } : null);
    }
    this.updateOverlay();
    this.render();
  }

  private showReadout(p: { x: number; y: number; value: number } | null): void {
    if (!state.viewable(state.selectedId)) {
      this.readout.textContent = t('viewer.empty');
    } else if (!p) {
      this.readout.textContent = t('viewer.hover');
    } else {
      this.readout.textContent = t('viewer.readout', { x: String(p.x + 1), y: String(p.y + 1), v: fmt(p.value, 3) });
    }
  }

  private renderTool(): void {
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
          h('p', { class: 'hint' }, t('pixel.hint')),
          h('p', { class: 'hint' }, t('pixel.coords')),
          v.isMaster && state.settings.trim ? h('p', { class: 'hint' }, t('pixel.trimmed')) : null);
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
      case 'header':
        content = renderHeader(v.image.cards, state.profile, this.headerFilter, (q) => (this.headerFilter = q));
        break;
    }
    this.toolArea.replaceChildren(content);
  }
}
