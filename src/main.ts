// App start and step navigation.

import './style.css';
import { h } from './dom';
import { getLang, type Key, type Lang, onLangChange, setLang, t } from './i18n';
import { FilesStep } from './ui/files';
import { ViewerPanel } from './ui/viewerpanel';

declare const __APP_VERSION__: string;

const STEPS: { label: Key; ready: boolean }[] = [
  { label: 'step.files', ready: true },
  { label: 'step.calibration', ready: false },
  { label: 'step.align', ready: false },
  { label: 'step.color', ready: false },
];

const files = new FilesStep();
const viewer = new ViewerPanel();
const top = h('header', { class: 'topbar' });
const footer = h('footer', { class: 'footer' });

function renderChrome(): void {
  document.title = t('app.title');
  top.replaceChildren(
    h('div', { class: 'brand' }, h('strong', {}, t('app.title')), h('span', { class: 'tagline' }, t('app.tagline'))),
    h('nav', { class: 'steps', 'aria-label': t('step.nav') },
      h('ol', {}, STEPS.map((s, i) =>
        h('li', { class: i === 0 ? 'current' : s.ready ? '' : 'locked', title: s.ready ? undefined : t('step.later') },
          h('span', { class: 'num' }, String(i + 1)), ' ', t(s.label))))),
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

document.documentElement.lang = getLang();
renderChrome();
document.getElementById('app')!.replaceChildren(
  top,
  h('main', { class: 'layout' }, files.element, viewer.element),
  footer,
);

onLangChange(() => {
  renderChrome();
  files.render();
  viewer.render();
});
