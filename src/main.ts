// App start and step navigation.

import './style.css';
import { h } from './dom';
import { getLang, type Key, type Lang, onLangChange, setLang, t } from './i18n';
import './masters';
import { isMentor, setMentor } from './mentor';
import { state } from './state';
import { AlignStep } from './ui/align';
import { CalibrationStep } from './ui/calibrate';
import { ColorStep } from './ui/color';
import { FilesStep } from './ui/files';
import { ProjectBar } from './ui/projectbar';
import { renderResume, type Target } from './ui/resume';
import { ViewerPanel } from './ui/viewerpanel';

declare const __APP_VERSION__: string;

type Step = 'resume' | 'files' | 'calibration' | 'align' | 'color';
const STEPS: { id: Step; label: Key; ready: boolean }[] = [
  { id: 'files', label: 'step.files', ready: true },
  { id: 'calibration', label: 'step.calibration', ready: true },
  { id: 'align', label: 'step.align', ready: true },
  { id: 'color', label: 'step.color', ready: true },
];

const viewer = new ViewerPanel();
const projectBar = new ProjectBar(
  (warning) => {
    resumeWarning = warning;
    go('resume');
  },
  () => go('files'),
);
const files = new FilesStep((file) => void projectBar.openFile(file));
const calibration = new CalibrationStep(viewer, () => go('align'));
const align = new AlignStep(viewer, () => go('color'));
const color = new ColorStep(viewer);
const top = h('header', { class: 'topbar' });
const footer = h('footer', { class: 'footer' });
const stepArea = h('div', { class: 'step-area' });
let current: Step = 'files';
let resumeWarning: string | undefined;

function available(s: (typeof STEPS)[number]): boolean {
  // The mentor can open any step once there are frames
  if (isMentor() && s.ready && state.frames.length) return true;
  if (s.id === 'align') return state.isDone('calibrate') && state.calibrated.size > 0;
  if (s.id === 'color') return state.isDone('stack') && state.stacks.size > 0;
  return s.ready && (s.id === 'files' || state.frames.length > 0);
}

function lockedTip(s: (typeof STEPS)[number]): string {
  if (!s.ready) return t('step.later');
  if (!state.frames.length) return t('step.lockedFiles');
  return s.id === 'color' ? t('step.lockedStack') : t('step.lockedCalibration');
}

function show(): void {
  if (current === 'resume') stepArea.replaceChildren(renderResume(open, resumeWarning));
  else stepArea.replaceChildren({ files, calibration, align, color }[current].element);
}

function go(step: Step): void {
  current = step;
  calibration.setActive(step === 'calibration');
  align.setActive(step === 'align');
  color.setActive(step === 'color');
  show();
  renderChrome();
  window.scrollTo({ top: 0 });
}

function open(target: Target): void {
  if (target.step === 'calibration') calibration.open(target.sub);
  if (target.step === 'align') align.open(target.sub);
  if (target.step === 'color') color.open(target.sub);
  go(target.step);
}

function renderChrome(): void {
  document.title = (state.info.title ? state.info.title + ' – ' : '') + t('app.title');
  top.replaceChildren(
    h('div', { class: 'brand' }, h('strong', {}, t('app.title')), h('span', { class: 'tagline' }, t('app.tagline')),
      isMentor() ? h('span', { class: 'badge mentor' }, t('mentor.badge')) : null),
    h('nav', { class: 'steps', 'aria-label': t('step.nav') },
      h('ol', {},
        state.frames.length ? h('li', { class: current === 'resume' ? 'current' : '' },
          h('button', {
            type: 'button',
            class: 'step-link',
            'aria-current': current === 'resume' ? 'page' : undefined,
            title: t('resume.title'),
            onclick: () => {
              resumeWarning = undefined;
              go('resume');
            },
          }, t('step.overview'))) : null,
        STEPS.map((s, i) => {
          const ok = available(s);
          return h('li', { class: s.id === current ? 'current' : ok ? '' : 'locked' },
            h('button', {
              type: 'button',
              class: 'step-link',
              disabled: !ok,
              'aria-current': s.id === current ? 'step' : undefined,
              title: ok ? undefined : lockedTip(s),
              onclick: () => go(s.id),
            }, h('span', { class: 'num' }, String(i + 1)), ' ', t(s.label)));
        }))),
    h('div', { class: 'lang segmented', role: 'group', 'aria-label': t('lang.label') },
      (['et', 'en'] as Lang[]).map((l) => h('button', {
        type: 'button',
        lang: l,
        class: l === getLang() ? 'active' : '',
        'aria-pressed': String(l === getLang()),
        onclick: () => setLang(l),
      }, l.toUpperCase()))),
    projectBar.element,
  );
  footer.replaceChildren(
    h('span', {}, t('app.footer', { version: __APP_VERSION__ })),
    h('label', { class: 'inline mentor-switch', title: t('mentor.tip') },
      h('input', {
        type: 'checkbox',
        checked: isMentor(),
        onchange: (e: Event) => {
          const box = e.target as HTMLInputElement;
          if (box.checked && !confirm(t('mentor.confirm'))) {
            box.checked = false;
            return;
          }
          setMentor(box.checked);
        },
      }), ' ', t('mentor.label')));
}

state.on((kind) => {
  // The align step unlocks when calibration is done, the colour step when the stacks are made
  if (kind === 'steps' || kind === 'calibrated' || kind === 'stacks') renderChrome();
  if (kind === 'frames') {
    if (state.frames.length === 0 && current !== 'files') go('files');
    else renderChrome();
  }
  if (kind === 'info') document.title = (state.info.title ? state.info.title + ' – ' : '') + t('app.title');
  if (kind === 'mentor') rerender();
});

document.documentElement.lang = getLang();
renderChrome();
show();
document.getElementById('app')!.replaceChildren(
  top,
  h('main', { class: 'layout' }, stepArea, viewer.element),
  footer,
);

/** Rebuilds everything shown, e.g. after a language change or switching mentor mode. */
function rerender(): void {
  renderChrome();
  projectBar.render();
  files.render();
  if (current === 'calibration') calibration.render();
  if (current === 'align') align.render();
  if (current === 'color') color.render();
  if (current === 'resume') show();
  viewer.render();
}

onLangChange(rerender);
