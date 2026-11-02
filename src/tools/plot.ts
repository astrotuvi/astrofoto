// Small line/step plot with labelled axes, drawn on a canvas.

import { fmt } from '../i18n';

export interface PlotOptions {
  xLabel: string;
  yLabel: string;
  /** 'line' joins points; 'steps' draws a histogram outline. */
  style: 'line' | 'steps';
  logY?: boolean;
  /** Vertical marker lines at these x values. */
  markers?: { x: number; color: string }[];
  /** A non-linear x axis; xs stay in data units. */
  xScale?: XScale;
  /** Integer x ticks (pixel positions). */
  integerX?: boolean;
  /** CSS pixels; the canvas must be created with the same height. */
  height?: number;
  /** For figures drawn off screen: width in CSS pixels, pixel ratio, colours and a background. */
  width?: number;
  pixelRatio?: number;
  colors?: { fg: string; grid: string; line: string };
  background?: string;
}

const DEFAULT_HEIGHT = 220;

export interface XScale {
  to(x: number): number;
  from(u: number): number;
}

/**
 * asinh((x − center) / width): linear within about one width of the centre and logarithmic
 * further out on both sides, e.g. a histogram around the sky background.
 */
export function asinhScale(center: number, width: number): XScale {
  return { to: (x) => Math.asinh((x - center) / width), from: (u) => center + width * Math.sinh(u) };
}

/** Round tick values for a non-linear axis: evenly spaced in scale units, each rounded to a nice number. */
function scaleTicks(s: XScale, lo: number, hi: number, target: number): number[] {
  const center = s.from(0);
  // The centre (e.g. the background) is always labelled when it is on the axis
  const out: number[] = lo <= 0 && hi >= 0 ? [Math.round(center)] : [];
  for (let i = 0; i <= target; i++) {
    const x = s.from(lo + ((hi - lo) * i) / target);
    // Round the distance from the centre to 1 or 2 significant digits, keeping the centre itself round
    const d = x - center;
    const step = d === 0 ? 1 : 10 ** Math.floor(Math.log10(Math.abs(d)));
    const v = Math.round(x / step) * step;
    if (d !== 0 && s.to(v) >= lo && s.to(v) <= hi && !out.includes(v)) out.push(Number(v.toPrecision(12)));
  }
  return out.sort((a, b) => a - b);
}

export function createPlotCanvas(height = DEFAULT_HEIGHT): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.className = 'plot';
  c.style.height = `${height}px`;
  return c;
}

/** Nice tick values between lo and hi. */
export function ticks(lo: number, hi: number, target = 5): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

function tickDigits(values: number[]): number {
  if (values.length < 2) return 2;
  const step = Math.abs(values[1] - values[0]);
  return Math.max(0, Math.min(6, -Math.floor(Math.log10(step))));
}

