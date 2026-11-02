// The About page (§6.3): version, offline use and installing, updates, and the offline file.

import { h } from '../dom';
import { t } from '../i18n';
import { canInstall, checkForUpdate, install, isInstalled, isOfflineFile, offlineStatus, onPwaChange, reloadToUpdate, updateWaiting } from '../pwa';

declare const __APP_VERSION__: string;

export const PAGES_URL = 'https://astrotuvi.github.io/astrofoto/';
export const REPO_URL = 'https://github.com/astrotuvi/astrofoto';
const FILE_URL = `${REPO_URL}/releases/latest/download/astrofoto.html`;
const RELEASES_URL = `${REPO_URL}/releases`;

export class AboutPage {
  readonly element = h('section', { class: 'step-panel about-page' });
  private active = false;
  private checking = false;
  private message: { text: string; error?: boolean } | null = null;

  constructor() {
    onPwaChange(() => {
      if (this.active) this.render();
    });
  }

  setActive(active: boolean): void {
    this.active = active;
    if (active) {
      this.message = null;
      this.render();
    }
  }

  render(): void {
    const link = (href: string, text: string) => h('a', { href, target: '_blank', rel: 'noopener' }, text);
    this.element.replaceChildren(h('div', {},
      h('h2', {}, t('about.title')),
      h('div', { class: 'about-intro' },
        h('p', {}, t('about.intro')),
        h('p', {}, t('about.version', { version: __APP_VERSION__ })),
        h('p', {}, t('about.privacy'))),
      this.offline(),
      this.updates(),
      h('section', { class: 'phase' },
        h('h3', {}, t('about.file')),
        h('p', {}, t('about.fileHow')),
        h('p', {}, link(FILE_URL, t('about.fileLink')), ' · ', link(RELEASES_URL, t('about.fileAll')))),
      h('section', { class: 'phase' },
        h('h3', {}, t('about.links')),
        h('ul', {},
          h('li', {}, t('about.online'), ' ', link(PAGES_URL, PAGES_URL)),
          h('li', {}, t('about.source'), ' ', link(REPO_URL, REPO_URL))))));
  }

  private offline(): HTMLElement {
    const status = offlineStatus();
    const installed = isInstalled();
    return h('section', { class: 'phase' },
      h('h3', {}, t('about.offline')),
      h('p', { class: status === 'ready' || status === 'file' ? 'ok' : status === 'none' ? 'warning' : 'hint' }, t(`about.status.${status}`)),
      status === 'file' ? null : h('div', {},
        installed ? h('p', { class: 'ok' }, t('about.installed')) : h('p', {}, t('about.installHint')),
        installed ? null : h('ul', {},
          h('li', {}, t('about.installChrome')),
          h('li', {}, t('about.installSafari')),
          h('li', {}, t('about.installFirefox'))),
        canInstall() ? h('div', { class: 'buttons left' },
          h('button', { type: 'button', class: 'primary', onclick: () => void install() }, t('about.install'))) : null));
  }

  private updates(): HTMLElement {
    const file = isOfflineFile();
    const waiting = updateWaiting();
    return h('section', { class: 'phase' },
      h('h3', {}, t('about.updates')),
      h('p', {}, t(file ? 'about.updatesFile' : 'about.updatesHow')),
      file || offlineStatus() === 'none' ? null : h('div', { class: 'buttons left' },
        waiting
          ? h('button', { type: 'button', class: 'primary', onclick: reloadToUpdate }, t('update.reload'))
          : h('button', { type: 'button', disabled: this.checking || !navigator.onLine, onclick: () => void this.check() },
              this.checking ? t('about.checking') : t('about.check'))),
      !file && !navigator.onLine ? h('p', { class: 'hint' }, t('about.offlineNow')) : null,
      // Once the new version is waiting, the reload button says enough
      this.message && !(waiting && !this.message.error) ? h('p', { class: this.message.error ? 'error' : 'ok', role: 'status' }, this.message.text) : null);
  }

  private async check(): Promise<void> {
    this.checking = true;
    this.message = null;
    this.render();
    try {
      const found = await checkForUpdate();
      this.message = { text: t(found ? 'about.updateFound' : 'about.upToDate') };
    } catch (e) {
      this.message = { text: t('about.checkFailed', { detail: String(e) }), error: true };
    } finally {
      this.checking = false;
      this.render();
    }
  }
}
