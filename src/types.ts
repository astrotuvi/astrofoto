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
}
