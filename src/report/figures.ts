// Draws report figures as PNG images that make sense without the app (§4.6): shown 12 cm wide,
// about 1200 px (250 dpi) with small images enlarged by whole numbers, two images side by side
// 16 cm wide as panels (a) and (b), a white background, the labels in the report language, a grey scale legend and a
// scale bar in arcseconds (in pixels when the pixel scale is not known; none on bias, dark
// and flat frames). Runs in the browser.

import { type ColorImage, render as renderColor } from '../color';
import { bottomUp, type FitsImage } from '../fits';
import { fmt, getLang, t } from '../i18n';
import { pixelScale } from '../instrument/profile';
import { quickLookOf, renderQuickLook } from '../quicklook';
import { stackImage } from '../stack';
import { state } from '../state';
import { displayRange, finite, greyLevel } from '../stats';
import { histogramData, rangeMarkers } from '../tools/histogram';
import { drawPlot } from '../tools/plot';
import { profileValues } from '../tools/profile';
import type { DisplayScale, Region } from '../types';
import { isCalibrationImage, levelText, reportImage, unitOf } from './build';
import { FIGURE_CM, type FigureContent, type FigureSnapshot, PAIR_CM, type PanelSnapshot } from './model';

/** Larger images are reduced to this, and smaller ones enlarged up to it: about 250 dpi at 12 cm. */
const MAX_WIDTH = 1200;
/** Room for the legend and scale bar under small images. */
const MIN_WIDTH = 800;
/** Tall images are made smaller so they fit on a page, at most 4:3. */
const MAX_IMAGE_HEIGHT = 1600;
/** Space between two images side by side, in cm; each panel is drawn MAX_WIDTH px wide. */
const GAP_CM = 0.4;
const PANEL_CM = (PAIR_CM - GAP_CM) / 2;
/** Sizes below are in figure pixels per 0.01 cm when printed (`u`), so text is the same size in every figure. */
const LEGEND_HEIGHT = 130;
const FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const font = (u: number, bold = false) => `${bold ? 'bold ' : ''}${Math.round(28 * u)}px ${FAMILY}`;
const PLOT_COLORS = { fg: '#000000', grid: '#cccccc', line: '#1f5fbf' };

export interface RenderedFigure {
  blob: Blob;
  width: number;
  height: number;
}

const sortedCache = new WeakMap<Float32Array, Float32Array>();

function sorted(data: Float32Array): Float32Array {
  let s = sortedCache.get(data);
  if (!s) {
    s = finite(data).sort();
    sortedCache.set(data, s);
  }
  return s;
}

function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  return [c, ctx];
}

/** A part of an image as RGBA, the right way up; grey from black to white, or the colour image's own bytes. */
function cropBitmap(width: number, height: number, flipY: boolean, r: Region, pixel: (i: number, out: Uint8ClampedArray, o: number) => void): HTMLCanvasElement {
  const w = r.x1 - r.x0 + 1;
  const h = r.y1 - r.y0 + 1;
  const [c, ctx] = canvas(w, h);
  const out = ctx.createImageData(w, h);
  for (let dy = 0; dy < h; dy++) {
    // Display row dy is file row y1 − dy when the file starts at the bottom
    const y = flipY ? r.y1 - dy : r.y0 + dy;
    if (y < 0 || y >= height) continue;
    for (let dx = 0; dx < w; dx++) {
      const x = r.x0 + dx;
      if (x < 0 || x >= width) continue;
      pixel(y * width + x, out.data, (dy * w + dx) * 4);
    }
  }
  ctx.putImageData(out, 0, 0);
  return c;
}

function whole(img: { width: number; height: number }): Region {
  return { x0: 0, x1: img.width - 1, y0: 0, y1: img.height - 1 };
}

function validView(view: Region | null, img: { width: number; height: number }): Region {
  if (!view || view.x1 >= img.width || view.y1 >= img.height || view.x0 < 0 || view.y0 < 0) return whole(img);
  return view;
}

