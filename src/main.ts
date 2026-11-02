// App start and step navigation.

import './style.css';
import { h } from './dom';
import { getLang, type Key, type Lang, onLangChange, setLang, t } from './i18n';
import './masters';
import { state } from './state';
import { AlignStep } from './ui/align';
import { CalibrationStep } from './ui/calibrate';
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
  { id: 'color', label: 'step.color', ready: false },
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
const align = new AlignStep(viewer);
const top = h('header', { class: 'topbar' });
const footer = h('footer', { class: 'footer' });
const stepArea = h('div', { class: 'step-area' });
let current: Step = 'files';
let resumeWarning: string | undefined;

function available(s: (typeof STEPS)[number]): boolean {
  if (s.id === 'align') return state.isDone('calibrate') && state.calibrated.size > 0;
  return s.ready && (s.id === 'files' || state.frames.length > 0);
}

function lockedTip(s: (typeof STEPS)[number]): string {
  if (!s.ready) return t('step.later');
  return s.id === 'align' && state.frames.length ? t('step.lockedCalibration') : t('step.lockedFiles');
}

function show(): void {
  if (current === 'resume') stepArea.replaceChildren(renderResume(open, resumeWarning));
  else stepArea.replaceChildren(current === 'files' ? files.element : current === 'align' ? align.element : calibration.element);
}

function go(step: Step): void {
  current = step;
  calibration.setActive(step === 'calibration');
  align.setActive(step === 'align');
  show();
  renderChrome();
  window.scrollTo({ top: 0 });
}

function open(target: Target): void {
  if (target.step === 'calibration') calibration.open(target.sub);
  if (target.step === 'align') align.open(target.sub);
  go(target.step);
}

function renderChrome(): void {
  document.title = (state.info.title ? state.info.title + ' – ' : '') + t('app.title');
  top.replaceChildren(
    h('div', { class: 'brand' }, h('strong', {}, t('app.title')), h('span', { class: 'tagline' }, t('app.tagline'))),
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
  footer.replaceChildren(t('app.footer', { version: __APP_VERSION__ }));
}

state.on((kind) => {
  // The align step unlocks when calibration is done
  if (kind === 'steps' || kind === 'calibrated') renderChrome();
  if (kind === 'frames') {
    if (state.frames.length === 0 && current !== 'files') go('files');
    else renderChrome();
  }
  if (kind === 'info') document.title = (state.info.title ? state.info.title + ' – ' : '') + t('app.title');
});

document.documentElement.lang = getLang();
renderChrome();
show();
document.getElementById('app')!.replaceChildren(
  top,
  h('main', { class: 'layout' }, stepArea, viewer.element),
  footer,
);

onLangChange(() => {
  renderChrome();
  projectBar.render();
  files.render();
  if (current === 'calibration') calibration.render();
  if (current === 'align') align.render();
  if (current === 'resume') show();
  viewer.render();
});
