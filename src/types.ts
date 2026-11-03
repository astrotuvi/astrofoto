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
  /** True when the student typed the filter, so a profile change keeps it. */
  filterEdited?: boolean;
  exposure: number;
  dateObs: string;
  temperature?: number;
  xbin?: number; ybin?: number;
  width: number; height: number;
  header: Record<string, HeaderValue>;
  excluded?: boolean;
}

/** What the app reads from a header; each has a list of keywords to try (see instrument/defaults.ts). */
export type HeaderConcept = 'kind' | 'filter' | 'exposure' | 'temperature' | 'xbin' | 'ybin' | 'date'
  | 'focalLength' | 'pixelSize' | 'pixelScale' | 'gain' | 'saturation';

export interface InstrumentProfile {
  id: string;
  name: string;
  /** Names shown to the student and in the report; the header's TELESCOP/INSTRUME if not set. */
  telescope?: string;
  camera?: string;
  match?: { telescop?: string; instrume?: string };
  keywords: Partial<Record<HeaderConcept, string[]>>;
  kindValues: Partial<Record<Kind, string[]>>;
  trim: Region | null;           // null = none
  saturationLevel?: number;      // raw ADU
  pixelScale?: number;           // arcsec/px, after binning; overrides header values
  pixelSizeIncludesBinning?: boolean;
  gain?: number;                 // e-/ADU
  filters: Record<string, { wavelengthNm: number; system?: string }>;
  /** True for a profile made on import that nobody has checked yet. */
  generated?: boolean;
}

export type CombineMethod = 'median' | 'mean' | 'sigmaClip';

export type AlignModel = 'shift' | 'shiftRotation';

/**
 * Maps a light frame onto the reference: q = R(rotation)·(p − c) + c + (dx, dy), in raw
 * (untrimmed) 0-based pixel coordinates, with c the centre of the raw frame.
 */
export interface AlignTransform {
  dx: number;
  dy: number;
  /** Radians. */
  rotation: number;
  source: 'manual' | 'auto';
}

export interface ProcessingSettings {
  /** undefined = not decided yet; null = no trimming. Copied from the student's decision. */
  trim?: Region | null;
  combine: { bias: CombineMethod; dark: CombineMethod; flat: CombineMethod; stack: CombineMethod };
  /** Which masters are applied to the light frames; switched off for "what if" experiments. */
  useBias: boolean;
  useDark: boolean;
  useFlat: boolean;
  /** Subtract the dark (scaled to each flat's exposure) from the flats too. */
  darkForFlats: boolean;
  saturationLevel?: number;
  /** Light frame the others are aligned to; undefined = the first one in time. */
  referenceId?: string;
  alignModel: AlignModel;
  /** Chosen transform per light frame id. */
  transforms: Record<string, AlignTransform>;
  /** Stars clicked by the student per light frame, in raw 0-based coordinates; star k matches star k of the reference. */
  manualStars: Record<string, [number, number][]>;
}

export type Channel = 'R' | 'G' | 'B';

export interface ChannelSettings {
  /** Filter whose stack goes into this channel; null = channel left dark. */
  filter: string | null;
  /** Stack values (ADU) shown as black and as full brightness. */
  black: number;
  white: number;
  /** Multiplies the channel after scaling; sets the colour balance. */
  weight: number;
}

export interface Stretch {
  type: 'linear' | 'asinh';
  /** asinh only: larger values brighten faint parts more. */
  strength: number;
}

/** A colour image made of stacked filter images. */
export interface Composition {
  id: string;
  name: string;
  channels: Record<Channel, ChannelSettings>;
  stretch: Stretch;
  /** Sky brightness 0–1 that "Neutral sky" sets in every channel; SKY_LEVEL if missing. */
  skyLevel?: number;
}

/** Saved processing settings, e.g. "ilma tasaväljata", for "what if" comparisons (§4.4). */
export interface Version {
  id: string;
  name: string;
  settings: ProcessingSettings;
  created: string;
}

/** A mentor's comment on a step ('step:<id>') or a task ('task:<id>'). */
export interface MentorComment {
  text: string;
  date: string;
}

/** How an image is mapped to grey: from the faintest to the brightest pixel, percentiles, or set by hand. */
export type RangeMode = 'minmax' | 'p995' | 'p99' | 'manual';

/** How values between black and white are turned into grey. */
export type DisplayScale = 'linear' | 'sqrt' | 'log' | 'asinh';

export interface DisplayRange {
  mode: RangeMode;
  /** Used for 'manual'; for the other modes they are recomputed from the image. */
  black: number;
  white: number;
  /** Missing in projects from 0.8.0 and earlier: linear. */
  scale?: DisplayScale;
}

/**
 * What a report item shows and how to redraw it (§4.6). Images are not stored: figures are drawn
 * again from the current images, in the current language, when the report is shown or exported.
 * Image ids are those of the viewer (e.g. 'master:flat:g', 'cal:<frame id>', 'v:<version>:stack:V').
 */
export type ReportSnapshot =
  | {
    type: 'image';
    imageId: string;
    range: DisplayRange;
    /** Part of the image shown when zoomed in, in 0-based file coordinates; null = the whole image. */
    view: Region | null;
    /** Measuring marks drawn on the figure. */
    box?: Region | null;
    line?: { axis: 'row' | 'column'; index: number } | null;
  }
  /** A colour image with the settings it had when added. */
  | { type: 'color'; composition: Composition; view: Region | null }
  /** The quick look of these raw frames, one per channel. */
  | { type: 'quickLook'; frames: Record<Channel, string>; view: Region | null }
  | { type: 'profile'; imageId: string; axis: 'row' | 'column'; index: number }
  | { type: 'histogram'; imageId: string; box: Region | null; log: boolean; range: 'full' | 'clipped'; black: number; white: number }
  | { type: 'boxStats'; imageId: string; box: Region }
  /** A paragraph written by the student. */
  | { type: 'text'; text: string };

export interface ReportItem {
  id: string;
  snapshot: ReportSnapshot;
  /** Written by the student; '' = the automatic caption in the current language. */
  caption: string;
  added: string;
  /** Shown beside the previous item as one figure; both must be images. */
  beside?: boolean;
}

export type ReportSectionId = 'title' | 'data' | 'processing' | 'items' | 'tasks' | 'colour' | 'mentorComments';

export interface ReportSettings {
  /** Sections switched on or off; missing = the default (all on except the mentor's comments). */
  sections: Partial<Record<ReportSectionId, boolean>>;
  items: ReportItem[];
}
