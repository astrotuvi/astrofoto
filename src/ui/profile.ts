// The instrument profile in step 1: what the app read from the headers, an editor for checking
// and completing it, and saving it to a file or loading one. See docs/DESIGN.md §2.4.

import { h } from '../dom';
import { Cancelled, pickFile, saveFile } from '../fileio';
import { fmt, type Key, t } from '../i18n';
import { term } from '../i18n/glossary';
import { CONCEPTS, type Concept, DEFAULT_KEYWORDS, DEFAULT_KIND_VALUES } from '../instrument/defaults';
import { filterInfo, gainInfo, instrumentNames, pixelScaleInfo, saturationInfo, type Sourced } from '../instrument/profile';
import { parseProfileFile, ProfileError, profileFileName, serializeProfile } from '../instrument/profilefile';
import { isMentor } from '../mentor';
import { state } from '../state';
import { KINDS, type InstrumentProfile, type Region } from '../types';

const TYPE = { description: 'Astrofoto profile', accept: { 'application/json': ['.json'] } };

type Message = { text: string; level: 'ok' | 'error' };

export class ProfileBox {
  private editing = false;
  private message: Message | null = null;

  /** `onChange` redraws the step, e.g. when the editor opens. */
  constructor(private onChange: () => void) {}

  render(): HTMLElement | null {
    const p = state.profile;
    if (!p || !state.frames.length) {
      this.editing = false;
      this.message = null;
      return null;
    }
    return h('div', { class: 'profile-box' },
      h('h3', {}, t('instr.title'), ': ', p.name),
      p.generated ? h('p', { class: 'warning' }, t('instr.generated')) : null,
      this.editing ? this.editor(p) : this.summary(p),
      this.message ? h('p', { class: this.message.level, role: 'status' }, this.message.text) : null,
    );
  }

  private rerender(): void {
    this.onChange();
  }

  private summary(p: InstrumentProfile): HTMLElement {
    const header = state.frames[0].meta.header;
    const trim = p.trim ? regionText(p.trim) : t('instr.trimUnknown');
    const names = instrumentNames(header, p);
    const dl = (label: string, value: string, note?: string) => [
      h('dt', {}, label),
      h('dd', {}, value, note ? h('span', { class: 'source' }, ' ', note) : null),
    ];
    const sourced = (s: Sourced | undefined, unit: (v: number) => string) =>
      s ? [unit(s.value), sourceText(s)] as const : [t('instr.unknown'), undefined] as const;
    const filters = frameFilters().map((f) => {
      const info = filterInfo(p, f);
      return info ? `${f} (${fmt(info.wavelengthNm, 0)} nm)` : `${f} (?)`;
    });
    return h('div', {},
      h('dl', {},
        dl(t('instr.telescope'), names.telescope || '–', p.telescope ? undefined : names.telescope && t('instr.fromHeader', { key: 'TELESCOP' })),
        dl(t('instr.camera'), names.camera || '–', p.camera ? undefined : names.camera && t('instr.fromHeader', { key: 'INSTRUME' })),
        dl(t('instr.trim'), trim),
        dl(t('instr.saturation'), ...sourced(saturationInfo(header, p), (v) => `${fmt(v, 0)} ADU`)),
        dl(t('instr.scale'), ...sourced(pixelScaleInfo(header, p), (v) => t('instr.scaleValue', { s: fmt(v, 3) }))),
        dl(t('instr.gain'), ...sourced(gainInfo(header, p), (v) => `${fmt(v, 2)} e⁻/ADU`)),
        filters.length ? dl(t('instr.filters'), filters.join(', ')) : null,
      ),
      h('div', { class: 'buttons left' },
        h('button', {
          type: 'button',
          class: p.generated ? 'primary' : '',
          onclick: () => {
            this.editing = true;
            this.message = null;
            this.rerender();
          },
        }, t('instr.edit')),
        h('button', { type: 'button', title: t('instr.saveTip'), onclick: () => void this.save(p) }, t('instr.save')),
        h('button', { type: 'button', title: t('instr.loadTip'), onclick: () => void this.load() }, t('instr.load'))),
    );
  }

