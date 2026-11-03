// The "Võrdle" tab of the viewer: blink or split between the image shown (A) and another image
// (B), from the current settings or a saved version, and the list of versions (§4.3, §4.4).
// A colour image is compared with the quick look of the raw frames (§3.1) or another colour image.

import { h } from '../dom';
import { CHANNELS, compositionName, render as renderColor } from '../color';
import { bottomUp } from '../fits';
import { fmt, getLang, type Key, t } from '../i18n';
import { term, type TermId } from '../i18n/glossary';
import { QUICK_ID, quickLook, quickLookFrames, renderQuickLook, stackRegion } from '../quicklook';
import { stackImage } from '../stack';
import { type Products, state } from '../state';
import type { Viewer, ViewImage } from '../viewer';
import { computeVersion, type Difference, differences, isFresh, saveVersion } from '../versions';

const INTERVALS = [400, 700, 1200];

/** The image id without a version prefix. */
function baseId(id: string): string {
  return id.startsWith('v:') ? id.split(':').slice(2).join(':') : id;
}

/** A readable name for an image id, e.g. "Kalibreeritud objektikaadrid: m57_V_001.fits". */
export function imageTitle(id: string): string {
  const base = baseId(id);
  const [kind, ...rest] = base.split(':');
  const name = (fid: string) => state.frame(fid)?.meta.fileName ?? fid;
  if (base === QUICK_ID) return t('quick.title');
  const c = state.composition(base);
  if (c) return t('color.title', { name: c.name || compositionName(c) });
  if (kind === 'master') return t('master.title', { kind: term(rest[0] as TermId), filter: rest[1] ? ' ' + rest.slice(1).join(':') : '' });
  if (kind === 'stack') return t('stack.title', { filter: rest.join(':') || '–' });
  if (kind === 'cal') return `${t('viewer.calibrated')}: ${name(rest[0])}`;
  if (kind === 'aligned') return `${t('viewer.aligned')}: ${name(rest[0])}`;
  return name(base);
}

