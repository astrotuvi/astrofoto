// The bar under the image for making the image area taller or shorter. The width stays as the
// layout gives it. The height is saved in the browser, not in the project, as it belongs to the screen.

import { h } from '../dom';
import { t } from '../i18n';

const STORAGE_KEY = 'astrofoto.viewerHeight';
const MIN_HEIGHT = 280;
const KEY_STEP = 40;
/** Room kept below the bar: the panel's padding and the margin of the sticky panel. */
const BOTTOM_ROOM = 40;

function load(): number | null {
  try {
    const v = Number(localStorage.getItem(STORAGE_KEY));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}

function store(px: number | null): void {
  try {
    if (px === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, String(Math.round(px)));
  } catch {
    // not saved; the height lasts until the page is closed
  }
}

export class HeightGrip {
  readonly element = h('div', { class: 'height-grip no-print', role: 'separator', 'aria-orientation': 'horizontal', tabindex: '0' });
  /** The height the student chose; null = the default from the style sheet. */
  private height = load();

  /** `target` is the image area, `panel` the panel it is in (for the space above it). */
  constructor(private target: HTMLElement, private panel: HTMLElement) {
    this.element.addEventListener('pointerdown', (e) => this.drag(e));
    this.element.addEventListener('dblclick', () => this.set(null));
    this.element.addEventListener('keydown', (e) => {
      const by = e.key === 'ArrowDown' ? KEY_STEP : e.key === 'ArrowUp' ? -KEY_STEP : 0;
      if (!by) return;
      e.preventDefault();
      this.set(this.current() + by);
    });
    window.addEventListener('resize', () => this.apply());
    this.apply();
  }

  /** Updates the texts, e.g. after a language change. */
  render(): void {
    this.element.title = t('viewer.resizeTip');
    this.element.setAttribute('aria-label', t('viewer.resize'));
    this.apply();
  }

  private current(): number {
    return this.target.getBoundingClientRect().height;
  }

  /** As tall as fits in the window under the viewer's heading. */
  private max(): number {
    const above = this.target.getBoundingClientRect().top - this.panel.getBoundingClientRect().top;
    return Math.max(MIN_HEIGHT, window.innerHeight - above - this.element.offsetHeight - BOTTOM_ROOM);
  }

  private set(px: number | null): void {
    this.height = px === null ? null : Math.round(Math.min(this.max(), Math.max(MIN_HEIGHT, px)));
    store(this.height);
    this.apply();
  }

  private apply(): void {
    const px = this.height === null ? null : Math.min(this.height, this.max());
    this.target.style.height = px === null ? '' : `${px}px`;
    this.element.setAttribute('aria-valuemin', String(MIN_HEIGHT));
    this.element.setAttribute('aria-valuemax', String(Math.round(this.max())));
    this.element.setAttribute('aria-valuenow', String(Math.round(px ?? this.current())));
  }

  private drag(e: PointerEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    const startY = e.clientY;
    const startH = this.current();
    this.element.setPointerCapture(e.pointerId);
    this.element.classList.add('active');
    const move = (ev: PointerEvent) => {
      this.height = Math.round(Math.min(this.max(), Math.max(MIN_HEIGHT, startH + ev.clientY - startY)));
      this.apply();
    };
    const end = () => {
      this.element.removeEventListener('pointermove', move);
      this.element.removeEventListener('pointerup', end);
      this.element.removeEventListener('pointercancel', end);
      this.element.classList.remove('active');
      store(this.height);
    };
    this.element.addEventListener('pointermove', move);
    this.element.addEventListener('pointerup', end);
    this.element.addEventListener('pointercancel', end);
  }
}