  private editor(p: InstrumentProfile): HTMLElement {
    const header = state.frames[0].meta.header;
    const auto = { ...p, saturationLevel: undefined, pixelScale: undefined, gain: undefined };
    const field = (label: string, input: HTMLElement, hint?: string) =>
      h('label', { class: 'field' }, h('span', {}, label), input, hint ? h('span', { class: 'hint' }, hint) : null);
    const number = (value: number | undefined, placeholder: Sourced | undefined, digits: number) => h('input', {
      type: 'number',
      step: 'any',
      min: '0',
      value: value === undefined ? '' : String(value),
      placeholder: placeholder ? fmt(placeholder.value, digits) : '',
    });

    const name = h('input', { type: 'text', value: p.name, required: true });
    const fromHeader = instrumentNames(header, null);
    const telescope = h('input', { type: 'text', value: p.telescope ?? '', placeholder: fromHeader.telescope });
    const camera = h('input', { type: 'text', value: p.camera ?? '', placeholder: fromHeader.camera });
    const trimInputs = (['x0', 'x1', 'y0', 'y1'] as const).map((k) => h('input', {
      type: 'number',
      step: '1',
      min: '1',
      value: p.trim ? String(p.trim[k] + 1) : '',
      'aria-label': k,
    }));
    const saturation = number(p.saturationLevel, saturationInfo(header, auto), 0);
    const scale = number(p.pixelScale, pixelScaleInfo(header, auto), 3);
    const gain = number(p.gain, gainInfo(header, auto), 2);
    const binned = state.frames.some((f) => (f.meta.xbin ?? 1) > 1);
    const includesBinning = h('select', {},
      h('option', { value: 'yes', selected: p.pixelSizeIncludesBinning !== false }, t('instr.binIncluded')),
      h('option', { value: 'no', selected: p.pixelSizeIncludesBinning === false }, t('instr.binNotIncluded')));

    const filterRows = frameFilters().map((f) => {
      const own = p.filters[f];
      const builtIn = filterInfo({ ...p, filters: {} }, f);
      const nm = h('input', {
        type: 'number', step: 'any', min: '0',
        value: own ? String(own.wavelengthNm) : '',
        placeholder: builtIn ? String(builtIn.wavelengthNm) : '',
        'aria-label': t('instr.wavelength', { f }),
      });
      return { f, nm, row: h('tr', {}, h('th', { scope: 'row' }, f), h('td', {}, nm), h('td', { class: 'hint' }, builtIn?.system ?? '')) };
    });

    // Header keywords and frame type names: easy to break, so for the mentor only
    const listInput = (value: string[] | undefined, defaults: string[]) =>
      h('input', { type: 'text', value: value?.join(', ') ?? '', placeholder: defaults.join(', '), size: 40 });
    const keywordInputs = CONCEPTS.map((c) => ({ c, input: listInput(p.keywords[c], DEFAULT_KEYWORDS[c]) }));
    const kindInputs = KINDS.map((k) => ({ k, input: listInput(p.kindValues[k], DEFAULT_KIND_VALUES[k]) }));
    const telescop = h('input', { type: 'text', value: p.match?.telescop ?? '' });
    const instrume = h('input', { type: 'text', value: p.match?.instrume ?? '' });

    const error = h('p', { class: 'error', role: 'alert', hidden: true });
    const submit = (e: Event) => {
      e.preventDefault();
      const next = this.read(p, {
        name: name.value,
        telescope: telescope.value,
        camera: camera.value,
        trim: trimInputs.map((i) => i.value),
        saturation: saturation.value,
        scale: scale.value,
        gain: gain.value,
        includesBinning: binned ? includesBinning.value === 'yes' : p.pixelSizeIncludesBinning,
        filters: filterRows.map((r) => [r.f, r.nm.value]),
        keywords: isMentor() ? keywordInputs.map((k) => [k.c, k.input.value]) : null,
        kinds: isMentor() ? kindInputs.map((k) => [k.k, k.input.value]) : null,
        match: isMentor() ? [telescop.value, instrume.value] : null,
      });
      if (typeof next === 'string') {
        error.textContent = next;
        error.hidden = false;
        return;
      }
      this.editing = false;
      this.message = { text: t('instr.saved'), level: 'ok' };
      state.applyProfile(next);
      state.addLog('files', 'profileChanged', { name: next.name });
    };

    return h('form', { class: 'profile-editor', onsubmit: submit },
      h('p', { class: 'hint' }, t('instr.editHint')),
      field(t('instr.name'), name),
      field(t('instr.telescope'), telescope),
      field(t('instr.camera'), camera, t('instr.namesHint')),
      h('fieldset', { class: 'trim-fields' },
        h('legend', {}, t('instr.trim')),
        h('span', {}, 'x = '), trimInputs[0], '–', trimInputs[1], h('span', {}, ' y = '), trimInputs[2], '–', trimInputs[3],
        h('p', { class: 'hint' }, t('instr.trimHint'))),
      field(t('instr.saturation') + ' (ADU)', saturation, t('instr.emptyAuto')),
      field(t('instr.scale') + ' (″/px)', scale, t('instr.scaleHint')),
      binned ? field(t('instr.binning'), includesBinning, t('instr.binningHint')) : null,
      field(t('instr.gain') + ' (e⁻/ADU)', gain, t('instr.gainHint')),
      filterRows.length ? h('div', {},
        h('h4', {}, t('instr.filters')),
        h('table', { class: 'grid compact' },
          h('thead', {}, h('tr', {}, h('th', {}, t('files.filter')), h('th', {}, t('instr.wavelengthNm')), h('th', {}))),
          h('tbody', {}, filterRows.map((r) => r.row))),
        h('p', { class: 'hint' }, t('instr.filtersHint'))) : null,
      isMentor() ? h('details', { class: 'mentor-only' },
        h('summary', {}, t('instr.advanced')),
        h('p', { class: 'hint' }, t('instr.advancedHint')),
        field(t('instr.matchTelescope'), telescop),
        field(t('instr.matchCamera'), instrume),
        h('h4', {}, t('instr.keywords')),
        keywordInputs.map(({ c, input }) => field(t(`concept.${c}` as Key), input)),
        h('h4', {}, t('instr.kindValues')),
        kindInputs.map(({ k, input }) => field(capitalize(term(k)), input))) : null,
      error,
      h('div', { class: 'buttons left' },
        h('button', { type: 'submit', class: 'primary' }, t('instr.apply')),
        h('button', {
          type: 'button',
          onclick: () => {
            this.editing = false;
            this.rerender();
          },
        }, t('instr.cancel'))),
    );
  }

