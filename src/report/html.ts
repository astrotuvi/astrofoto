// The report as HTML: the blocks of the report page, and sections copied to the clipboard as
// text/html and text/plain (§4.6). Copied sections hold the text and tables; figures are copied one
// by one as images ("Kopeeri pilt"), because pasted HTML images are often dropped by Google Docs.

import { h } from '../dom';
import { t } from '../i18n';
import { esc } from './docx';
import { type Block, plain, type Run, type Section } from './model';

function runsHtml(runs: Run[]): string {
  return runs.map((r) => {
    let s = esc(r.text).replace(/\n/g, '<br>');
    if (r.italic) s = `<i>${s}</i>`;
    if (r.bold) s = `<b>${s}</b>`;
    return s;
  }).join('');
}

export function figureLabel(b: Extract<Block, { type: 'figure' }>): string {
  return `${t('report.figure', { n: b.number })} ${b.caption}`;
}

export function tableLabel(b: Extract<Block, { type: 'table' }>): string {
  return `${t('report.table', { n: b.number })} ${b.caption}`;
}

/** A section as simple HTML: headings, paragraphs, tables with borders, and figure captions. */
export function sectionHtml(s: Section): string {
  return s.blocks.map((b) => {
    switch (b.type) {
      case 'heading': return `<h${b.level}>${esc(b.text)}</h${b.level}>`;
      case 'paragraph': return `<p>${runsHtml(b.runs)}</p>`;
      case 'table': {
        const cell = (tag: string, text: string) => `<${tag}>${esc(text)}</${tag}>`;
        return `<p><i>${esc(tableLabel(b))}</i></p>`
          + '<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse">'
          + `<thead><tr>${b.header.map((c) => cell('th', c)).join('')}</tr></thead>`
          + `<tbody>${b.rows.map((r) => `<tr>${r.map((c) => cell('td', c)).join('')}</tr>`).join('')}</tbody></table>`;
      }
      case 'figure': return `<p><i>${esc(figureLabel(b))}</i></p>`;
    }
  }).join('\n');
}

/** A section as plain text, with tables as tab-separated lines. */
export function sectionText(s: Section): string {
  return s.blocks.map((b) => {
    switch (b.type) {
      case 'heading': return b.text;
      case 'paragraph': return plain(b.runs);
      case 'table': return [tableLabel(b), b.header.join('\t'), ...b.rows.map((r) => r.join('\t'))].join('\n');
      case 'figure': return figureLabel(b);
    }
  }).join('\n\n');
}

/** Copies a section with its formatting; plain text where the browser cannot copy HTML. */
export async function copySection(s: Section): Promise<void> {
  const html = sectionHtml(s);
  const text = sectionText(s);
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([text], { type: 'text/plain' }),
    })]);
  } else {
    await navigator.clipboard.writeText(text);
  }
}

/** Copies a figure as a PNG image. The image is given as a promise, so Safari keeps the click's permission. */
export async function copyImage(png: Promise<Blob>): Promise<void> {
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}

function runsDom(runs: Run[]): (Node | string)[] {
  return runs.map((r) => {
    const lines = r.text.split('\n').flatMap((line, i) => (i ? [h('br'), line] : [line]));
    let el: Node = h('span', {}, ...lines);
    if (r.italic) el = h('i', {}, el);
    if (r.bold) el = h('b', {}, el);
    return el;
  });
}

/** A block on the report page. Figures get an empty frame that the page fills with the image. */
export function blockElement(b: Block): HTMLElement {
  switch (b.type) {
    case 'heading': return h(`h${b.level}`, {}, b.text);
    case 'paragraph': return h('p', {}, ...runsDom(b.runs));
    case 'table':
      return h('div', { class: 'report-table' },
        h('p', { class: 'caption' }, tableLabel(b)),
        h('table', {},
          h('thead', {}, h('tr', {}, b.header.map((c) => h('th', {}, c)))),
          h('tbody', {}, b.rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, c)))))));
    case 'figure':
      return h('figure', { class: b.snapshot.type === 'pair' ? 'report-figure pair' : 'report-figure' },
        h('div', { class: 'figure-frame' }, h('p', { class: 'hint' }, t('report.drawing'))),
        h('figcaption', { class: 'caption' }, figureLabel(b)));
  }
}
