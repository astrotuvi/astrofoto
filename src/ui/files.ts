// Step 1: loading files, the instrument profile and the file table.

import { h } from '../dom';
import { fmt, type Key, t } from '../i18n';
import { explain, term } from '../i18n/glossary';
import { type ImportResult, importFiles, type PickedFile, picked } from '../import';
import { filterInfo, headerValue, pixelScale } from '../instrument/profile';
import { state } from '../state';
import { runChecks } from '../checks';
import { tasksFor } from '../tasks';
import { KINDS, type FrameMeta, type Kind } from '../types';
import { renderChecks } from './checks';
import { renderTasks } from './task';

type SortKey = 'fileName' | 'kind' | 'filter' | 'exposure' | 'dateObs';

export class FilesStep {
  readonly element = h('section', { class: 'files-step' });
  private sortKey: SortKey = 'kind';
  private sortAsc = true;
  private lastImport: ImportResult | null = null;
  private busy = false;

  private rows = new Map<string, HTMLTableRowElement>();

  constructor() {
    state.on((kind) => {
      if (kind === 'selection') this.markSelected();
      else if (kind === 'frames' || kind === 'profile') this.render();
    });
    this.render();
  }

  render(): void {
    // Keep the table's scroll position when it is rebuilt
    const scrollTop = this.element.querySelector('.file-table .scroll')?.scrollTop ?? 0;
    const parts = [this.loader(), this.importMessages(), this.profileBox(), this.summary(), this.checks(), this.table(),
      state.frames.length ? renderTasks(tasksFor('files')) : null];
    this.element.replaceChildren(...parts.filter((p): p is HTMLElement => p !== null));
    const scroll = this.element.querySelector('.file-table .scroll');
    if (scroll) scroll.scrollTop = scrollTop;
  }

  private markSelected(): void {
    for (const [id, row] of this.rows) row.classList.toggle('selected', id === state.selectedId);
  }

  private async load(files: PickedFile[]): Promise<void> {
    if (files.length === 0) return;
    this.busy = true;
    this.render();
    try {
      this.lastImport = await importFiles(files);
    } finally {
      this.busy = false;
    }
    if (!state.selectedId && state.frames.length) state.select(state.frames[0].meta.id);
    this.render();
  }

  private loader(): HTMLElement {
    const fileInput = h('input', {
      type: 'file',
      multiple: true,
      accept: '.fits,.fit,.fts,.gz,.zip',
      hidden: true,
      onchange: (e: Event) => {
        const input = e.target as HTMLInputElement;
        void this.load(picked(input.files ?? []));
        input.value = '';
      },
    });
    const folderInput = h('input', {
      type: 'file',
      hidden: true,
      onchange: (e: Event) => {
        const input = e.target as HTMLInputElement;
        void this.load(picked(input.files ?? []));
        input.value = '';
      },
    });
    folderInput.webkitdirectory = true;

    const zone = h('div', {
      class: 'drop-zone' + (this.busy ? ' busy' : ''),
      ondragover: (e: Event) => {
        e.preventDefault();
        zone.classList.add('over');
      },
      ondragleave: () => zone.classList.remove('over'),
      ondrop: (e: Event) => {
        e.preventDefault();
        zone.classList.remove('over');
        void dropFiles(e as DragEvent).then((files) => this.load(files));
      },
    },
      h('p', {}, this.busy ? t('files.loading') : t('files.drop')),
      h('div', { class: 'buttons' },
        h('button', { type: 'button', onclick: () => fileInput.click(), disabled: this.busy }, t('files.pickFiles')),
        h('button', { type: 'button', onclick: () => folderInput.click(), disabled: this.busy }, t('files.pickFolder')),
        state.frames.length
          ? h('button', {
              type: 'button',
              class: 'danger',
              disabled: this.busy,
              onclick: () => {
                if (confirm(t('files.clearConfirm'))) {
                  this.lastImport = null;
                  state.clear();
                }
              },
            }, t('files.clear'))
          : null,
      ),
      h('p', { class: 'hint' }, t('files.formats')),
      fileInput,
      folderInput,
    );
    return zone;
  }

  private importMessages(): HTMLElement | null {
    const r = this.lastImport;
    if (!r) return null;
    const items: HTMLElement[] = [];
    for (const p of r.problems) {
      items.push(h('li', { class: 'error' }, h('code', {}, p.fileName), ': ', t(`import.${p.reason}` as Key, { detail: p.detail ?? '' })));
    }
    for (const w of r.warnings) {
      items.push(h('li', { class: 'warning' }, h('code', {}, w.fileName), ': ', t(`import.${w.reason}` as Key, { detail: w.detail ?? '' })));
    }
    return h('div', { class: 'messages', role: 'status' },
      h('p', {}, t('import.added', { n: r.added })),
      items.length ? h('details', { open: items.length <= 5 },
        h('summary', {}, t('import.issues', { n: items.length })),
        h('ul', {}, items)) : null,
    );
  }