export function drawPlot(canvas: HTMLCanvasElement, xs: ArrayLike<number>, ys: ArrayLike<number>, opt: PlotOptions): void {
  const dpr = opt.pixelRatio ?? (window.devicePixelRatio || 1);
  const cssWidth = opt.width ?? (canvas.clientWidth || 400);
  const plotHeight = opt.height ?? DEFAULT_HEIGHT;
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(plotHeight * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const style = opt.colors ? null : getComputedStyle(canvas);
  const fg = opt.colors?.fg ?? (style!.getPropertyValue('--text').trim() || '#222');
  const muted = opt.colors?.grid ?? (style!.getPropertyValue('--border').trim() || '#ccc');
  const line = opt.colors?.line ?? (style!.getPropertyValue('--accent').trim() || '#1565c0');
  ctx.clearRect(0, 0, cssWidth, plotHeight);
  if (opt.background) {
    ctx.fillStyle = opt.background;
    ctx.fillRect(0, 0, cssWidth, plotHeight);
  }
  ctx.font = '11px system-ui, sans-serif';

  const n = xs.length;
  if (n === 0) return;
  const tx = opt.xScale ? opt.xScale.to : (x: number) => x;
  const us = Array.from(xs, tx);
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (let i = 0; i < n; i++) {
    const y = ys[i];
    if (us[i] < xMin) xMin = us[i];
    if (us[i] > xMax) xMax = us[i];
    if (!Number.isFinite(y) || (opt.logY && y <= 0)) continue;
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }
  // In step plots each x is a bin's left edge, so the last bin ends one step further
  if (opt.style === 'steps' && n > 1) xMax += us[n - 1] - us[n - 2];
  if (!Number.isFinite(yMin)) { yMin = 0; yMax = 1; }
  if (opt.style === 'steps' && !opt.logY) yMin = 0;
  if (yMax === yMin) { yMax += 1; yMin -= opt.logY ? 0 : 1; }
  const ty = (y: number) => (opt.logY ? Math.log10(Math.max(y, 0.5)) : y);
  const lo = opt.logY ? Math.log10(Math.max(yMin, 1)) - 0.1 : yMin - (yMax - yMin) * 0.05;
  const hi = opt.logY ? Math.log10(yMax) + 0.1 : yMax + (yMax - yMin) * 0.05;

  const left = 64, right = 12, top = 10, bottom = 40;
  const w = cssWidth - left - right;
  const h = plotHeight - top - bottom;
  const pu = (u: number) => left + ((u - xMin) / (xMax - xMin || 1)) * w;
  const px = (x: number) => pu(tx(x));
  const py = (y: number) => top + h - ((ty(y) - lo) / (hi - lo || 1)) * h;

  // Axes and ticks
  ctx.strokeStyle = muted;
  ctx.fillStyle = fg;
  ctx.lineWidth = 1;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const xCount = Math.max(2, Math.floor(w / 70));
  let xt = opt.xScale ? scaleTicks(opt.xScale, xMin, xMax, xCount) : ticks(xMin, xMax, xCount);
  if (opt.integerX) xt = xt.filter((v) => Number.isInteger(v));
  const xd = opt.xScale ? 0 : tickDigits(xt);
  let lastLabel = -Infinity;
  for (const v of xt) {
    const x = px(v);
    // Rounding can bring ticks of a non-linear axis close together
    const label = fmt(v, xd);
    if (x - lastLabel < ctx.measureText(label).width + 8) continue;
    lastLabel = x;
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + h); ctx.stroke();
    ctx.fillText(label, x, top + h + 4);
  }
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const yt = opt.logY
    ? ticks(Math.ceil(lo), Math.floor(hi), 5).filter(Number.isInteger).map((e) => 10 ** e)
    : ticks(lo, hi, 5);
  const yd = opt.logY ? 0 : tickDigits(yt);
  for (const v of yt) {
    const y = py(v);
    if (y < top - 1 || y > top + h + 1) continue;
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(left + w, y); ctx.stroke();
    ctx.fillText(fmt(v, yd), left - 4, y);
  }
  ctx.strokeStyle = fg;
  ctx.strokeRect(left, top, w, h);

  // Axis labels
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(opt.xLabel, left + w / 2, plotHeight - 2);
  ctx.save();
  ctx.translate(12, top + h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textBaseline = 'middle';
  ctx.fillText(opt.yLabel, 0, 0);
  ctx.restore();

  // Data
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, w, h);
  ctx.clip();
  ctx.strokeStyle = line;
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < n; i++) {
    const y = ys[i];
    if (!Number.isFinite(y)) { started = false; continue; }
    const yy = opt.logY && y <= 0 ? top + h : py(y);
    if (opt.style === 'steps') {
      const x0 = px(xs[i]);
      const x1 = i + 1 < n ? px(xs[i + 1]) : pu(us[i]) + (pu(us[i]) - pu(us[Math.max(0, i - 1)]));
      if (!started) { ctx.moveTo(x0, yy); started = true; } else ctx.lineTo(x0, yy);
      ctx.lineTo(x1, yy);
    } else if (!started) {
      ctx.moveTo(px(xs[i]), yy);
      started = true;
    } else {
      ctx.lineTo(px(xs[i]), yy);
    }
  }
  ctx.stroke();
  for (const m of opt.markers ?? []) {
    ctx.strokeStyle = m.color;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(px(m.x), top);
    ctx.lineTo(px(m.x), top + h);
    ctx.stroke();
  }
  ctx.restore();
}
