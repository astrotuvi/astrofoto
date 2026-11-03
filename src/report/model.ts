// The report as a simple document: headings, paragraphs, tables and figures with captions (§4.6).
// It is built once (build.ts) and rendered as the report page, the clipboard copy, .docx and the
// figures zip, so all of them say the same.

import type { ReportSectionId, ReportSnapshot } from '../types';

/** Width of a figure in the document, and of two images side by side, in cm. */
export const FIGURE_CM = 12;
export const PAIR_CM = 16;

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
  /**
   * A figure, drawn from its snapshot (figures.ts). The caption ("Joonis 3. …") goes below it.
   * Two images side by side are one figure; `pairItemId` is then the item of the second one.
   */
  | { type: 'figure'; number: number; caption: string; snapshot: FigureContent; widthCm: number; fileName: string; itemId?: string; pairItemId?: string };

export type FigureSnapshot = Exclude<ReportSnapshot, { type: 'boxStats' } | { type: 'text' }>;

/** Snapshots that can be shown side by side: images, not plots. */
export type PanelSnapshot = Extract<FigureSnapshot, { type: 'image' | 'color' | 'quickLook' }>;

/** What a figure shows: one snapshot, or two images side by side as panels (a) and (b). */
export type FigureContent = FigureSnapshot | { type: 'pair'; panels: [PanelSnapshot, PanelSnapshot] };

export function isPanel(s: ReportSnapshot): s is PanelSnapshot {
  return s.type === 'image' || s.type === 'color' || s.type === 'quickLook';
}

/** The caption of two images side by side. */
export function pairCaption(a: string, b: string): string {
  return `(a) ${a} (b) ${b}`;
}

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
