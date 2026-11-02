// The report as a simple document: headings, paragraphs, tables and figures with captions (§4.6).
// It is built once (build.ts) and rendered as the report page, the clipboard copy, .docx and the
// figures zip, so all of them say the same.

import type { ReportSectionId, ReportSnapshot } from '../types';

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  /** `itemId` marks a paragraph written by the student (a text item). */
  | { type: 'paragraph'; runs: Run[]; itemId?: string }
  /** A table with simple cells. The caption ("Tabel 2. …") goes above it. */
  | { type: 'table'; number: number; caption: string; header: string[]; rows: string[][]; itemId?: string }
  /** A figure, drawn from its snapshot (figures.ts). The caption ("Joonis 3. …") goes below it. */
  | { type: 'figure'; number: number; caption: string; snapshot: FigureSnapshot; fileName: string; itemId?: string };

export type FigureSnapshot = Exclude<ReportSnapshot, { type: 'boxStats' } | { type: 'text' }>;

export interface Section {
  id: ReportSectionId;
  blocks: Block[];
}

export interface ReportDoc {
  title: string;
  author: string;
  lang: 'et' | 'en';
  sections: Section[];
}

export function plain(runs: Run[]): string {
  return runs.map((r) => r.text).join('');
}

/** Figures of a document, in order. */
export function figures(doc: ReportDoc): Extract<Block, { type: 'figure' }>[] {
  return doc.sections.flatMap((s) => s.blocks.filter((b): b is Extract<Block, { type: 'figure' }> => b.type === 'figure'));
}

/** A file name part without accents or spaces, e.g. "koondtasavaljakaader-g". */
export function slug(s: string, max = 40): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '') || 'x';
}
