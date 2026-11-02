import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { beforeEach, describe, expect, it } from 'vitest';
import { setLang } from '../src/i18n';
import { importFiles } from '../src/import';
import { refreshAll } from '../src/masters';
import { open, serialize } from '../src/project';
import { buildReport, defaultCaption } from '../src/report/build';
import { docxBytes } from '../src/report/docx';
import { sectionHtml, sectionText } from '../src/report/html';
import { type Block, figures, slug } from '../src/report/model';
import { state } from '../src/state';
import { synthFits } from './helpers';

const W = 6;
const frame = (name: string, type: string, value: (x: number) => number, filter = 'V') => ({
  name,
  file: new File([synthFits({
    bitpix: 16, width: W, height: 4, raw: Array.from({ length: W * 4 }, (_, i) => value(i % W)),
    cards: [['IMAGETYP', type], ['FILTER', filter], ['EXPTIME', type === 'BIAS' ? 0 : 30], ['OBJECT', 'M57'], ['TELESCOP', 'AZT-12']],
  })], name),
});

async function load(): Promise<void> {
  await importFiles([
    frame('b1.fits', 'BIAS', () => 1000),
    frame('b2.fits', 'BIAS', () => 1002),
    frame('f1.fits', 'FLAT', (x) => 21000 + 2000 * x),
    frame('l1.fits', 'LIGHT', (x) => 1500 + x),
  ]);
  state.updateSettings({ trim: null });
  for (const s of ['trim', 'bias', 'dark', 'flat', 'calibrate'] as const) state.setStep(s, { done: true });
  refreshAll();
}

const blocks = (id: string) => buildReport().sections.find((s) => s.id === id)?.blocks ?? [];
const texts = (list: Block[]) => list.map((b) => (b.type === 'paragraph' ? b.runs.map((r) => r.text).join('') : b.type === 'heading' ? b.text : ''));

/** Checks that every opened XML tag is closed in order. */
function balanced(xml: string): boolean {
  const stack: string[] = [];
  for (const m of xml.replace(/<\?[^>]*\?>/g, '').matchAll(/<(\/?)([\w:]+)[^>]*?(\/?)>/g)) {
    if (m[3]) continue;
    if (!m[1]) stack.push(m[2]);
    else if (stack.pop() !== m[2]) return false;
  }
  return stack.length === 0;
}