/** A round length for the scale bar near `target` (in the bar's unit). */
function niceLength(target: number, arcsec: boolean): number {
  const steps = arcsec ? [0.5, 1, 2, 5, 10, 15, 20, 30, 60, 120, 180, 300, 600, 900, 1200, 1800, 3600] : [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000];
  return steps.reduce((best, s) => (Math.abs(Math.log(s / target)) < Math.abs(Math.log(best / target)) ? s : best), steps[0]);
}

function scaleBarLabel(v: number, arcsec: boolean): string {
  if (!arcsec) return `${fmt(v, 0)} px`;
  return v >= 60 ? `${fmt(v / 60, 1)}′` : `${fmt(v, 1)}″`;
}

interface ImageLayout {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** Where the image is drawn, and figure pixels per image pixel. */
  x: number;
  y: number;
  w: number;
  h: number;
  k: number;
  /** Figure pixels per 0.01 cm, so text and lines have the same size in every figure. */
  u: number;
  /** The span of the legend and scale bar: the image, or more of the figure under small images. */
  lx0: number;
  lx1: number;
}

/**
 * Draws a cropped bitmap with room for the legend below. Large images are reduced; small ones are
 * enlarged by a whole number, so each pixel becomes an even, sharp square. A panel of two images
 * side by side is always MAX_WIDTH px wide.
 */
function layoutImage(bitmap: HTMLCanvasElement, panel = false): ImageLayout {
  const fit = Math.min(MAX_WIDTH / bitmap.width, MAX_IMAGE_HEIGHT / bitmap.height);
  const k = fit < 1 ? fit : Math.floor(fit);
  const w = Math.round(bitmap.width * k);
  const h = Math.round(bitmap.height * k);
  const width = panel ? MAX_WIDTH : Math.max(w, MIN_WIDTH, Math.ceil((h * 3) / 4));
  const u = width / ((panel ? PANEL_CM : FIGURE_CM) * 100);
  const [c, ctx] = canvas(width, h + Math.round(LEGEND_HEIGHT * u));
  const x = Math.round((width - w) / 2);
  // Enlarged pixels stay sharp, so single pixels can be seen; reduced images are smoothed
  ctx.imageSmoothingEnabled = k < 1;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, x, 0, w, h);
  const lw = Math.min(width, Math.max(w, 0.75 * width));
  const lx0 = Math.round((width - lw) / 2);
  return { canvas: c, ctx, x, y: 0, w, h, k, u, lx0, lx1: lx0 + lw };
}

function drawScaleBar(l: ImageLayout, scale: number | undefined): void {
  const { ctx, u } = l;
  const arcsec = !!scale;
  // About a fifth of the image width
  const target = (l.w / 5 / l.k) * (scale ?? 1);
  const len = niceLength(target, arcsec);
  const px = (len / (scale ?? 1)) * l.k;
  const right = l.lx1;
  const x0 = right - px;
  const y = l.h + 70 * u;
  ctx.save();
  ctx.strokeStyle = '#000';
  ctx.fillStyle = '#000';
  ctx.lineWidth = 6 * u;
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(right, y);
  ctx.moveTo(x0, y - 14 * u);
  ctx.lineTo(x0, y + 14 * u);
  ctx.moveTo(right, y - 14 * u);
  ctx.lineTo(right, y + 14 * u);
  ctx.stroke();
  ctx.font = font(u);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(scaleBarLabel(len, arcsec), (x0 + right) / 2, y - 18 * u);
  ctx.restore();
}

/** Grey bar from black to white in the scale of the image, with the values at its ends. */
function drawGreyLegend(l: ImageLayout, black: number, white: number, unit: string, scale: DisplayScale): void {
  const { ctx, u } = l;
  const w = Math.min(500 * u, (l.lx1 - l.lx0) / 2);
  const x = l.lx0;
  const y = l.h + 30 * u;
  const bar = 28 * u;
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  for (let i = 0; i <= 32; i++) {
    const c = greyLevel(i / 32, 0, 1, scale);
    g.addColorStop(i / 32, `rgb(${c},${c},${c})`);
  }
  ctx.save();
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, bar);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2 * u;
  ctx.strokeRect(x, y, w, bar);
  ctx.fillStyle = '#000';
  ctx.font = font(u);
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  const [b, wt] = levelText(black, white);
  ctx.fillText(b, x, y + 36 * u);
  ctx.textAlign = 'right';
  ctx.fillText(`${wt}${unit}`, x + w, y + 36 * u);
  ctx.restore();
}

