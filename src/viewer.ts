// Image display on a canvas: zoom, pan, display range, overlays and pointer tools.

import type { Region } from './types';

export type Tool = 'pixel' | 'profile' | 'box';
export type ProfileAxis = 'row' | 'column';

export interface ViewImage {
  width: number;
  height: number;
  data: Float32Array;
  /** True when file row 0 is the bottom of the image (the FITS default). */
  flipY: boolean;
}

export interface ViewerEvents {
  /** Pointer over the image; 0-based file coordinates, or null when outside. */
  hover?: (p: { x: number; y: number; value: number } | null) => void;
  profile?: (axis: ProfileAxis, index: number) => void;
  box?: (region: Region | null) => void;
  zoom?: (scale: number) => void;
}

const MIN_SCALE = 1 / 16;
const MAX_SCALE = 32;

export class Viewer {
  readonly element: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private bitmap = document.createElement('canvas');
  private image: ViewImage | null = null;
  private black = 0;
  private white = 1;
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private fitted = true;
  private tool: Tool = 'pixel';
  private profileAxis: ProfileAxis = 'row';
  private profileIndex: number | null = null;
  private box: Region | null = null;
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
    if (!sameSize) {
      this.box = null;
      this.profileIndex = null;
      this.fitted = true;
    }
    this.renderBitmap();
    if (this.fitted) this.fit();
    else this.draw();
  }

  setRange(black: number, white: number): void {
    this.black = black;
    this.white = white;
    this.renderBitmap();
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
    else this.draw();
  }

  private renderBitmap(): void {
    const img = this.image;
    if (!img) return;
    this.bitmap.width = img.width;
    this.bitmap.height = img.height;
    const bctx = this.bitmap.getContext('2d')!;
    const out = bctx.createImageData(img.width, img.height);
    const px = out.data;
    const range = this.white - this.black || 1;
    for (let y = 0; y < img.height; y++) {
      const srcRow = (img.flipY ? img.height - 1 - y : y) * img.width;
      for (let x = 0; x < img.width; x++) {
        const v = img.data[srcRow + x];
        const o = (y * img.width + x) * 4;
        if (Number.isNaN(v)) {
          px[o] = 255; px[o + 1] = 0; px[o + 2] = 255;
        } else {
          const g = Math.round(Math.min(1, Math.max(0, (v - this.black) / range)) * 255);
          px[o] = px[o + 1] = px[o + 2] = g;
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
    const mode = e.altKey ? 'pan' : this.tool === 'box' ? 'box' : this.tool === 'profile' ? 'click' : 'pan';
    this.drag = { mode, startX: cx, startY: cy, ox: this.offsetX, oy: this.offsetY, ix: p.x, iy: p.y };
  }

  private pointerMove(e: PointerEvent): void {
    if (!this.image) return;
    const { cx, cy } = this.canvasPoint(e);
    const p = this.toImage(cx, cy);
    this.events.hover?.(this.inside(p) ? { ...p, value: this.image.data[p.y * this.image.width + p.x] } : null);

    const d = this.drag;
    if (!d) return;
    const moved = Math.hypot(cx - d.startX, cy - d.startY) > 4;
    if (d.mode === 'click' && moved) d.mode = 'pan';
    if (d.mode === 'pan') {
      this.offsetX = d.ox + cx - d.startX;
      this.offsetY = d.oy + cy - d.startY;
      this.fitted = false;
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
    if (d.mode === 'click' && this.inside(p)) {
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

  private draw(): void {
    const ctx = this.ctx;
    const { width, height } = this.canvas;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = getComputedStyle(this.element).getPropertyValue('--viewer-bg').trim() || '#202020';
    ctx.fillRect(0, 0, width, height);
    const img = this.image;
    if (!img) return;

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.bitmap, this.offsetX, this.offsetY, img.width * this.scale, img.height * this.scale);

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
}