describe('report', () => {
  beforeEach(() => {
    state.clear();
    setLang('et');
  });

  it('builds the sections from the data and the decisions', async () => {
    await load();
    state.setInfo({ title: '', student: 'Mari' });
    const doc = buildReport();
    expect(doc.title).toBe('Minu projekt');
    expect(doc.sections.map((s) => s.id)).toEqual(['title', 'data', 'processing']);
    expect(texts(blocks('title'))).toContain('Autor: Mari');

    const data = blocks('data');
    expect(texts(data)).toContain('Objekt: M57');
    expect(texts(data)).toContain('Teleskoop: AZT-12');
    const table = data.find((b) => b.type === 'table')!;
    expect(table.type === 'table' && table.number).toBe(1);
    expect(table.type === 'table' && table.rows).toEqual([
      ['Eelpingekaader', '–', '2', '0'],
      ['Tasaväljakaader', 'V', '1', '30'],
      ['Objektikaader', 'V', '1', '30'],
    ]);

    const proc = texts(blocks('processing'));
    expect(proc).toContain('Kaadreid ei kärbitud.');
    expect(proc).toContain('Koondeelpingekaader arvutati 2 eelpingekaadrist, meetod: mediaan.');
    expect(proc).toContain('Seda liiki kaadreid polnud: pimekaader.');
    expect(proc).toContain('kalibreeritud = (objektikaader − eelpinge) / tasaväli');
  });

  it('numbers the figures and tables the student added, with automatic captions', async () => {
    await load();
    const id = state.framesOf('light')[0].meta.id;
    state.addReportItem({ snapshot: { type: 'boxStats', imageId: `cal:${id}`, box: { x0: 0, x1: 1, y0: 0, y1: 1 } }, caption: '' });
    state.addReportItem({ snapshot: { type: 'image', imageId: 'master:flat:V', range: { mode: 'manual', black: 0.9, white: 1.1 }, view: null }, caption: '' });
    state.addReportItem({ snapshot: { type: 'text', text: 'Minu selgitus.' }, caption: '' });
    state.addReportItem({ snapshot: { type: 'profile', imageId: id, axis: 'row', index: 1 }, caption: 'Oma allkiri' });

    const items = blocks('items');
    expect(items[0]).toEqual({ type: 'heading', level: 2, text: 'Joonised ja mõõtmised' });
    const stats = items[1];
    expect(stats.type).toBe('table');
    if (stats.type === 'table') {
      expect(stats.number).toBe(2);
      expect(stats.caption).toMatch(/^Statistika: Kalibreeritud objektikaadrid: l1\.fits, ala x = 1–2, y = 1–2\.$/);
      expect(stats.rows[0]).toEqual(['Piksleid', '4']);
    }
    const flat = items[2];
    expect(flat.type === 'figure' && flat.caption).toBe('Koondkaader: tasaväljakaader V. Hallskaala 0,90…1,10.');
    expect(flat.type === 'figure' && flat.fileName).toBe('joonis-01-koondkaader-tasavaljakaader-v.png');
    expect(items[3]).toMatchObject({ type: 'paragraph', itemId: 'r3' });
    expect(items[4]).toMatchObject({ type: 'figure', number: 2, caption: 'Oma allkiri' });
    expect(figures(buildReport()).map((f) => f.number)).toEqual([1, 2]);

    state.moveReportItem('r4', -1);
    expect(state.report.items.map((x) => x.id)).toEqual(['r1', 'r2', 'r4', 'r3']);
    state.removeReportItem('r1');
    expect(blocks('items').filter((b) => b.type === 'table')).toEqual([]);

    // Captions follow the language
    setLang('en');
    expect(defaultCaption(state.report.items[0].snapshot)).toBe('Master flat frame V. Grey scale 0.90…1.10.');
  });

  it('lists answers and leaves the mentor comments out unless asked', async () => {
    await load();
    state.setAnswer('header-keywords.kind', { value: 'imagetyp', correct: true, attempts: 0 });
    state.setAnswer('header-keywords.filter', { value: 'FILT', correct: false, attempts: 1 });
    state.addComment('step:flat', 'Hea töö!');
    const tasks = texts(blocks('tasks'));
    expect(tasks).toContain('Kaadri liik: IMAGETYP ✓');
    expect(tasks).toContain('Filter: FILT');
    expect(tasks).toContain('Säriaeg: –');
    expect(blocks('mentorComments')).toEqual([]);

    state.setReportSection('mentorComments', true);
    state.setReportSection('tasks', false);
    expect(blocks('tasks')).toEqual([]);
    expect(texts(blocks('mentorComments')).some((s) => s.endsWith('Hea töö!'))).toBe(true);
  });

  it('copies a section as HTML and plain text', async () => {
    await load();
    const data = buildReport().sections.find((s) => s.id === 'data')!;
    const html = sectionHtml(data);
    expect(html).toContain('<h2>Andmed</h2>');
    expect(html).toContain('<p><b>Objekt: </b>M57</p>');
    expect(html).toContain('<p><i>Tabel 1. Kasutatud kaadrid.</i></p>');
    expect(html).toContain('<th>Liik</th>');
    expect(sectionText(data)).toContain('Liik\tFilter\tKaadreid\tSäriaeg (s)');
  });

  it('writes a .docx with headings, tables, images and captions', async () => {
    await load();
    state.addReportItem({ snapshot: { type: 'image', imageId: 'master:bias', range: { mode: 'minmax', black: 0, white: 1 }, view: null }, caption: 'Eelpinge & <müra>' });
    state.addReportItem({ snapshot: { type: 'profile', imageId: 'master:bias', axis: 'row', index: 0 }, caption: '' });
    const doc = buildReport();
    const png = new Uint8Array([137, 80, 78, 71]);
    const files = unzipSync(docxBytes(doc, new Map([[1, { png, width: 1600, height: 800 }]])));
    expect(Object.keys(files).sort()).toEqual([
      '[Content_Types].xml', '_rels/.rels', 'docProps/core.xml', 'word/_rels/document.xml.rels', 'word/document.xml', 'word/media/image1.png', 'word/styles.xml',
    ]);
    const xml = strFromU8(files['word/document.xml']);
    for (const name of Object.keys(files).filter((n) => !n.endsWith('.png'))) expect(balanced(strFromU8(files[name])), name).toBe(true);
    expect(xml).toContain('<w:pStyle w:val="Heading1"/>');
    expect(xml).toContain('<w:tbl>');
    expect(xml).toContain('Joonis 1. Eelpinge &amp; &lt;müra&gt;');
    // 16 cm wide, half as high
    expect(xml).toContain('<wp:extent cx="5760000" cy="2880000"/>');
    // Figure 2 has no image: a note instead
    expect(xml).toContain('Seda pilti praegu pole');
    expect(strFromU8(files['word/_rels/document.xml.rels'])).toContain('Target="media/image1.png"');
    expect(strFromU8(files['word/styles.xml'])).toContain('<w:name w:val="heading 1"/>');
  });

  it('keeps the report in the project file', async () => {
    await load();
    state.addReportItem({ snapshot: { type: 'text', text: 'Sissejuhatus' }, caption: '' });
    state.setReportSection('data', false);
    const bytes = serialize();
    state.clear();
    open(bytes);
    expect(state.report.items.map((x) => x.snapshot)).toEqual([{ type: 'text', text: 'Sissejuhatus' }]);
    expect(state.report.sections).toEqual({ data: false });

    // Projects from 0.6 have no report
    const files = unzipSync(bytes);
    const json = JSON.parse(strFromU8(files['project.json']));
    delete json.report;
    files['project.json'] = strToU8(JSON.stringify(json));
    open(zipSync(files));
    expect(state.report).toEqual({ sections: {}, items: [] });
  });

  it('makes file names without accents', () => {
    expect(slug('Koondkaader: tasaväljakaader g')).toBe('koondkaader-tasavaljakaader-g');
    expect(slug('Õhtu ÜLE šokolaadi')).toBe('ohtu-ule-sokolaadi');
    expect(slug('***')).toBe('x');
  });
});
