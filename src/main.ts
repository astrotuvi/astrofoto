// App start and step navigation.

import './style.css';
import logoSvg from '../public/favicon.svg?raw';
import { h } from './dom';
import { getLang, type Key, type Lang, onLangChange, setLang, t } from './i18n';
import './masters';
import { isMentor, setMentor } from './mentor';
import { onPwaChange, reloadToUpdate, startPwa, updateWaiting } from './pwa';
import { state } from './state';
import { AboutPage } from './ui/about';
import { AlignStep } from './ui/align';
import { CalibrationStep } from './ui/calibrate';
import { ColorStep } from './ui/color';
import { FilesStep } from './ui/files';
import { ProjectBar } from './ui/projectbar';
import { ReportPage } from './ui/report';
import { renderResume, type Target } from './ui/resume';
import { ViewerPanel } from './ui/viewerpanel';

declare const __APP_VERSION__: string;

type Step = 'resume' | 'files' | 'calibration' | 'align' | 'color' | 'report' | 'about';
const STEPS: { id: Step; label: Key; ready: boolean }[] = [
  { id: 'files', label: 'step.files', ready: true },
  { id: 'calibration', label: 'step.calibration', ready: true },
  { id: 'align', label: 'step.align', ready: true },
  { id: 'color', label: 'step.color', ready: true },
  { id: 'report', label: 'step.report', ready: true },
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
const report = new ReportPage();
const about = new AboutPage();
const top = h('header', { class: 'topbar' });
const logo = h('span', { class: 'logo', 'aria-hidden': 'true' });
logo.innerHTML = logoSvg;
const updateBar = h('div', { class: 'update-bar', role: 'status', hidden: true });
const footer = h('footer', { class: 'footer' });
const stepArea = h('div', { class: 'step-area' });
const projectHeading = h('h3', {});
/** The new / open / save buttons, shown above every step. */
const projectBox = h('div', { class: 'project-box no-print' }, projectHeading, projectBar.element);
const layout = h('main', { class: 'layout' }, stepArea, viewer.element);
let current: Step = 'files';
let resumeWarning: string | undefined;
/** "Later" hides the update message until the page is opened again. */
let updateLater = false;

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
  const page = current === 'resume' ? renderResume(open, resumeWarning) : { files, calibration, align, color, report, about }[current].element;
  stepArea.replaceChildren(projectBox, page);
  // The report and About pages use the whole width; the report's figures are drawn from the images, not the viewer
  layout.classList.toggle('report-mode', current === 'report' || current === 'about');
}

function go(step: Step): void {
  current = step;
  calibration.setActive(step === 'calibration');
  align.setActive(step === 'align');
  color.setActive(step === 'color');
  report.setActive(step === 'report');
  about.setActive(step === 'about');
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
  projectHeading.textContent = t('project.label');
  document.title = (state.info.title ? state.info.title + ' – ' : '') + t('app.title');
  top.replaceChildren(
    h('div', { class: 'brand' }, logo, h('strong', {}, t('app.title')), h('span', { class: 'tagline' }, t('app.tagline')),
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
  );
  footer.replaceChildren(
    h('span', {}, t('app.footer', { version: __APP_VERSION__ })),
    h('button', { type: 'button', class: 'link', 'aria-current': current === 'about' ? 'page' : undefined, onclick: () => go('about') }, t('about.link')),
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
  if (!updateBar.hidden && kind !== 'overlay') renderUpdate();
});

/** The "new version" message (§6.3). The app never reloads by itself. */
function renderUpdate(): void {
  updateBar.hidden = !updateWaiting() || updateLater;
  if (updateBar.hidden) return;
  updateBar.replaceChildren(
    h('span', {}, t('update.available'), state.dirty && state.frames.length ? ' ' + t('update.saveFirst') : ''),
    h('button', { type: 'button', class: 'primary small', onclick: reloadToUpdate }, t('update.reload')),
    h('button', {
      type: 'button',
      class: 'small',
      onclick: () => {
        updateLater = true;
        renderUpdate();
      },
    }, t('update.later')));
}

document.documentElement.lang = getLang();
renderChrome();
show();
document.getElementById('app')!.replaceChildren(updateBar, top, layout, footer);
onPwaChange(renderUpdate);
startPwa();

/** Rebuilds everything shown, e.g. after a language change or switching mentor mode. */
function rerender(): void {
  renderChrome();
  projectBar.render();
  files.render();
  if (current === 'calibration') calibration.render();
  if (current === 'align') align.render();
  if (current === 'color') color.render();
  if (current === 'report') report.render();
  if (current === 'about') about.render();
  if (current === 'resume') show();
  viewer.render();
  renderUpdate();
}

onLangChange(rerender);
