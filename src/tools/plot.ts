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
  /** Integer x ticks (pixel positions). */
  integerX?: boolean;
  /** CSS pixels; the canvas must be created with the same height. */
  height?: number;
}

const DEFAULT_HEIGHT = 220;

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
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || 400;
  const plotHeight = opt.height ?? DEFAULT_HEIGHT;
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(plotHeight * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const style = getComputedStyle(canvas);
  const fg = style.getPropertyValue('--text').trim() || '#222';
  const muted = style.getPropertyValue('--border').trim() || '#ccc';
  const line = style.getPropertyValue('--accent').trim() || '#1565c0';
  ctx.clearRect(0, 0, cssWidth, plotHeight);
  ctx.font = '11px system-ui, sans-serif';

  const n = xs.length;
  if (n === 0) return;
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (let i = 0; i < n; i++) {
    const y = ys[i];
    if (xs[i] < xMin) xMin = xs[i];
    if (xs[i] > xMax) xMax = xs[i];
    if (!Number.isFinite(y) || (opt.logY && y <= 0)) continue;
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }
  // In step plots each x is a bin's left edge, so the last bin ends one step further
  if (opt.style === 'steps' && n > 1) xMax += xs[n - 1] - xs[n - 2];
  if (!Number.isFinite(yMin)) { yMin = 0; yMax = 1; }
  if (opt.style === 'steps' && !opt.logY) yMin = 0;
  if (yMax === yMin) { yMax += 1; yMin -= opt.logY ? 0 : 1; }
  const ty = (y: number) => (opt.logY ? Math.log10(Math.max(y, 0.5)) : y);
  const lo = opt.logY ? Math.log10(Math.max(yMin, 1)) - 0.1 : yMin - (yMax - yMin) * 0.05;
  const hi = opt.logY ? Math.log10(yMax) + 0.1 : yMax + (yMax - yMin) * 0.05;

  const left = 64, right = 12, top = 10, bottom = 40;
  const w = cssWidth - left - right;
  const h = plotHeight - top - bottom;
  const px = (x: number) => left + ((x - xMin) / (xMax - xMin || 1)) * w;
  const py = (y: number) => top + h - ((ty(y) - lo) / (hi - lo || 1)) * h;

  // Axes and ticks
  ctx.strokeStyle = muted;
  ctx.fillStyle = fg;
  ctx.lineWidth = 1;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  let xt = ticks(xMin, xMax, Math.max(2, Math.floor(w / 70)));
  if (opt.integerX) xt = xt.filter((v) => Number.isInteger(v));
  const xd = tickDigits(xt);
  for (const v of xt) {
    const x = px(v);
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + h); ctx.stroke();
    ctx.fillText(fmt(v, xd), x, top + h + 4);
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
      const x1 = i + 1 < n ? px(xs[i + 1]) : px(xs[i]) + (px(xs[i]) - px(xs[Math.max(0, i - 1)]));
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