/** The letter of a panel, in a white square at the top left corner of the image. */
function drawPanelLetter(l: ImageLayout, letter: string): void {
  const { ctx, u } = l;
  const s = 44 * u;
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(l.x, l.y, s, s);
  ctx.fillStyle = '#000000';
  ctx.font = font(u, true);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, l.x + s / 2, l.y + s / 2);
  ctx.restore();
}

/** A rectangle or a line in image coordinates, drawn on the figure. */
function drawMarks(l: ImageLayout, img: FitsImage, view: Region, s: Extract<FigureSnapshot, { type: 'image' }>): void {
  const { ctx } = l;
  const flip = bottomUp(img);
  // Figure position of the left/top edge of image column x and file row y
  const fx = (x: number) => l.x + (x - view.x0) * l.k;
  const fy = (y: number) => l.y + (flip ? view.y1 - y : y - view.y0) * l.k;
  ctx.save();
  ctx.beginPath();
  ctx.rect(l.x, l.y, l.w, l.h);
  ctx.clip();
  ctx.lineWidth = 4 * l.u;
  if (s.box) {
    const b = s.box;
    ctx.strokeStyle = '#00d0ff';
    ctx.strokeRect(fx(b.x0), fy(flip ? b.y1 : b.y0), (b.x1 - b.x0 + 1) * l.k, (b.y1 - b.y0 + 1) * l.k);
  }
  if (s.line) {
    ctx.strokeStyle = '#ffb000';
    ctx.beginPath();
    if (s.line.axis === 'row') {
      const y = fy(s.line.index) + l.k / 2;
      ctx.moveTo(l.x, y);
      ctx.lineTo(l.x + l.w, y);
    } else {
      const x = fx(s.line.index) + l.k / 2;
      ctx.moveTo(x, l.y);
      ctx.lineTo(x, l.y + l.h);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** For a panel of two images side by side: its letter. */
type Panel = string | undefined;

function imageFigure(s: Extract<FigureSnapshot, { type: 'image' }>, panel?: Panel): HTMLCanvasElement | null {
  const img = reportImage(s.imageId);
  if (!img) return null;
  const { black, white } = displayRange(sorted(img.data), s.range.mode, s.range.black, s.range.white);
  const scale = s.range.scale ?? 'linear';
  const view = validView(s.view, img);
  const data = img.data;
  const bitmap = cropBitmap(img.width, img.height, bottomUp(img), view, (i, out, o) => {
    const v = data[i];
    if (Number.isNaN(v)) {
      out[o] = 255; out[o + 1] = 0; out[o + 2] = 255;
    } else {
      out[o] = out[o + 1] = out[o + 2] = greyLevel(v, black, white, scale);
    }
    out[o + 3] = 255;
  });
  const l = layoutImage(bitmap, !!panel);
  drawMarks(l, img, view, s);
  drawGreyLegend(l, black, white, unitOf(s.imageId), scale);
  // Calibration frames show the camera, so a length on the sky means nothing there
  if (!isCalibrationImage(s.imageId)) drawScaleBar(l, state.profile ? pixelScale(img.header, state.profile) : undefined);
  if (panel) drawPanelLetter(l, panel);
  return l.canvas;
}

function colorFigure(s: Extract<FigureSnapshot, { type: 'color' }>, panel?: Panel): HTMLCanvasElement | null {
  const first = (['R', 'G', 'B'] as const).map((k) => stackImage(s.composition.channels[k].filter)).find(Boolean);
  return colorBitmap(renderColor(s.composition, stackImage), first, s.view, panel);
}

function quickLookFigure(s: Extract<FigureSnapshot, { type: 'quickLook' }>, panel?: Panel): HTMLCanvasElement | null {
  const q = quickLookOf(s.frames);
  return q && colorBitmap(renderQuickLook(q), q.frames.G.image, s.view, panel);
}

function colorBitmap(color: ColorImage | null, first: FitsImage | undefined, v: Region | null, panel?: Panel): HTMLCanvasElement | null {
  if (!color || !first) return null;
  const view = validView(v, color);
  const rgba = color.rgba;
  const bitmap = cropBitmap(color.width, color.height, bottomUp(first), view, (i, out, o) => {
    out[o] = rgba[i * 4];
    out[o + 1] = rgba[i * 4 + 1];
    out[o + 2] = rgba[i * 4 + 2];
    out[o + 3] = 255;
  });
  const l = layoutImage(bitmap, !!panel);
  drawScaleBar(l, state.profile ? pixelScale(first.header, state.profile) : undefined);
  if (panel) drawPanelLetter(l, panel);
  return l.canvas;
}

function panelFigure(s: PanelSnapshot, letter: string): HTMLCanvasElement | null {
  switch (s.type) {
    case 'image': return imageFigure(s, letter);
    case 'color': return colorFigure(s, letter);
    case 'quickLook': return quickLookFigure(s, letter);
  }
}

/** Two images side by side, aligned at the top. */
function pairFigure(panels: PanelSnapshot[]): HTMLCanvasElement | null {
  const [a, b] = panels.map((p, i) => panelFigure(p, 'ab'[i]));
  if (!a || !b) return null;
  const gap = Math.round((GAP_CM * MAX_WIDTH) / PANEL_CM);
  const [c, ctx] = canvas(a.width + gap + b.width, Math.max(a.height, b.height));
  ctx.drawImage(a, 0, 0);
  ctx.drawImage(b, a.width + gap, 0);
  return c;
}

/** Plots are drawn at 600 × 300 CSS pixels (50 per cm), 1200 px wide. */
const PLOT = { width: 600, height: 300, pixelRatio: MAX_WIDTH / 600, colors: PLOT_COLORS, background: '#ffffff' };

function profileFigure(s: Extract<FigureSnapshot, { type: 'profile' }>): HTMLCanvasElement | null {
  const img = reportImage(s.imageId);
  if (!img || s.index >= (s.axis === 'row' ? img.height : img.width)) return null;
  const ys = profileValues(img.data, img.width, img.height, s.axis, s.index);
  const c = document.createElement('canvas');
  drawPlot(c, Array.from(ys, (_, i) => i + 1), ys, {
    ...PLOT,
    xLabel: s.axis === 'row' ? t('axis.x') : t('axis.y'),
    yLabel: t('axis.adu'),
    style: 'line',
    integerX: true,
  });
  return c;
}

function histogramFigure(s: Extract<FigureSnapshot, { type: 'histogram' }>): HTMLCanvasElement | null {
  const img = reportImage(s.imageId);
  if (!img) return null;
  const box = s.box && s.box.x1 < img.width && s.box.y1 < img.height ? s.box : null;
  const { xs, counts } = histogramData(img.data, img.width, box, s.range);
  const c = document.createElement('canvas');
  drawPlot(c, xs, counts, {
    ...PLOT,
    xLabel: t('axis.adu'),
    yLabel: t('axis.count'),
    style: 'steps',
    logY: s.log,
    markers: rangeMarkers(s.black, s.white),
  });
  return c;
}

function draw(s: FigureContent): HTMLCanvasElement | null {
  switch (s.type) {
    case 'pair': return pairFigure(s.panels);
    case 'image': return imageFigure(s);
    case 'color': return colorFigure(s);
    case 'quickLook': return quickLookFigure(s);
    case 'profile': return profileFigure(s);
    case 'histogram': return histogramFigure(s);
  }
}

function toBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG'))), 'image/png'));
}

const cache = new Map<string, Promise<RenderedFigure | null>>();

/** The figure as PNG; null when its image does not exist now (e.g. a step was undone). */
export function renderFigure(s: FigureContent): Promise<RenderedFigure | null> {
  const key = `${getLang()}:${JSON.stringify(s)}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const c = draw(s);
      return c ? { blob: await toBlob(c), width: c.width, height: c.height } : null;
    })();
    cache.set(key, p);
  }
  return p;
}

// Figures follow the processing: drop them when the images change
state.on((kind) => {
  if (['frames', 'profile', 'settings', 'masters', 'calibrated', 'aligned', 'stacks', 'versions'].includes(kind)) cache.clear();
});