  /** The edited profile, or an error message. */
  private read(p: InstrumentProfile, v: {
    name: string;
    telescope: string; camera: string;
    trim: string[];
    saturation: string; scale: string; gain: string;
    includesBinning: boolean | undefined;
    filters: [string, string][];
    keywords: [Concept, string][] | null;
    kinds: [(typeof KINDS)[number], string][] | null;
    match: [string, string] | null;
  }): InstrumentProfile | string {
    const name = v.name.trim();
    if (!name) return t('instr.needName');
    const positive = (s: string): number | undefined | null => {
      if (!s.trim()) return undefined;
      const n = Number(s.replace(',', '.'));
      return Number.isFinite(n) && n > 0 ? n : null;
    };

    let trim: Region | null = null;
    const filled = v.trim.filter((s) => s.trim());
    if (filled.length) {
      if (filled.length < 4) return t('instr.badTrim');
      const [x0, x1, y0, y1] = v.trim.map((s) => Number(s) - 1);
      const { width, height } = state.frames[0].meta;
      const ints = [x0, x1, y0, y1].every((n) => Number.isInteger(n) && n >= 0);
      if (!ints || x0 > x1 || y0 > y1 || x1 >= width || y1 >= height) return t('instr.badTrim');
      trim = { x0, x1, y0, y1 };
    }
    const saturationLevel = positive(v.saturation);
    const pixelScale = positive(v.scale);
    const gain = positive(v.gain);
    if (saturationLevel === null || pixelScale === null || gain === null) return t('instr.badNumber');

    // Wavelengths typed for this project's filters; other filters in the profile are kept
    const filters = { ...p.filters };
    for (const [f, s] of v.filters) {
      const nm = positive(s);
      if (nm === null) return t('instr.badNumber');
      if (nm === undefined) delete filters[f];
      else filters[f] = { wavelengthNm: nm, system: p.filters[f]?.system };
      if (filters[f] && !filters[f].system) delete filters[f].system;
    }

    const list = (s: string) => s.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
    const keywords = { ...p.keywords };
    for (const [c, s] of v.keywords ?? []) {
      if (list(s).length) keywords[c] = list(s).map((k) => k.toUpperCase());
      else delete keywords[c];
    }
    const kindValues = { ...p.kindValues };
    for (const [k, s] of v.kinds ?? []) {
      if (list(s).length) kindValues[k] = list(s);
      else delete kindValues[k];
    }
    const match = v.match
      ? { telescop: v.match[0].trim() || undefined, instrume: v.match[1].trim() || undefined }
      : p.match;

    const next: InstrumentProfile = {
      ...p, name, match, trim,
      telescope: v.telescope.trim() || undefined,
      camera: v.camera.trim() || undefined, keywords, kindValues, filters,
      saturationLevel, pixelScale, gain,
      pixelSizeIncludesBinning: v.includesBinning,
    };
    delete next.generated;
    for (const k of Object.keys(next) as (keyof InstrumentProfile)[]) if (next[k] === undefined) delete next[k];
    return next;
  }