  private profileBox(): HTMLElement | null {
    const p = state.profile;
    if (!p) return null;
    const header = state.frames[0]?.meta.header ?? {};
    const scale = pixelScale(header, p);
    const trim = p.trim
      ? t('instr.trimValue', { x0: String(p.trim.x0 + 1), x1: String(p.trim.x1 + 1), y0: String(p.trim.y0 + 1), y1: String(p.trim.y1 + 1) })
      : t('instr.trimUnknown');
    const dl = (label: string, value: string) => [h('dt', {}, label), h('dd', {}, value)];
    return h('div', { class: 'profile-box' },
      h('h3', {}, t('instr.title'), ': ', p.name),
      p.generated ? h('p', { class: 'warning' }, t('instr.generated')) : null,
      h('dl', {},
        dl(t('instr.telescope'), String(header.TELESCOP ?? '–').trim()),
        dl(t('instr.camera'), String(header.INSTRUME ?? '–').trim()),
        dl(t('instr.trim'), trim),
        dl(t('instr.saturation'), p.saturationLevel ? `${fmt(p.saturationLevel, 0)} ADU` : t('instr.unknown')),
        dl(t('instr.scale'), scale ? t('instr.scaleValue', { s: fmt(scale, 3) }) : t('instr.unknown')),
      ),
    );
  }

  private summary(): HTMLElement | null {
    const frames = state.frames.filter((f) => !f.meta.excluded);
    if (frames.length === 0) return null;
    const filters = [...new Set(frames.filter((f) => f.meta.filter).map((f) => f.meta.filter))].sort(compareFilters);
    const count = (kind: Kind, filter?: string) =>
      frames.filter((f) => f.meta.kind === kind && (filter === undefined || f.meta.filter === filter)).length;
    const usesFilter = (kind: Kind) => kind === 'flat' || kind === 'light';

    return h('div', { class: 'summary' },
      h('h3', {}, t('files.summary')),
      h('table', { class: 'grid' },
        h('thead', {}, h('tr', {},
          h('th', {}, t('files.kind')),
          filters.map((f) => h('th', { class: 'num' }, f)),
          h('th', { class: 'num' }, t('files.total')))),
        h('tbody', {}, KINDS.filter((k) => count(k) > 0).map((k) =>
          h('tr', {},
            h('th', { scope: 'row' }, h('span', { class: 'term', title: explain(k) }, term(k))),
            filters.map((f) => h('td', { class: 'num' }, usesFilter(k) ? String(count(k, f) || '–') : '')),
            h('td', { class: 'num' }, String(count(k)))))),
      ),
      h('p', { class: 'hint' }, t('files.memory', { n: state.frames.length, mb: fmt(state.memoryBytes() / 1e6, 1) })),
    );
  }

  private checks(): HTMLElement | null {
    if (state.frames.length === 0) return null;
    const list = runChecks();
    return h('div', { class: 'checks-box' },
      h('h3', {}, t('files.checks')),
      list.length ? renderChecks(list) : h('p', { class: 'ok' }, t('files.checksOk')));
  }

  private sorted(): FrameMeta[] {
    const key = this.sortKey;
    const dir = this.sortAsc ? 1 : -1;
    const kindOrder = (k: Kind) => KINDS.indexOf(k);
    return state.frames.map((f) => f.meta).sort((a, b) => {
      let c: number;
      if (key === 'kind') c = kindOrder(a.kind) - kindOrder(b.kind) || compareFilters(a.filter, b.filter) || a.dateObs.localeCompare(b.dateObs);
      else if (key === 'exposure') c = a.exposure - b.exposure;
      else if (key === 'filter') c = compareFilters(a.filter, b.filter);
      else c = a[key].localeCompare(b[key]);
      return c * dir || a.fileName.localeCompare(b.fileName);
    });
  }

