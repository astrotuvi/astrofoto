// App start and step navigation.

import './style.css';
import { h } from './dom';
import { getLang, type Key, type Lang, onLangChange, setLang, t } from './i18n';
import { refreshMasters } from './masters';
import { state } from './state';
import { CalibrationStep } from './ui/calibrate';
import { FilesStep } from './ui/files';
import { ViewerPanel } from './ui/viewerpanel';

declare const __APP_VERSION__: string;

type Step = 'files' | 'calibration' | 'align' | 'color';
const STEPS: { id: Step; label: Key; ready: boolean }[] = [
  { id: 'files', label: 'step.files', ready: true },
  { id: 'calibration', label: 'step.calibration', ready: true },
  { id: 'align', label: 'step.align', ready: false },
  { id: 'color', label: 'step.color', ready: false },
];

const viewer = new ViewerPanel();
const files = new FilesStep();
const calibration = new CalibrationStep(viewer);
const top = h('header', { class: 'topbar' });
const footer = h('footer', { class: 'footer' });
const stepArea = h('div', { class: 'step-area' });
let current: Step = 'files';

function available(s: (typeof STEPS)[number]): boolean {
  return s.ready && (s.id === 'files' || state.frames.length > 0);
}

function go(step: Step): void {
  current = step;
  stepArea.replaceChildren(step === 'files' ? files.element : calibration.element);
  calibration.setActive(step === 'calibration');
  renderChrome();
  window.scrollTo({ top: 0 });
}

function renderChrome(): void {
  document.title = t('app.title');
  top.replaceChildren(
    h('div', { class: 'brand' }, h('strong', {}, t('app.title')), h('span', { class: 'tagline' }, t('app.tagline'))),
    h('nav', { class: 'steps', 'aria-label': t('step.nav') },
      h('ol', {}, STEPS.map((s, i) => {
        const ok = available(s);
        return h('li', { class: s.id === current ? 'current' : ok ? '' : 'locked' },
          h('button', {
            type: 'button',
            class: 'step-link',
            disabled: !ok,
            'aria-current': s.id === current ? 'step' : undefined,
            title: ok ? undefined : s.ready ? t('step.lockedFiles') : t('step.later'),
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
  footer.replaceChildren(t('app.footer', { version: __APP_VERSION__ }));
}

// Masters depend on the frames: rebuild them when frames are added, removed or changed
state.on((kind) => {
  if (kind === 'frames') {
    try {
      refreshMasters();
    } catch {
      // e.g. frames of different sizes; the checks explain it
    }
    if (state.frames.length === 0 && current !== 'files') go('files');
    else renderChrome();
  }
});

document.documentElement.lang = getLang();
renderChrome();
stepArea.replaceChildren(files.element);
document.getElementById('app')!.replaceChildren(
  top,
  h('main', { class: 'layout' }, stepArea, viewer.element),
  footer,
);

onLangChange(() => {
  renderChrome();
  files.render();
  if (current === 'calibration') calibration.render();
  viewer.render();
});
