// Shared data model. See docs/DESIGN.md §6.6.

import type { HeaderValue } from './fits';

export type Kind = 'bias' | 'dark' | 'flat' | 'light';
export const KINDS: Kind[] = ['bias', 'dark', 'flat', 'light'];

export type StepId = 'files' | 'trim' | 'bias' | 'dark' | 'flat' | 'calibrate'
  | 'align' | 'stack' | 'color';

/** 0-based, inclusive. */
export interface Region { x0: number; x1: number; y0: number; y1: number }

export interface FrameMeta {
  id: string;
  fileName: string;
  kind: Kind;
  /** Where the kind came from; 'guess' means neither header nor file name said it. */
  kindSource: 'header' | 'fileName' | 'guess' | 'user';
  filter: string;                // case-sensitive; '' for bias/dark
  exposure: number;
  dateObs: string;
  temperature?: number;
  xbin?: number; ybin?: number;
  width: number; height: number;
  header: Record<string, HeaderValue>;
  excluded?: boolean;
}

export interface InstrumentProfile {
  id: string;
  name: string;
  match?: { telescop?: string; instrume?: string };
  keywords: Partial<Record<'kind' | 'filter' | 'exposure' | 'temperature'
                         | 'xbin' | 'ybin' | 'date', string[]>>;
  kindValues: Partial<Record<Kind, string[]>>;
  trim: Region | null;           // null = none
  saturationLevel?: number;      // raw ADU
  pixelScale?: number;           // arcsec/px, after binning; overrides header values
  pixelSizeIncludesBinning?: boolean;
  gain?: number;                 // e-/ADU
  importBinning: 1 | 2 | 3;
  filters: Record<string, { wavelengthNm: number; system?: string }>;
  /** True for a profile made on import that nobody has checked yet. */
  generated?: boolean;
}