/** Image ids that exist with a set of products, in the order of the image picker. */
function productIds(p: Products): string[] {
  return [
    ...[...p.stacks.keys()],
    ...[...p.aligned.keys()].map((id) => `aligned:${id}`),
    ...[...p.calibrated.keys()].map((id) => `cal:${id}`),
    ...[...p.masters.keys()],
  ];
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(getLang() === 'et' ? 'et-EE' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' });
}

/** E.g. "ilma tasaväljata" or "liitmine: keskmine". */
export function differenceText(d: Difference): string {
  switch (d.what) {
    case 'trim':
      return d.value ? t('ver.trim', { x0: d.value.x0 + 1, x1: d.value.x1 + 1, y0: d.value.y0 + 1, y1: d.value.y1 + 1 }) : t('ver.noTrim');
    case 'combine':
      return t('ver.combine', { kind: t(`ver.kind.${d.kind}` as Key), method: t(`method.${d.value}` as Key).toLowerCase() });
    default:
      return t(`ver.${d.what}.${d.value ? 'on' : 'off'}` as Key);
  }
}

export class CompareTool {
  /** null = the current settings. */
  private versionId: string | null = null;
  /** 'same' = the same image as A. */
  private imageId = 'same';
  private mode: 'blink' | 'split' = 'blink';
  private showSecond = false;
  private at = 0.5;
  private interval = INTERVALS[1];
  private timer: number | undefined;
  private active = false;
  private busy = false;
  private status = h('p', { class: 'compare-status', 'aria-live': 'polite' });
  private element = h('div', { class: 'tool-out compare' });
  private name = '';
  /** Image B as last given to the viewer; reused so blinking does not redraw it each time. */
  private shown: ViewImage | null = null;
  /** Image B of a colour image: the quick look or 'color:<composition id>'. */
  private colorId = QUICK_ID;
  private colorShown: { key: string; image: ViewImage | null } | null = null;

  constructor(private viewer: Viewer) {
    state.on((kind) => {
      if (!this.active) return;
      if (kind === 'versions') {
        if (this.versionId && !state.versions.some((v) => v.id === this.versionId)) this.versionId = null;
        this.render();
      }
    });
  }

  /** Called when the tab is opened or closed. */
  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    if (!active) {
      this.stop();
      this.viewer.setCompare(null);
    }
  }

  /** The id of image B. */
  private secondId(): string | null {
    const a = state.selectedId;
    const base = this.imageId === 'same' ? (a ? baseId(a) : null) : this.imageId;
    if (!base) return null;
    return this.versionId ? `v:${this.versionId}:${base}` : base;
  }

  private versionName(id: string | null): string {
    return id ? (state.versions.find((v) => v.id === id)?.name ?? id) : t('compare.current');
  }

  /** A colour image is shown (A): it is compared with the quick look or another colour image. */
  private colorMode(): boolean {
    return !!state.composition(state.selectedId);
  }

  /** Choices for B of a colour image: the quick look, then the other colour images with a stack. */
  private colorChoices(): string[] {
    const others = state.compositions
      .filter((c) => `color:${c.id}` !== state.selectedId && CHANNELS.some((ch) => stackImage(c.channels[ch].filter)))
      .map((c) => `color:${c.id}`);
    return [QUICK_ID, ...others];
  }

  /** Image B of a colour image; the quick look is cropped to the area of the stacks. */
  private colorImage(): ViewImage | null {
    const c = state.composition(state.selectedId);
    const data = c && CHANNELS.map((ch) => stackImage(c.channels[ch].filter)).find(Boolean)?.data;
    if (!data) return null;
    // The values under the mouse are those of A's stacks, so B shares their data
    const view = (img: { width: number; height: number; rgba: Uint8ClampedArray } | null, flip: boolean) =>
      img && { width: img.width, height: img.height, data, rgba: img.rgba, flipY: flip };
    if (this.colorId === QUICK_ID) {
      const q = quickLook();
      const r = stackRegion();
      if (!q || !r) return null;
      const key = [...CHANNELS.map((ch) => q.frames[ch].meta.id), r.x0, r.x1, r.y0, r.y1].join(':');
      if (this.colorShown?.key !== key) this.colorShown = { key, image: view(renderQuickLook(q, r), bottomUp(q.frames.G.image)) };
      return this.colorShown.image;
    }
    const b = state.composition(this.colorId);
    const first = b && CHANNELS.map((ch) => stackImage(b.channels[ch].filter)).find(Boolean);
    if (!b || !first) return null;
    // Redrawn only when its settings or the stacks change, not on every blink
    const key = JSON.stringify(b) + ':' + [...state.stacks.values()].map((st) => st.count).join(',');
    if (this.colorShown?.key !== key || this.colorShown.image?.data !== data) this.colorShown = { key, image: view(renderColor(b, stackImage), bottomUp(first)) };
    return this.colorShown.image;
  }

  /** Puts image B into the viewer, after computing the version's images if needed. */
  apply(): void {
    if (!this.active) return;
    if (this.colorMode()) {
      const b = this.problem() === null ? this.colorImage() : null;
      this.viewer.setCompare(b && { image: b, mode: this.mode, showSecond: this.showSecond, at: this.at });
      this.updateStatus();
      return;
    }
    if (this.versionId && !isFresh(this.versionId)) {
      if (this.busy) return;
      this.busy = true;
      this.render();
      // Let the browser paint "computing" first
      requestAnimationFrame(() => setTimeout(() => {
        try {
          computeVersion(this.versionId!);
        } finally {
          this.busy = false;
          this.apply();
          this.render();
        }
      }, 0));
      return;
    }
    const b = state.viewable(this.secondId());
    if (b && this.shown?.data !== b.image.data) {
      this.shown = { width: b.image.width, height: b.image.height, data: b.image.data, flipY: bottomUp(b.image) };
    }
    this.viewer.setCompare(b && this.problem() === null ? {
      image: this.shown!,
      mode: this.mode,
      showSecond: this.showSecond,
      at: this.at,
    } : null);
    this.updateStatus();
  }

  /** Why the two images cannot be compared, if they cannot. */
  private problem(): Key | null {
    const a = state.selectedId;
    if (this.colorMode()) {
      if (!this.colorChoices().includes(this.colorId)) this.colorId = QUICK_ID;
      if (this.colorId === QUICK_ID && !quickLookFrames()) return 'compare.noQuick';
      const b = this.colorImage();
      if (!b) return 'compare.noB';
      const c = state.composition(a)!;
      const st = CHANNELS.map((ch) => stackImage(c.channels[ch].filter)).find(Boolean);
      if (!b || !st || b.width !== st.width || b.height !== st.height) return 'compare.size';
      return null;
    }
    if (!a || a === QUICK_ID) return 'compare.noA';
    const av = state.viewable(a);
    const bid = this.secondId();
    const b = state.viewable(bid);
    if (this.versionId && bid && !baseId(bid).includes(':')) return 'compare.rawSame';
    if (!av || !b) return 'compare.noB';
    if (av.image.width !== b.image.width || av.image.height !== b.image.height) return 'compare.size';
    if (bid === a) return 'compare.same';
    return null;
  }

  private updateStatus(): void {
    const a = state.selectedId;
    const b = this.secondId();
    const label = (which: 'A' | 'B', id: string | null, version: string | null) =>
      `${which}: ${id ? imageTitle(id) : '–'} (${this.versionName(version)})`;
    const shown = this.mode === 'blink' ? (this.showSecond ? 'B' : 'A') : null;
    if (this.colorMode()) {
      this.status.replaceChildren(
        h('span', { class: shown === 'A' ? 'shown' : '' }, `A: ${a ? imageTitle(a) : '–'}`), h('br'),
        h('span', { class: shown === 'B' ? 'shown' : '' }, `B: ${imageTitle(this.colorId)}`));
      return;
    }
    this.status.replaceChildren(
      h('span', { class: shown === 'A' ? 'shown' : '' }, label('A', a, a?.startsWith('v:') ? a.split(':')[1] : null)), h('br'),
      h('span', { class: shown === 'B' ? 'shown' : '' }, label('B', b, this.versionId)));
  }

  private stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  private flip(): void {
    this.showSecond = !this.showSecond;
    this.apply();
  }

  private start(): void {
    this.stop();
    this.timer = window.setInterval(() => {
      if (!this.element.isConnected) return this.stop();
      this.flip();
    }, this.interval);
  }

  render(): HTMLElement {
    const versions = state.versions;
    const ids = this.versionId ? productIds(state.versionProducts.get(this.versionId) ?? emptyProducts())
      : [...productIds(state), ...state.frames.map((f) => f.meta.id)];
    const problem = this.busy ? null : this.problem();
    const blinking = this.timer !== undefined;

    const color = this.colorMode();
    this.element.replaceChildren(...[
      h('p', { class: 'hint' }, t(color ? 'compare.quickIntro' : 'compare.intro')),
      color ? h('div', { class: 'compare-b' },
        h('label', { class: 'inline' }, t('compare.image'), ' ',
          h('select', {
            onchange: (e: Event) => {
              this.colorId = (e.target as HTMLSelectElement).value;
              this.apply();
              this.render();
            },
          }, this.colorChoices().map((id) => h('option', { value: id, selected: id === this.colorId }, imageTitle(id)))))) : null,
      color ? null : h('div', { class: 'compare-b' },
        h('label', { class: 'inline' }, t('compare.version'), ' ',
          h('select', {
            onchange: (e: Event) => {
              const v = (e.target as HTMLSelectElement).value;
              this.versionId = v || null;
              this.apply();
              this.render();
            },
          },
          h('option', { value: '', selected: this.versionId === null }, t('compare.current')),
          versions.map((v) => h('option', { value: v.id, selected: v.id === this.versionId }, v.name)))),
        h('label', { class: 'inline' }, t('compare.image'), ' ',
          h('select', {
            disabled: this.busy,
            onchange: (e: Event) => {
              this.imageId = (e.target as HTMLSelectElement).value;
              this.apply();
              this.render();
            },
          },
          h('option', { value: 'same', selected: this.imageId === 'same' }, t('compare.sameImage')),
          ids.map((id) => h('option', { value: id, selected: id === this.imageId }, imageTitle(id)))))),
      h('div', { class: 'toolbar' },
        h('div', { class: 'segmented', role: 'group', 'aria-label': t('compare.mode') },
          (['blink', 'split'] as const).map((m) => h('button', {
            type: 'button',
            class: m === this.mode ? 'active' : '',
            'aria-pressed': String(m === this.mode),
            onclick: () => {
              this.mode = m;
              if (m === 'split') this.stop();
              this.apply();
              this.render();
            },
          }, t(`compare.${m}` as Key)))),
        this.mode === 'blink' ? [
          h('button', {
            type: 'button',
            onclick: () => {
              if (blinking) this.stop();
              else this.start();
              this.render();
            },
          }, blinking ? t('compare.pause') : t('compare.play')),
          h('button', { type: 'button', title: t('compare.swapTip'), onclick: () => this.flip() }, t('compare.swap')),
          h('label', { class: 'inline' }, t('compare.speed'), ' ',
            h('select', {
              onchange: (e: Event) => {
                this.interval = Number((e.target as HTMLSelectElement).value);
                if (this.timer !== undefined) this.start();
              },
            }, INTERVALS.map((ms) => h('option', { value: String(ms), selected: ms === this.interval }, `${fmt(ms / 1000, 1)} s`)))),
        ] : h('label', { class: 'inline' }, t('compare.at'), ' ',
          h('input', {
            type: 'range', min: '0', max: '100', step: '1', value: String(Math.round(this.at * 100)),
            oninput: (e: Event) => {
              this.at = Number((e.target as HTMLInputElement).value) / 100;
              this.apply();
            },
          }))),
      this.busy ? h('p', { class: 'hint' }, t('compare.computing')) : problem ? h('p', { class: 'warning' }, t(problem)) : this.status,
      h('p', { class: 'hint' }, t(this.mode === 'blink' ? 'compare.blinkHint' : 'compare.splitHint')),
      color ? null : this.versionList(),
    ].filter((x) => x !== null));
    if (!this.busy) this.updateStatus();
    return this.element;
  }

  private versionList(): HTMLElement {
    const save = () => {
      const name = this.name.trim() || t('compare.defaultName', { n: state.versions.length + 1 });
      saveVersion(name);
      this.name = '';
    };
    return h('section', { class: 'versions' },
      h('h4', {}, t('compare.versions')),
      h('p', { class: 'hint' }, t('compare.versionsText')),
      state.versions.length ? h('ul', { class: 'version-list' }, state.versions.map((v) => {
        const diff = differences(v.settings, state.settings);
        return h('li', {},
          h('strong', {}, v.name), ' ', h('span', { class: 'date' }, formatDate(v.created)), h('br'),
          h('span', { class: diff.length ? '' : 'hint' }, diff.length ? t('compare.differs', { what: diff.map(differenceText).join(', ') }) : t('compare.noDifference')),
          ' ',
          h('button', {
            type: 'button',
            class: 'small',
            onclick: () => {
              this.versionId = v.id;
              this.apply();
              this.render();
            },
          }, t('compare.compareWith')),
          h('button', {
            type: 'button',
            class: 'small',
            onclick: () => {
              const name = prompt(t('compare.renamePrompt'), v.name)?.trim();
              if (name) state.updateVersion(v.id, { name });
            },
          }, t('compare.rename')),
          h('button', {
            type: 'button',
            class: 'small danger',
            onclick: () => {
              if (confirm(t('compare.removeConfirm', { name: v.name }))) state.removeVersion(v.id);
            },
          }, t('compare.remove')));
      })) : null,
      h('form', {
        class: 'version-save',
        onsubmit: (e: Event) => {
          e.preventDefault();
          save();
        },
      },
      h('input', {
        type: 'text',
        value: this.name,
        placeholder: t('compare.namePlaceholder'),
        'aria-label': t('compare.name'),
        oninput: (e: Event) => (this.name = (e.target as HTMLInputElement).value),
      }),
      h('button', { type: 'submit' }, t('compare.save'))));
  }
}

function emptyProducts(): Products {
  return { masters: new Map(), calibrated: new Map(), aligned: new Map(), alignCrop: null, stacks: new Map() };
}
