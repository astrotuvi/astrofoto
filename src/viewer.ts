// Image display on a canvas: zoom, pan, display range, overlays and pointer tools.

import { greyLevel } from './stats';
import type { DisplayScale, Region } from './types';

export type Tool = 'pixel' | 'profile' | 'box' | 'pick';
export type ProfileAxis = 'row' | 'column';

export interface ViewImage {
  width: number;
  height: number;
  data: Float32Array;
  /** True when file row 0 is the bottom of the image (the FITS default). */
  flipY: boolean;
  /** A colour image (RGBA bytes in file row order), shown as it is instead of `data`. */
  rgba?: Uint8ClampedArray;
}

/** A circle drawn on the image, e.g. a clicked star; 0-based file coordinates. */
export interface Marker {
  x: number;
  y: number;
  label?: string;
  /** 'ghost' is drawn dimmer, e.g. where a star was in the reference frame. */
  style?: 'star' | 'ghost';
}

/** A second image of the same size, shown instead of the first (blink) or to the right of a line (split). */
export interface Compare {
  image: ViewImage;
  mode: 'blink' | 'split';
  /** Blink: true while the second image is shown. */
  showSecond: boolean;
  /** Split: where the line is, 0–1 of the image width. */
  at: number;
}

export interface ViewerEvents {
  /** Pointer over the image; 0-based file coordinates, or null when outside. `second` = from the compared image. */
  hover?: (p: { x: number; y: number; value: number; second?: boolean } | null) => void;
  profile?: (axis: ProfileAxis, index: number) => void;
  box?: (region: Region | null) => void;
  zoom?: (scale: number) => void;
  /** A click (not a drag) with the pick tool; 0-based file coordinates of the pixel centre. */
  pick?: (p: { x: number; y: number }) => void;
}

const MIN_SCALE = 1 / 16;
const MAX_SCALE = 32;
/** How far past its edge a large image can be panned, in CSS pixels. */
const PAN_MARGIN = 32;

export class Viewer {
  readonly element: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private bitmap = document.createElement('canvas');
  private image: ViewImage | null = null;
  private second = document.createElement('canvas');
  private compare: Compare | null = null;
  private black = 0;
  private white = 1;
  private greyScale: DisplayScale = 'linear';
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private fitted = true;
  private tool: Tool = 'pixel';
  private profileAxis: ProfileAxis = 'row';
  private profileIndex: number | null = null;
  private box: Region | null = null;
  private region: Region | null = null;
  private markers: Marker[] = [];
  private drag: { mode: 'pan' | 'box' | 'click'; startX: number; startY: number; ox: number; oy: number; ix: number; iy: number } | null = null;

