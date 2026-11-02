// FITS reader and writer. See docs/DESIGN.md §6.4.

import { gunzipSync } from 'fflate';

const BLOCK = 2880;
const CARD = 80;

export type HeaderValue = string | number | boolean;

export interface HeaderCard {
  key: string;            // '' for blank cards
  value?: HeaderValue;
  comment?: string;
  raw: string;            // the card as read (CONTINUE cards appended)
}

export interface FitsImage {
  width: number;
  height: number;
  /** Row-major, row 0 is the first row in the file. */
  data: Float32Array;
  cards: HeaderCard[];
  /** Keyword → value, first occurrence wins. COMMENT/HISTORY are not included. */
  header: Record<string, HeaderValue>;
  bitpix: number;
  /** Index of the HDU the image came from (0 = primary). */
  hdu: number;
  warnings: FitsWarning[];
}

export type FitsErrorCode = 'notFits' | 'noEnd' | 'badExtension' | 'noImage' | 'truncated' | 'bitpix' | 'compressed';
export type FitsWarning = 'multiplePlanes';

export class FitsError extends Error {
  constructor(readonly code: FitsErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/** Reads the first HDU that contains a 2D image. Accepts gzip-compressed files. */
export function readFits(input: ArrayBuffer | Uint8Array): FitsImage {
  let bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (isGzip(bytes)) bytes = gunzipSync(bytes);

  let offset = 0;
  let hdu = 0;
  while (offset < bytes.length) {
    const { cards, end } = readHeader(bytes, offset, hdu);
    const header = cardsToRecord(cards);
    const dataStart = end;
    const dataBytes = dataSize(header);
    const naxis = num(header.NAXIS) ?? 0;
    const xtension = typeof header.XTENSION === 'string' ? header.XTENSION.toUpperCase() : 'IMAGE';

    if (xtension === 'IMAGE' && naxis >= 2 && dataBytes > 0) {
      return readImage(bytes, dataStart, cards, header, hdu);
    }
    if (xtension === 'BINTABLE' && header.ZIMAGE === true) {
      throw new FitsError('compressed');
    }
    offset = dataStart + Math.ceil(dataBytes / BLOCK) * BLOCK;
    hdu++;
  }
  throw new FitsError('noImage');
}

function readHeader(bytes: Uint8Array, start: number, hdu: number): { cards: HeaderCard[]; end: number } {
  const cards: HeaderCard[] = [];
  const decoder = new TextDecoder('latin1');
  let pos = start;
  for (;;) {
    if (pos + CARD > bytes.length) throw new FitsError('noEnd');
    const raw = decoder.decode(bytes.subarray(pos, pos + CARD));
    pos += CARD;
    if (pos - start === CARD) {
      const first = raw.slice(0, 8).trim();
      if (hdu === 0 && first !== 'SIMPLE') throw new FitsError('notFits');
      if (hdu > 0 && first !== 'XTENSION') throw new FitsError('badExtension');
    }
    const key = raw.slice(0, 8).trim();
    if (key === 'END') break;
    if (key === 'CONTINUE') {
      const prev = cards[cards.length - 1];
      if (prev && typeof prev.value === 'string' && prev.value.endsWith('&')) {
        const { value, comment } = parseValue(raw.slice(8));
        prev.value = prev.value.slice(0, -1) + (typeof value === 'string' ? value : '');
        if (comment) prev.comment = prev.comment ? `${prev.comment} ${comment}` : comment;
        prev.raw += '\n' + raw.trimEnd();
        continue;
      }
    }
    cards.push(parseCard(raw));
  }
  return { cards, end: start + Math.ceil((pos - start) / BLOCK) * BLOCK };
}

function parseCard(raw: string): HeaderCard {
  let key = raw.slice(0, 8).trim();
  if (key === 'COMMENT' || key === 'HISTORY' || key === '') {
    return { key, comment: raw.slice(8).trimEnd(), raw: raw.trimEnd() };
  }
  if (key === 'HIERARCH') {
    const eq = raw.indexOf('=');
    if (eq < 0) return { key, comment: raw.slice(8).trimEnd(), raw: raw.trimEnd() };
    key = raw.slice(9, eq).trim();
    return { key, ...parseValue(raw.slice(eq + 1)), raw: raw.trimEnd() };
  }
  if (raw.slice(8, 10) !== '= ') {
    return { key, comment: raw.slice(8).trimEnd(), raw: raw.trimEnd() };
  }
  return { key, ...parseValue(raw.slice(10)), raw: raw.trimEnd() };
}

/** Parses the value/comment part of a card (everything after "= "). */
function parseValue(text: string): { value?: HeaderValue; comment?: string } {
  const s = text.trimStart();
  if (s.startsWith("'")) {
    let i = 1;
    let out = '';
    while (i < s.length) {
      if (s[i] === "'") {
        if (s[i + 1] === "'") { out += "'"; i += 2; continue; }
        break;
      }
      out += s[i++];
    }
    const rest = s.slice(i + 1);
    const slash = rest.indexOf('/');
    return { value: out.trimEnd(), comment: slash >= 0 ? rest.slice(slash + 1).trim() : undefined };
  }
  const slash = s.indexOf('/');
  const valueText = (slash >= 0 ? s.slice(0, slash) : s).trim();
  const comment = slash >= 0 ? s.slice(slash + 1).trim() : undefined;
  if (valueText === 'T') return { value: true, comment };
  if (valueText === 'F') return { value: false, comment };
  if (valueText === '') return { comment };
  const n = Number(valueText.replace(/[dD]/, 'e'));
  return { value: Number.isFinite(n) ? n : valueText, comment };
}

function cardsToRecord(cards: HeaderCard[]): Record<string, HeaderValue> {
  const rec: Record<string, HeaderValue> = {};
  for (const c of cards) {
    if (c.value !== undefined && !(c.key in rec)) rec[c.key] = c.value;
  }
  return rec;
}

function num(v: HeaderValue | undefined): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

function dataSize(header: Record<string, HeaderValue>): number {
  const naxis = num(header.NAXIS) ?? 0;
  if (naxis === 0) return 0;
  let n = 1;
  for (let i = 1; i <= naxis; i++) n *= num(header[`NAXIS${i}`]) ?? 0;
  const pcount = num(header.PCOUNT) ?? 0;
  const gcount = num(header.GCOUNT) ?? 1;
  return (Math.abs(num(header.BITPIX) ?? 8) / 8) * gcount * (pcount + n);
}

function readImage(
  bytes: Uint8Array,
  start: number,
  cards: HeaderCard[],
  header: Record<string, HeaderValue>,
  hdu: number,
): FitsImage {
  const warnings: FitsWarning[] = [];
  const bitpix = num(header.BITPIX);
  const width = num(header.NAXIS1) ?? 0;
  const height = num(header.NAXIS2) ?? 0;
  const naxis = num(header.NAXIS) ?? 0;
  for (let i = 3; i <= naxis; i++) {
    if ((num(header[`NAXIS${i}`]) ?? 1) > 1) {
      warnings.push('multiplePlanes');
      break;
    }
  }
  const bzero = num(header.BZERO) ?? 0;
  const bscale = num(header.BSCALE) ?? 1;
  const blank = num(header.BLANK);
  const n = width * height;
  const bpp = Math.abs(bitpix ?? 0) / 8;
  if (start + n * bpp > bytes.length) throw new FitsError('truncated');

  const view = new DataView(bytes.buffer, bytes.byteOffset + start, n * bpp);
  const data = new Float32Array(n);
  switch (bitpix) {
    case 8:
      for (let i = 0; i < n; i++) {
        const v = view.getUint8(i);
        data[i] = v === blank ? NaN : v * bscale + bzero;
      }
      break;
    case 16:
      for (let i = 0; i < n; i++) {
        const v = view.getInt16(i * 2);
        data[i] = v === blank ? NaN : v * bscale + bzero;
      }
      break;
    case 32:
      for (let i = 0; i < n; i++) {
        const v = view.getInt32(i * 4);
        data[i] = v === blank ? NaN : v * bscale + bzero;
      }
      break;
    case -32:
      for (let i = 0; i < n; i++) data[i] = view.getFloat32(i * 4) * bscale + bzero;
      break;
    case -64:
      for (let i = 0; i < n; i++) data[i] = view.getFloat64(i * 8) * bscale + bzero;
      break;
    default:
      throw new FitsError('bitpix', String(bitpix));
  }
  return { width, height, data, cards, header, bitpix, hdu, warnings };
}

// ---------------------------------------------------------------- writing

const DROP_ON_WRITE = new Set([
  'SIMPLE', 'XTENSION', 'BITPIX', 'NAXIS', 'EXTEND', 'BZERO', 'BSCALE', 'BLANK',
  'PCOUNT', 'GCOUNT', 'CHECKSUM', 'DATASUM', 'END',
]);

/**
 * Writes a 32-bit float FITS file. Cards from `cards` are copied, except structural
 * keywords and CHECKSUM/DATASUM; `history` lines are appended as HISTORY cards.
 */
export function writeFits(
  image: { width: number; height: number; data: Float32Array },
  cards: HeaderCard[] = [],
  history: string[] = [],
): Uint8Array {
  const out: string[] = [
    valueCard('SIMPLE', true, 'conforms to FITS standard'),
    valueCard('BITPIX', -32, 'IEEE single precision floating point'),
    valueCard('NAXIS', 2),
    valueCard('NAXIS1', image.width),
    valueCard('NAXIS2', image.height),
  ];
  for (const c of cards) {
    if (DROP_ON_WRITE.has(c.key) || /^NAXIS\d+$/.test(c.key)) continue;
    for (const line of c.raw.split('\n')) out.push(pad(line));
  }
  for (const h of history) {
    for (let i = 0; i < Math.max(1, h.length); i += 72) out.push(pad('HISTORY ' + h.slice(i, i + 72)));
  }
  out.push(pad('END'));

  let text = out.join('');
  text += ' '.repeat((BLOCK - (text.length % BLOCK)) % BLOCK);
  const headerBytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) headerBytes[i] = text.charCodeAt(i) & 0xff;

  const n = image.width * image.height;
  const dataLen = Math.ceil((n * 4) / BLOCK) * BLOCK;
  const result = new Uint8Array(headerBytes.length + dataLen);
  result.set(headerBytes);
  const view = new DataView(result.buffer, headerBytes.length, n * 4);
  for (let i = 0; i < n; i++) view.setFloat32(i * 4, image.data[i]);
  return result;
}

function pad(s: string): string {
  return s.length >= CARD ? s.slice(0, CARD) : s + ' '.repeat(CARD - s.length);
}

export function valueCard(key: string, value: HeaderValue, comment?: string): string {
  let v: string;
  if (typeof value === 'boolean') v = (value ? 'T' : 'F').padStart(20);
  else if (typeof value === 'number') v = formatNumber(value).padStart(20);
  else v = `'${value.replace(/'/g, "''").padEnd(8)}'`;
  return pad(`${key.padEnd(8)}= ${v}${comment ? ' / ' + comment : ''}`);
}

function formatNumber(x: number): string {
  if (Number.isInteger(x)) return String(x);
  const s = String(x);
  return s.includes('.') || s.includes('e') ? s.toUpperCase() : s + '.';
}
