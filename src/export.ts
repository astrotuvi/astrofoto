// Exported files: master frames and stacks as FITS, colour images as PNG. See docs/DESIGN.md §3.5.

import { zipSync } from 'fflate';
import type { ColorImage } from './color';
import { type FitsImage, writeFits } from './fits';
import { filterInfo } from './instrument/profile';
import { projectTitle } from './project';
import { state } from './state';

declare const __APP_VERSION__: string;

export interface FitsExport {
  /** Master or stack id. */
  id: string;
  fileName: string;
  image: FitsImage;
}

function safe(s: string): string {
  return s.trim().replace(/[\\/:*?"<>|\s]+/g, '_') || 'x';
}

/**
 * File names for filters. R (Johnson) and r (Sloan) would clash on Windows and macOS, where
 * file names ignore case, so such filters also get their system or a number.
 */
function filterNames(filters: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of filters) {
    const same = filters.filter((g) => g.toLowerCase() === f.toLowerCase());
    let name = safe(f);
    if (same.length > 1) {
      const system = state.profile ? filterInfo(state.profile, f)?.system : undefined;
      name += '-' + safe(system ?? String(same.indexOf(f) + 1)).toLowerCase();
    }
    out.set(f, name);
  }
  return out;
}

/** The master frames and stacks that can be saved, in processing order. */
export function fitsExports(): FitsExport[] {
  const masters = [...state.masters.values()];
  const stacks = [...state.stacks.values()];
  const names = filterNames([...new Set([...masters.map((m) => m.filter), ...stacks.map((s) => s.filter)])].filter(Boolean));
  const out: FitsExport[] = [];
  for (const kind of ['bias', 'dark', 'flat'] as const) {
    for (const m of masters.filter((x) => x.kind === kind)) {
      out.push({ id: m.id, fileName: `master-${kind}${m.filter ? '-' + names.get(m.filter) : ''}.fits`, image: m.image });
    }
  }
  for (const s of stacks) out.push({ id: s.id, fileName: `stack-${names.get(s.filter) ?? 'x'}.fits`, image: s.image });
  return out;
}

/** A 32-bit float FITS file. The image's HISTORY lines describe how it was made. */
export function fitsBytes(e: FitsExport): Uint8Array {
  return writeFits(e.image, e.image.cards, [`Written by Astrofoto ${__APP_VERSION__} on ${new Date().toISOString().slice(0, 19)}`]);
}

export function fitsZip(files: FitsExport[]): Uint8Array {
  // Float data hardly compresses; level 1 keeps it quick
  return zipSync(Object.fromEntries(files.map((f) => [f.fileName, [fitsBytes(f), { level: 1 }]])));
}

/** Base for exported file names: the project title. */
export function exportBase(): string {
  return safe(projectTitle());
}

/**
 * A PNG of a colour image, the right way up, at 1× or 2× size. 2× is smoothed, not blocky, for posters.
 * Runs in the browser (canvas).
 */
export async function pngBytes(img: ColorImage, flipY: boolean, scale: 1 | 2): Promise<Uint8Array> {
  const base = document.createElement('canvas');
  base.width = img.width;
  base.height = img.height;
  const ctx = base.getContext('2d')!;
  const data = ctx.createImageData(img.width, img.height);
  const row = img.width * 4;
  for (let y = 0; y < img.height; y++) {
    const src = (flipY ? img.height - 1 - y : y) * row;
    data.data.set(img.rgba.subarray(src, src + row), y * row);
  }
  ctx.putImageData(data, 0, 0);
  let out = base;
  if (scale === 2) {
    out = document.createElement('canvas');
    out.width = img.width * 2;
    out.height = img.height * 2;
    const c2 = out.getContext('2d')!;
    c2.imageSmoothingEnabled = true;
    c2.imageSmoothingQuality = 'high';
    c2.drawImage(base, 0, 0, out.width, out.height);
  }
  const blob = await new Promise<Blob>((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG'))), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}