  constructor(private events: ViewerEvents = {}) {
    this.element = document.createElement('div');
    this.element.className = 'viewer';
    this.canvas = document.createElement('canvas');
    this.element.append(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    new ResizeObserver(() => this.resize()).observe(this.element);
    this.canvas.addEventListener('pointerdown', (e) => this.pointerDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.pointerMove(e));
    this.canvas.addEventListener('pointerup', (e) => this.pointerUp(e));
    this.canvas.addEventListener('pointerleave', () => this.events.hover?.(null));
    this.canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
  }

  setImage(image: ViewImage | null): void {
    const sameSize = image && this.image && image.width === this.image.width && image.height === this.image.height;
    this.image = image;
    if (this.compare && (!image || image.width !== this.compare.image.width || image.height !== this.compare.image.height)) this.compare = null;
    if (!sameSize) {
      this.box = null;
      this.profileIndex = null;
      this.fitted = true;
    }
    this.renderBitmap();
    if (this.fitted) this.fit();
    else {
      this.clampOffset();
      this.draw();
    }
  }

  setRange(black: number, white: number, scale: DisplayScale = 'linear'): void {
    this.black = black;
    this.white = white;
    this.greyScale = scale;
    this.renderBitmap();
    if (this.compare) this.renderInto(this.second, this.compare.image);
    this.draw();
  }

  /** Compares with a second image of the same size, in the same display range; null ends it. */
  setCompare(c: Compare | null): void {
    const newImage = c?.image !== this.compare?.image;
    this.compare = c && this.image && c.image.width === this.image.width && c.image.height === this.image.height ? c : null;
    if (this.compare && newImage) this.renderInto(this.second, this.compare.image);
    this.draw();
  }

  setTool(tool: Tool): void {
    this.tool = tool;
    this.canvas.dataset.tool = tool;
    this.draw();
  }

  setProfileAxis(axis: ProfileAxis): void {
    this.profileAxis = axis;
    this.profileIndex = null;
    this.draw();
  }

  setProfile(axis: ProfileAxis, index: number | null): void {
    this.profileAxis = axis;
    this.profileIndex = index;
    this.draw();
  }

  /** A dashed outline, e.g. the trim region. */
  setRegion(r: Region | null): void {
    this.region = r;
    this.draw();
  }

  setMarkers(markers: Marker[]): void {
    this.markers = markers;
    this.draw();
  }

  getProfile(): { axis: ProfileAxis; index: number | null } {
    return { axis: this.profileAxis, index: this.profileIndex };
  }

  getBox(): Region | null {
    return this.box;
  }

  clearBox(): void {
    this.box = null;
    this.events.box?.(null);
    this.draw();
  }

  getScale(): number {
    return this.scale;
  }

  /** The part of the image on screen, in 0-based file coordinates; null when all of it is shown. */
  visibleRegion(): Region | null {
    const img = this.image;
    if (!img) return null;
    const x0 = Math.max(0, Math.floor(-this.offsetX / this.scale));
    const x1 = Math.min(img.width - 1, Math.ceil((this.canvas.width - this.offsetX) / this.scale) - 1);
    const r0 = Math.max(0, Math.floor(-this.offsetY / this.scale));
    const r1 = Math.min(img.height - 1, Math.ceil((this.canvas.height - this.offsetY) / this.scale) - 1);
    if (x0 > x1 || r0 > r1) return null;
    if (x0 === 0 && r0 === 0 && x1 === img.width - 1 && r1 === img.height - 1) return null;
    // Display rows run the other way when the file starts at the bottom
    const y0 = img.flipY ? img.height - 1 - r1 : r0;
    const y1 = img.flipY ? img.height - 1 - r0 : r1;
    return { x0, x1, y0, y1 };
  }

  fit(): void {
    if (!this.image) return this.draw();
    const { width, height } = this.canvas;
    const s = Math.min(width / this.image.width, height / this.image.height);
    // Prefer whole-number zoom levels so pixels stay square-looking
    this.scale = s >= 1 ? Math.floor(s) : s;
    this.offsetX = (width - this.image.width * this.scale) / 2;
    this.offsetY = (height - this.image.height * this.scale) / 2;
    this.fitted = true;
    this.events.zoom?.(this.scale);
    this.draw();
  }

  zoomTo(scale: number, cx = this.canvas.width / 2, cy = this.canvas.height / 2): void {
    const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
    this.offsetX = cx - ((cx - this.offsetX) * s) / this.scale;
    this.offsetY = cy - ((cy - this.offsetY) * s) / this.scale;
    this.scale = s;
    this.fitted = false;
    this.clampOffset();
    this.events.zoom?.(this.scale);
    this.draw();
  }

  zoomBy(factor: number): void {
    this.zoomTo(this.scale * factor);
  }

  private resize(): void {
    const rect = this.element.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    if (this.fitted) this.fit();
    else {
      this.clampOffset();
      this.draw();
    }
  }

  /** Keeps the image in view: a small image stays inside the canvas, a large one covers it up to a margin. */
  private clampOffset(): void {
    if (!this.image) return;
    const margin = PAN_MARGIN * (window.devicePixelRatio || 1);
    const clamp = (offset: number, size: number, view: number) =>
      size <= view
        ? Math.min(view - size, Math.max(0, offset))
        : Math.min(margin, Math.max(view - size - margin, offset));
    this.offsetX = clamp(this.offsetX, this.image.width * this.scale, this.canvas.width);
    this.offsetY = clamp(this.offsetY, this.image.height * this.scale, this.canvas.height);
  }

  private renderBitmap(): void {
    if (this.image) this.renderInto(this.bitmap, this.image);
  }

  private renderInto(bitmap: HTMLCanvasElement, img: ViewImage): void {
    bitmap.width = img.width;
    bitmap.height = img.height;
    const bctx = bitmap.getContext('2d')!;
    const out = bctx.createImageData(img.width, img.height);
    const px = out.data;
    if (img.rgba) {
      const row = img.width * 4;
      for (let y = 0; y < img.height; y++) {
        const src = (img.flipY ? img.height - 1 - y : y) * row;
        px.set(img.rgba.subarray(src, src + row), y * row);
      }
      bctx.putImageData(out, 0, 0);
      return;
    }
    for (let y = 0; y < img.height; y++) {
      const srcRow = (img.flipY ? img.height - 1 - y : y) * img.width;
      for (let x = 0; x < img.width; x++) {
        const v = img.data[srcRow + x];
        const o = (y * img.width + x) * 4;
        if (Number.isNaN(v)) {
          px[o] = 255; px[o + 1] = 0; px[o + 2] = 255;
        } else {
          px[o] = px[o + 1] = px[o + 2] = greyLevel(v, this.black, this.white, this.greyScale);
        }
        px[o + 3] = 255;
      }
    }
    bctx.putImageData(out, 0, 0);
  }

  // Display rows are flipped relative to file rows when flipY is set.
  private displayRow(fileRow: number): number {
    return this.image!.flipY ? this.image!.height - 1 - fileRow : fileRow;
  }

  /** Canvas point → 0-based file pixel (may be outside the image). */
  private toImage(cx: number, cy: number): { x: number; y: number } {
    const x = Math.floor((cx - this.offsetX) / this.scale);
    const dy = Math.floor((cy - this.offsetY) / this.scale);
    return { x, y: this.image ? this.displayRow(dy) : dy };
  }

  private inside(p: { x: number; y: number }): boolean {
    return !!this.image && p.x >= 0 && p.y >= 0 && p.x < this.image.width && p.y < this.image.height;
  }

  private canvasPoint(e: PointerEvent | WheelEvent): { cx: number; cy: number } {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = this.canvas.width / rect.width;
    return { cx: (e.clientX - rect.left) * dpr, cy: (e.clientY - rect.top) * dpr };
  }

  private clampToImage(p: { x: number; y: number }): { x: number; y: number } {
    const img = this.image!;
    return { x: Math.min(img.width - 1, Math.max(0, p.x)), y: Math.min(img.height - 1, Math.max(0, p.y)) };
  }

  private pointerDown(e: PointerEvent): void {
    if (!this.image || e.button !== 0) return;
    const { cx, cy } = this.canvasPoint(e);
    const p = this.toImage(cx, cy);
    this.canvas.setPointerCapture(e.pointerId);
    const mode = e.altKey ? 'pan' : this.tool === 'box' ? 'box' : this.tool === 'profile' || this.tool === 'pick' ? 'click' : 'pan';
    this.drag = { mode, startX: cx, startY: cy, ox: this.offsetX, oy: this.offsetY, ix: p.x, iy: p.y };
  }

  private pointerMove(e: PointerEvent): void {
    if (!this.image) return;
    const { cx, cy } = this.canvasPoint(e);
    const p = this.toImage(cx, cy);
    const second = this.showsSecond(p.x);
    const data = second ? this.compare!.image.data : this.image.data;
    this.events.hover?.(this.inside(p) ? { ...p, value: data[p.y * this.image.width + p.x], second: this.compare ? second : undefined } : null);

    const d = this.drag;
    if (!d) return;
    const moved = Math.hypot(cx - d.startX, cy - d.startY) > 4;
    if (d.mode === 'click' && moved) d.mode = 'pan';
    if (d.mode === 'pan') {
      this.offsetX = d.ox + cx - d.startX;
      this.offsetY = d.oy + cy - d.startY;
      this.fitted = false;
      this.clampOffset();
      this.draw();
    } else if (d.mode === 'box' && moved) {
      const a = this.clampToImage({ x: d.ix, y: d.iy });
      const b = this.clampToImage(p);
      this.box = { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) };
      this.draw();
    }
  }