  private table(): HTMLElement | null {
    if (state.frames.length === 0) return null;
    const head = (key: SortKey, label: Key, cls = '') => {
      const active = this.sortKey === key;
      return h('th', { class: cls, 'aria-sort': active ? (this.sortAsc ? 'ascending' : 'descending') : 'none' },
        h('button', {
          type: 'button',
          class: 'sort',
          onclick: () => {
            if (active) this.sortAsc = !this.sortAsc;
            else { this.sortKey = key; this.sortAsc = true; }
            this.render();
          },
        }, t(label), active ? (this.sortAsc ? ' ▲' : ' ▼') : ''));
    };

    this.rows.clear();
    const rows = this.sorted().map((m) => {
      const selected = m.id === state.selectedId;
      const usesFilter = m.kind === 'flat' || m.kind === 'light';
      const kindSelect = h('select', {
        'aria-label': t('files.kind'),
        onchange: (e: Event) => {
          const kind = (e.target as HTMLSelectElement).value as Kind;
          const filter = kind === 'flat' || kind === 'light'
            ? m.filter || headerFilter(m)
            : '';
          state.updateMeta(m.id, { kind, kindSource: 'user', filter });
        },
      }, KINDS.map((k) => h('option', { value: k, selected: k === m.kind }, term(k))));
      const filterInput = h('input', {
        type: 'text',
        value: m.filter,
        size: 6,
        disabled: !usesFilter,
        'aria-label': t('files.filter'),
        title: usesFilter ? t('files.filterTip') : t('files.noFilterTip'),
        onchange: (e: Event) => state.updateMeta(m.id, { filter: (e.target as HTMLInputElement).value.trim() }),
      });
      const row = h('tr', {
        class: [selected ? 'selected' : '', m.excluded ? 'excluded' : ''].join(' '),
        onclick: (e: Event) => {
          if ((e.target as HTMLElement).closest('input, select, button')) return;
          state.select(m.id);
        },
      },
        h('td', {}, h('input', {
          type: 'checkbox',
          checked: !m.excluded,
          title: t('files.includeTip'),
          'aria-label': t('files.include'),
          onchange: (e: Event) => state.updateMeta(m.id, { excluded: !(e.target as HTMLInputElement).checked }),
        })),
        h('td', { class: 'name' },
          h('button', { type: 'button', class: 'link', onclick: () => state.select(m.id) }, m.fileName),
          m.kindSource === 'fileName' ? h('span', { class: 'badge', title: t('files.fromNameTip') }, t('files.fromName')) : null,
          m.kindSource === 'guess' ? h('span', { class: 'badge warn', title: t('files.guessTip') }, t('files.guess')) : null),
        h('td', {}, kindSelect),
        h('td', {}, filterInput),
        h('td', { class: 'num' }, fmt(m.exposure, 3)),
        h('td', { class: 'date' }, formatDate(m.dateObs)),
        h('td', {}, h('button', {
          type: 'button',
          class: 'icon',
          title: t('files.remove'),
          'aria-label': t('files.remove'),
          onclick: () => state.removeFrame(m.id),
        }, '×')),
      );
      this.rows.set(m.id, row);
      return row;
    });

    return h('div', { class: 'file-table' },
      h('h3', {}, t('files.list')),
      h('div', { class: 'scroll' },
        h('table', { class: 'grid' },
          h('thead', {}, h('tr', {},
            h('th', {}, h('span', { class: 'sr-only' }, t('files.include'))),
            head('fileName', 'files.name'),
            head('kind', 'files.kind'),
            head('filter', 'files.filter'),
            head('exposure', 'files.exposure', 'num'),
            head('dateObs', 'files.date'),
            h('th', {}, h('span', { class: 'sr-only' }, t('files.remove'))),
          )),
          h('tbody', {}, rows))),
    );
  }
}

/** The filter named in the header, used when a bias/dark is changed to a flat or light. */
function headerFilter(m: FrameMeta): string {
  if (!state.profile) return '';
  return String(headerValue(m.header, state.profile, 'filter')?.value ?? '').trim();
}

/** Sorts filters by wavelength where known, then by name. Case-sensitive: R and r differ. */
function compareFilters(a: string, b: string): number {
  const wa = state.profile && a ? filterInfo(state.profile, a)?.wavelengthNm : undefined;
  const wb = state.profile && b ? filterInfo(state.profile, b)?.wavelengthNm : undefined;
  if (wa !== undefined && wb !== undefined && wa !== wb) return wa - wb;
  if (wa !== undefined && wb === undefined) return -1;
  if (wb !== undefined && wa === undefined) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function formatDate(iso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/.exec(iso);
  return m ? `${m[1]} ${m[2]}` : iso;
}

/** Collects files from a drop, including the contents of dropped folders. */
async function dropFiles(e: DragEvent): Promise<PickedFile[]> {
  const items = Array.from(e.dataTransfer?.items ?? []);
  const entries = items.map((i) => i.webkitGetAsEntry?.()).filter((x): x is FileSystemEntry => !!x);
  if (entries.length === 0) return picked(e.dataTransfer?.files ?? []);
  const out: PickedFile[] = [];
  const walk = async (entry: FileSystemEntry, path: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      out.push({ file, name: path ? `${path}/${file.name}` : file.name });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const dirPath = path ? `${path}/${entry.name}` : entry.name;
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (batch.length === 0) break;
        for (const child of batch) await walk(child, dirPath);
      }
    }
  };
  for (const entry of entries) await walk(entry, '');
  return out;
}
