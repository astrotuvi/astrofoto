// Builds small synthetic FITS files for tests, so no real data is needed in the repository.

import { valueCard, type HeaderValue } from '../src/fits';

export interface SynthOptions {
  bitpix: 8 | 16 | 32 | -32 | -64;
  width: number;
  height: number;
  /** Stored (raw) values, before BZERO/BSCALE. */
  raw: number[];
  cards?: [string, HeaderValue][];
  /** Extra cards written as-is (80 chars max). */
  rawCards?: string[];
  primaryEmpty?: boolean;
}

function block(text: string): Uint8Array {
  const padded = text + ' '.repeat((2880 - (text.length % 2880)) % 2880);
  return Uint8Array.from(padded, (c) => c.charCodeAt(0));
}

function pad80(s: string): string {
  return s.padEnd(80).slice(0, 80);
}

function dataBytes(o: SynthOptions): Uint8Array {
  const bpp = Math.abs(o.bitpix) / 8;
  const n = o.width * o.height;
  const buf = new Uint8Array(Math.ceil((n * bpp) / 2880) * 2880);
  const v = new DataView(buf.buffer);
  o.raw.forEach((x, i) => {
    switch (o.bitpix) {
      case 8: v.setUint8(i, x); break;
      case 16: v.setInt16(i * 2, x); break;
      case 32: v.setInt32(i * 4, x); break;
      case -32: v.setFloat32(i * 4, x); break;
      case -64: v.setFloat64(i * 8, x); break;
    }
  });
  return buf;
}

export function synthFits(o: SynthOptions): Uint8Array<ArrayBuffer> {
  const imageCards = [
    valueCard('BITPIX', o.bitpix),
    valueCard('NAXIS', 2),
    valueCard('NAXIS1', o.width),
    valueCard('NAXIS2', o.height),
    ...(o.cards ?? []).map(([k, v]) => valueCard(k, v)),
    ...(o.rawCards ?? []).map(pad80),
    pad80('END'),
  ];
  const parts: Uint8Array[] = [];
  if (o.primaryEmpty) {
    parts.push(block([valueCard('SIMPLE', true), valueCard('BITPIX', 8), valueCard('NAXIS', 0), valueCard('EXTEND', true), pad80('END')].join('')));
    parts.push(block([valueCard('XTENSION', 'IMAGE'), ...imageCards.slice(0, 4), valueCard('PCOUNT', 0), valueCard('GCOUNT', 1), ...imageCards.slice(4)].join('')));
  } else {
    parts.push(block([valueCard('SIMPLE', true), ...imageCards].join('')));
  }
  parts.push(dataBytes(o));
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}