  private async save(p: InstrumentProfile): Promise<void> {
    try {
      await saveFile(new TextEncoder().encode(serializeProfile(p)), profileFileName(p), TYPE, null);
      this.message = { text: t('instr.savedFile'), level: 'ok' };
    } catch (e) {
      if (e instanceof Cancelled) return;
      this.message = { text: t('instr.saveFailed', { detail: String(e) }), level: 'error' };
    }
    this.rerender();
  }

  private async load(): Promise<void> {
    try {
      const { file } = await pickFile(TYPE);
      const profile = parseProfileFile(await file.text());
      this.editing = false;
      this.message = { text: t('instr.loaded', { name: profile.name }), level: 'ok' };
      state.applyProfile(profile);
      state.addLog('files', 'profileLoaded', { name: profile.name });
    } catch (e) {
      if (e instanceof Cancelled) return;
      const code = e instanceof ProfileError ? e.code : 'badJson';
      this.message = { text: t(`instr.loadError.${code}` as Key, { detail: e instanceof ProfileError ? e.detail : String(e) }), level: 'error' };
      this.rerender();
    }
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function regionText(r: Region): string {
  return t('instr.trimValue', { x0: String(r.x0 + 1), x1: String(r.x1 + 1), y0: String(r.y0 + 1), y1: String(r.y1 + 1) });
}

/** "(from SATURATE)", "(from FOCALLEN, XPIXSZ)", "(estimate)"; nothing for values set in the profile. */
function sourceText(s: Sourced): string | undefined {
  if (s.source === 'profile') return undefined;
  if (s.source === 'estimate') return t('instr.fromEstimate');
  return t('instr.fromHeader', { key: s.key ?? '' });
}

/** The filters of this project's flats and lights, by wavelength where known. */
function frameFilters(): string[] {
  const names = new Set(state.frames.filter((f) => f.meta.filter && !f.meta.excluded).map((f) => f.meta.filter));
  const nm = (f: string) => filterInfo(state.profile, f)?.wavelengthNm ?? Infinity;
  return [...names].sort((a, b) => nm(a) - nm(b) || (a < b ? -1 : a > b ? 1 : 0));
}