  private pointerUp(e: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    if (!d || !this.image) return;
    const { cx, cy } = this.canvasPoint(e);
    const p = this.toImage(cx, cy);
    if (d.mode === 'click' && this.inside(p) && this.tool === 'pick') {
      this.events.pick?.(p);
    } else if (d.mode === 'click' && this.inside(p)) {
      this.profileIndex = this.profileAxis === 'row' ? p.y : p.x;
      this.events.profile?.(this.profileAxis, this.profileIndex);
      this.draw();
    } else if (d.mode === 'box') {
      this.events.box?.(this.box);
    }
  }

  private wheel(e: WheelEvent): void {
    if (!this.image) return;
    e.preventDefault();
    const { cx, cy } = this.canvasPoint(e);
    // The wheel always zooms around the pointer. A trackpad pinch arrives as ctrl+wheel with
    // small deltas, so it gets a larger factor; deltaMode 1 means the wheel scrolls by lines.
    const factor = e.deltaMode === 1 ? 0.1 : e.ctrlKey ? 0.01 : 0.002;
    this.zoomTo(this.scale * Math.exp(-e.deltaY * factor), cx, cy);
  }

  /** Whether the compared image is shown at this column. */
  private showsSecond(x: number): boolean {
    const c = this.compare;
    if (!c || !this.image) return false;
    return c.mode === 'blink' ? c.showSecond : x >= c.at * this.image.width;
  }

