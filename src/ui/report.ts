// The report page (§4.6): which sections are included, the figures and measurements the student
// added (captions, order, removing), the document itself with copy buttons, and the downloads.

import { h } from '../dom';
import { exportBase } from '../export';
import { Cancelled, download, saveFile } from '../fileio';
import { type Key, t } from '../i18n';
import { buildReport, defaultCaption, SECTIONS, sectionOn } from '../report/build';
import { docxBytes, type FigureFile, figuresZip } from '../report/docx';
import { renderFigure } from '../report/figures';
import { blockElement, copyImage, copySection, figureLabel, tableLabel } from '../report/html';
import { type Block, figures, type ReportDoc } from '../report/model';
import { state } from '../state';

const DOCX = {
  description: 'Word',
  accept: { 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'] },
};
const ZIP = { description: 'Zip', accept: { 'application/zip': ['.zip'] } };

/** Changes that alter what the report says. */
const REDRAW = new Set(['report', 'answers', 'steps', 'masters', 'calibrated', 'aligned', 'stacks', 'compositions', 'versions', 'comments', 'info', 'frames', 'profile']);

export class ReportPage {
  readonly element = h('section', { class: 'step-panel report-page' });
  private active = false;
  private busy = false;
  private message: { text: string; error?: boolean } | null = null;
  private text = '';
  /** Set while a caption is saved, so the page is not rebuilt under the cursor. */
  private quiet = false;
  private urls: string[] = [];
  private pending = 0;

  constructor() {
    state.on((kind) => {
      if (this.active && !this.quiet && REDRAW.has(kind)) this.schedule();
    });
  }

  setActive(active: boolean): void {
    this.active = active;
    if (active) this.render();
  }

  /** Redraws once per frame at most, e.g. when the project is opened. */
  private schedule(): void {
    if (this.pending) return;
    this.pending = requestAnimationFrame(() => {
      this.pending = 0;
      if (this.active) this.render();
    });
  }

  private say(text: string, error = false): void {
    this.message = { text, error };
    this.render();
  }

  render(): void {
    for (const u of this.urls) URL.revokeObjectURL(u);
    this.urls = [];
    const doc = buildReport();
    this.element.replaceChildren(h('div', {},
      h('h2', {}, t('report.title')),
      h('p', {}, t('report.intro')),
      this.settings(),
      this.downloads(doc),
      this.message ? h('p', { class: this.message.error ? 'error' : 'ok', role: 'status' }, this.message.text) : null,
      h('p', { class: 'hint no-print' }, t('report.howToAdd')),
      this.document(doc),
      this.addText(),
    ));
  }

  private settings(): HTMLElement {
    const field = (key: 'title' | 'student', label: Key) =>
      h('label', { class: 'field' }, t(label),
        h('input', {
          type: 'text',
          value: state.info[key],
          placeholder: key === 'title' ? t('project.defaultTitle') : '',
          onchange: (e: Event) => state.setInfo({ [key]: (e.target as HTMLInputElement).value.trim() }),
        }));
    return h('section', { class: 'phase no-print' },
      h('h3', {}, t('report.settings')),
      field('title', 'resume.projectTitle'),
      field('student', 'resume.student'),
      h('fieldset', { class: 'report-sections' },
        h('legend', {}, t('report.sections')),
        SECTIONS.map((id) => h('label', { class: 'choice' },
          h('input', {
            type: 'checkbox',
            checked: sectionOn(id),
            onchange: (e: Event) => state.setReportSection(id, (e.target as HTMLInputElement).checked),
          }), ' ', t(`report.sectionName.${id}` as Key)))),
      h('p', { class: 'hint' }, t('report.mentorHint')));
  }

  private downloads(doc: ReportDoc): HTMLElement {
    const hasFigures = figures(doc).length > 0;
    return h('section', { class: 'phase no-print' },
      h('h3', {}, t('report.transfer')),
      h('ol', { class: 'report-ways' },
        h('li', {}, t('report.way.docx')),
        h('li', {}, t('report.way.copy')),
        h('li', {}, t('report.way.zip'))),
      h('div', { class: 'buttons left' },
        h('button', { type: 'button', class: 'primary', disabled: this.busy, onclick: () => void this.saveDocx() }, t('report.downloadDocx')),
        h('button', { type: 'button', disabled: this.busy || !hasFigures, onclick: () => void this.saveZip() }, t('report.downloadZip')),
        h('button', { type: 'button', disabled: this.busy, title: t('report.printTip'), onclick: () => window.print() }, t('report.print'))),
      this.busy ? h('p', { class: 'hint' }, t('report.working')) : null);
  }

  private document(doc: ReportDoc): HTMLElement {
    if (!doc.sections.length) return h('div', { class: 'report-doc' }, h('p', { class: 'hint' }, t('report.empty')));
    const items = state.report.items;
    return h('article', { class: 'report-doc', lang: doc.lang },
      doc.sections.map((s) => h('section', { class: 'report-section' },
        h('div', { class: 'section-tools no-print' },
          h('span', { class: 'section-name' }, t(`report.sectionName.${s.id}` as Key)),
          h('button', {
            type: 'button',
            class: 'small',
            title: t('report.copyTip'),
            onclick: () => {
              copySection(s).then(() => this.say(t('report.copied')), (e) => this.say(t('report.copyFailed', { detail: String(e) }), true));
            },
          }, t('report.copy'))),
        s.blocks.map((b) => this.block(b, items.findIndex((x) => x.id === itemIdOf(b)))))));
  }

  private block(b: Block, index: number): HTMLElement {
    const el = blockElement(b);
    if (b.type === 'figure') this.fillFigure(el, b);
    if (index < 0 || b.type === 'heading') return el;
    // After an edit only the caption or text changes, so it is updated in place
    const update = (value: string) => {
      if (b.type === 'paragraph') {
        el.replaceWith(blockElement({ ...b, runs: [{ text: value }] }));
        return;
      }
      const item = state.report.items[index];
      const caption = value.trim() || defaultCaption(item.snapshot);
      el.querySelector('.caption')!.textContent = b.type === 'figure' ? figureLabel({ ...b, caption }) : tableLabel({ ...b, caption });
    };
    return h('div', { class: 'report-item' }, el, this.itemTools(index, update));
  }

  /** Draws the figure into its frame, with buttons to copy and save it. */
  private fillFigure(el: HTMLElement, b: Extract<Block, { type: 'figure' }>): void {
    const frame = el.querySelector('.figure-frame')!;
    void renderFigure(b.snapshot).then((fig) => {
      if (!fig) {
        frame.replaceChildren(h('p', { class: 'warning' }, t('report.missing')));
        return;
      }
      const url = URL.createObjectURL(fig.blob);
      this.urls.push(url);
      frame.replaceChildren(
        h('img', { src: url, alt: b.caption, width: fig.width, height: fig.height }),
        h('div', { class: 'figure-tools no-print' },
          h('button', {
            type: 'button',
            class: 'small',
            onclick: () => {
              copyImage(renderFigure(b.snapshot).then((f) => f!.blob))
                .then(() => this.say(t('report.imageCopied')), (e) => this.say(t('report.copyFailed', { detail: String(e) }), true));
            },
          }, t('report.copyImage')),
          h('button', { type: 'button', class: 'small', onclick: () => download(fig.blob, b.fileName) }, t('report.saveImage'))));
    }, (e) => frame.replaceChildren(h('p', { class: 'error' }, String(e))));
  }

  /** Caption or text, order and removing, for an item the student added. */
  private itemTools(index: number, update: (value: string) => void): HTMLElement {
    const item = state.report.items[index];
    const n = state.report.items.length;
    const isText = item.snapshot.type === 'text';
    const save = (value: string) => {
      this.quiet = true;
      try {
        if (isText) state.updateReportItem(item.id, { snapshot: { type: 'text', text: value } });
        else state.updateReportItem(item.id, { caption: value });
      } finally {
        this.quiet = false;
      }
      update(value);
    };
    return h('div', { class: 'item-tools no-print' },
      h('label', { class: 'field' }, t(isText ? 'report.text' : 'report.caption'),
        h('textarea', {
          rows: isText ? 4 : 2,
          value: item.snapshot.type === 'text' ? item.snapshot.text : item.caption,
          placeholder: isText ? '' : defaultCaption(item.snapshot),
          onchange: (e: Event) => save((e.target as HTMLTextAreaElement).value),
        })),
      isText ? null : h('p', { class: 'hint' }, t('report.captionHint')),
      h('div', { class: 'buttons left' },
        h('button', { type: 'button', class: 'small', disabled: index === 0, 'aria-label': t('report.up'), title: t('report.up'), onclick: () => state.moveReportItem(item.id, -1) }, '↑'),
        h('button', { type: 'button', class: 'small', disabled: index === n - 1, 'aria-label': t('report.down'), title: t('report.down'), onclick: () => state.moveReportItem(item.id, 1) }, '↓'),
        h('button', {
          type: 'button',
          class: 'small danger',
          onclick: () => {
            if (confirm(t('report.removeConfirm'))) state.removeReportItem(item.id);
          },
        }, t('report.remove'))));
  }

  private addText(): HTMLElement {
    return h('section', { class: 'phase no-print' },
      h('h3', {}, t('report.addText')),
      h('p', { class: 'hint' }, t('report.addTextHint')),
      h('form', {
        class: 'report-text-form',
        onsubmit: (e: Event) => {
          e.preventDefault();
          const text = this.text.trim();
          if (!text) return;
          this.text = '';
          state.addReportItem({ snapshot: { type: 'text', text }, caption: '' });
        },
      },
      h('textarea', { rows: 3, value: this.text, 'aria-label': t('report.addText'), oninput: (e: Event) => (this.text = (e.target as HTMLTextAreaElement).value) }),
      h('button', { type: 'submit' }, t('report.addTextButton'))));
  }

  /** PNG bytes of all figures, by figure number. */
  private async figureFiles(doc: ReportDoc): Promise<Map<number, FigureFile & { fileName: string }>> {
    const out = new Map<number, FigureFile & { fileName: string }>();
    for (const b of figures(doc)) {
      const fig = await renderFigure(b.snapshot);
      if (fig) out.set(b.number, { png: new Uint8Array(await fig.blob.arrayBuffer()), width: fig.width, height: fig.height, fileName: b.fileName });
    }
    return out;
  }

  private async run(fn: () => Promise<string>): Promise<void> {
    this.busy = true;
    this.message = null;
    this.render();
    // Let the browser paint "working" first
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    try {
      this.message = { text: await fn() };
    } catch (e) {
      if (!(e instanceof Cancelled)) this.message = { text: t('report.saveFailed', { detail: String(e) }), error: true };
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private saveDocx(): Promise<void> {
    return this.run(async () => {
      const doc = buildReport();
      const bytes = docxBytes(doc, await this.figureFiles(doc));
      const file = `${exportBase()}-${t('report.fileName')}.docx`;
      await saveFile(bytes, file, DOCX, null);
      state.addLog('color', 'reportSaved', { file });
      return t('report.saved', { file });
    });
  }

  private saveZip(): Promise<void> {
    return this.run(async () => {
      const files = [...(await this.figureFiles(buildReport())).values()];
      const file = `${exportBase()}-${t('report.figuresFile')}.zip`;
      await saveFile(figuresZip(files), file, ZIP, null);
      state.addLog('color', 'figuresSaved', { n: files.length });
      return t('report.saved', { file });
    });
  }
}

function itemIdOf(b: Block): string | undefined {
  return b.type === 'heading' ? undefined : b.itemId;
}
