// The report as a Word file (.docx), written directly as Office Open XML and zipped with fflate.
// Only what survives moving into Google Docs is used (§4.6): heading styles "heading 1–3",
// paragraphs with bold and italic, tables with simple cells and plain borders, images on their
// own line at the full text width (16 cm on A4), and captions as separate text.

import { strToU8, zipSync } from 'fflate';
import type { Block, ReportDoc, Run } from './model';
import { t } from '../i18n';

export interface FigureFile {
  png: Uint8Array;
  width: number;
  height: number;
}

const EMU_PER_CM = 360000;
const TEXT_WIDTH_CM = 16;
/** Text width in twentieths of a point: A4 (21 cm) minus 2.5 cm margins. */
const TEXT_WIDTH_TWIPS = 9072;
const MARGIN_TWIPS = 1417;

const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

export function esc(s: string): string {
  // Control characters are not allowed in XML
  return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function textRuns(text: string, props = ''): string {
  const rPr = props ? `<w:rPr>${props}</w:rPr>` : '';
  return text.split('\n').map((line, i) =>
    `<w:r>${rPr}${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${esc(line)}</w:t></w:r>`).join('');
}

function runs(list: Run[]): string {
  return list.map((r) => textRuns(r.text, `${r.bold ? '<w:b/>' : ''}${r.italic ? '<w:i/>' : ''}`)).join('');
}

function paragraph(content: string, style?: string, keepNext = false): string {
  const pPr = style || keepNext ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${keepNext ? '<w:keepNext/>' : ''}</w:pPr>` : '';
  return `<w:p>${pPr}${content}</w:p>`;
}

function table(header: string[], rows: string[][]): string {
  const n = Math.max(1, header.length);
  const w = Math.floor(TEXT_WIDTH_TWIPS / n);
  const border = (side: string) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="808080"/>`;
  const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('');
  const cell = (text: string, bold: boolean) =>
    `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/></w:tcPr>${paragraph(textRuns(text, bold ? '<w:b/>' : ''), 'TableText')}</w:tc>`;
  return '<w:tbl>'
    + `<w:tblPr><w:tblW w:w="${w * n}" w:type="dxa"/><w:tblBorders>${borders}</w:tblBorders>`
    + '<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr>'
    + `<w:tblGrid>${`<w:gridCol w:w="${w}"/>`.repeat(n)}</w:tblGrid>`
    + `<w:tr><w:trPr><w:tblHeader/></w:trPr>${header.map((c) => cell(c, true)).join('')}</w:tr>`
    + rows.map((r) => `<w:tr>${Array.from({ length: n }, (_, i) => cell(r[i] ?? '', false)).join('')}</w:tr>`).join('')
    + '</w:tbl>';
}

function image(rid: string, id: number, name: string, f: FigureFile): string {
  const cx = TEXT_WIDTH_CM * EMU_PER_CM;
  const cy = Math.round((cx * f.height) / f.width);
  return '<w:r><w:drawing>'
    + '<wp:inline distT="0" distB="0" distL="0" distR="0">'
    + `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="${esc(name)}"/>`
    + '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>'
    + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>'
    + `<pic:nvPicPr><pic:cNvPr id="${id}" name="${esc(name)}"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>`
    + '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
}

function styles(lang: string): string {
  const heading = (n: number, size: number) =>
    `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>`
    + `<w:pPr><w:keepNext/><w:spacing w:before="${n === 1 ? 0 : 240}" w:after="120"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`;
  return XML + `<w:styles xmlns:w="${NS_W}">`
    + '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/>'
    + `<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="${lang}"/></w:rPr></w:rPrDefault>`
    + '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
    + heading(1, 36) + heading(2, 28) + heading(3, 24)
    + '<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="35"/><w:qFormat/>'
    + '<w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:i/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>'
    + '<w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="Table Text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="40" w:after="40"/></w:pPr></w:style>'
    + '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/>'
    + '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>'
    + '</w:styles>';
}

/** Builds the .docx file. `images` holds the PNG of each figure by its number; missing ones get a note. */
export function docxBytes(doc: ReportDoc, images: Map<number, FigureFile>): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const rels: string[] = [`<Relationship Id="rIdStyles" Type="${REL}/styles" Target="styles.xml"/>`];
  const body: string[] = [];
  const add = (b: Block) => {
    switch (b.type) {
      case 'heading':
        body.push(paragraph(textRuns(b.text), `Heading${b.level}`));
        break;
      case 'paragraph':
        body.push(paragraph(runs(b.runs)));
        break;
      case 'table':
        body.push(paragraph(textRuns(`${t('report.table', { n: b.number })} ${b.caption}`), 'Caption', true));
        body.push(table(b.header, b.rows));
        // Space after the table; Word also needs a paragraph between two tables
        body.push(paragraph(''));
        break;
      case 'figure': {
        const f = images.get(b.number);
        if (f) {
          const rid = `rIdImg${b.number}`;
          files[`word/media/image${b.number}.png`] = f.png;
          rels.push(`<Relationship Id="${rid}" Type="${REL}/image" Target="media/image${b.number}.png"/>`);
          body.push(paragraph(image(rid, b.number, b.fileName, f), undefined, true));
        } else {
          body.push(paragraph(textRuns(t('report.missing'), '<w:i/>'), undefined, true));
        }
        body.push(paragraph(textRuns(`${t('report.figure', { n: b.number })} ${b.caption}`), 'Caption'));
        break;
      }
    }
  };
  for (const s of doc.sections) for (const b of s.blocks) add(b);

  const lang = doc.lang === 'et' ? 'et-EE' : 'en-GB';
  const document = XML
    + `<w:document xmlns:w="${NS_W}" xmlns:r="${NS_R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"`
    + ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + `<w:body>${body.join('')}`
    + `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="${MARGIN_TWIPS}" w:right="${MARGIN_TWIPS}" w:bottom="${MARGIN_TWIPS}" w:left="${MARGIN_TWIPS}" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`
    + '</w:body></w:document>';
  const now = new Date().toISOString().slice(0, 19) + 'Z';

  files['[Content_Types].xml'] = strToU8(XML
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Default Extension="png" ContentType="image/png"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
    + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
    + '</Types>');
  files['_rels/.rels'] = strToU8(XML
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/>`
    + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
    + '</Relationships>');
  files['docProps/core.xml'] = strToU8(XML
    + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"'
    + ' xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
    + `<dc:title>${esc(doc.title)}</dc:title><dc:creator>${esc(doc.author)}</dc:creator><dc:language>${lang}</dc:language>`
    + `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>`
    + '</cp:coreProperties>');
  files['word/document.xml'] = strToU8(document);
  files['word/styles.xml'] = strToU8(styles(lang));
  files['word/_rels/document.xml.rels'] = strToU8(XML
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`);
  // PNG data is already compressed
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, [v, { level: k.endsWith('.png') ? 0 : 6 }]])));
}

/** The figures as PNG files, named by number, e.g. joonis-03-koondtasavaljakaader-g.png. */
export function figuresZip(files: { fileName: string; png: Uint8Array }[]): Uint8Array {
  return zipSync(Object.fromEntries(files.map((f) => [f.fileName, [f.png, { level: 0 }]])));
}