  private draw(): void {
    const ctx = this.ctx;
    const { width, height } = this.canvas;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = getComputedStyle(this.element).getPropertyValue('--viewer-bg').trim() || '#202020';
    ctx.fillRect(0, 0, width, height);
    const img = this.image;
    if (!img) return;

    ctx.imageSmoothingEnabled = false;
    const c = this.compare;
    const w = img.width * this.scale;
    const hgt = img.height * this.scale;
    ctx.drawImage(c?.mode === 'blink' && c.showSecond ? this.second : this.bitmap, this.offsetX, this.offsetY, w, hgt);
    if (c?.mode === 'split') {
      const x = this.offsetX + Math.round(c.at * img.width) * this.scale;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, this.offsetY, this.offsetX + w - x, hgt);
      ctx.clip();
      ctx.drawImage(this.second, this.offsetX, this.offsetY, w, hgt);
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = '#ffd400';
      ctx.lineWidth = 2 * (window.devicePixelRatio || 1);
      ctx.beginPath();
      ctx.moveTo(x, this.offsetY);
      ctx.lineTo(x, this.offsetY + hgt);
      ctx.stroke();
      ctx.restore();
    }

    const dpr = window.devicePixelRatio || 1;
    ctx.lineWidth = 1.5 * dpr;
    if (this.tool === 'profile' && this.profileIndex !== null) {
      ctx.strokeStyle = '#ffb000';
      ctx.beginPath();
      if (this.profileAxis === 'row') {
        const y = this.offsetY + (this.displayRow(this.profileIndex) + 0.5) * this.scale;
        ctx.moveTo(this.offsetX, y);
        ctx.lineTo(this.offsetX + img.width * this.scale, y);
      } else {
        const x = this.offsetX + (this.profileIndex + 0.5) * this.scale;
        ctx.moveTo(x, this.offsetY);
        ctx.lineTo(x, this.offsetY + img.height * this.scale);
      }
      ctx.stroke();
    }
    if (this.region) {
      const r = this.region;
      const top = Math.min(this.displayRow(r.y0), this.displayRow(r.y1));
      ctx.save();
      ctx.strokeStyle = '#4caf50';
      ctx.setLineDash([6 * dpr, 4 * dpr]);
      ctx.strokeRect(
        this.offsetX + r.x0 * this.scale,
        this.offsetY + top * this.scale,
        (r.x1 - r.x0 + 1) * this.scale,
        (r.y1 - r.y0 + 1) * this.scale,
      );
      ctx.restore();
    }
    if (this.markers.length) this.drawMarkers(dpr);
    if (this.box) {
      const b = this.box;
      const top = Math.min(this.displayRow(b.y0), this.displayRow(b.y1));
      ctx.strokeStyle = '#00d0ff';
      ctx.strokeRect(
        this.offsetX + b.x0 * this.scale,
        this.offsetY + top * this.scale,
        (b.x1 - b.x0 + 1) * this.scale,
        (b.y1 - b.y0 + 1) * this.scale,
      );
    }
  }

  private drawMarkers(dpr: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = `${12 * dpr}px system-ui, sans-serif`;
    ctx.textBaseline = 'bottom';
    for (const m of this.markers) {
      // Pixel centres are at +0.5; positions are fractional
      const x = this.offsetX + (m.x + 0.5) * this.scale;
      const row = this.image!.flipY ? this.image!.height - 1 - m.y : m.y;
      const y = this.offsetY + (row + 0.5) * this.scale;
      const r = Math.max(7 * dpr, 4 * this.scale);
      const ghost = m.style === 'ghost';
      ctx.strokeStyle = ghost ? 'rgba(0, 208, 255, 0.8)' : '#ffd400';
      ctx.setLineDash(ghost ? [3 * dpr, 3 * dpr] : []);
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.stroke();
      if (m.label) {
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fillText(m.label, x + r * 0.75, y - r * 0.75);
      }
    }
    ctx.restore();
  }
}
