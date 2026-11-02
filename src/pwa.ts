// Offline use and updates (§6.3): registers the service worker, tells when a new version is
// waiting (it is never loaded by itself), and keeps the browser's install prompt for a button.

import { registerSW } from 'virtual:pwa-register';

declare const __OFFLINE_FILE__: boolean;

/** How the app can be used without a connection. */
export type OfflineStatus = 'file' | 'ready' | 'saving' | 'none';

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let status: OfflineStatus = 'none';
let needRefresh = false;
let installPrompt: InstallPrompt | null = null;
let registration: ServiceWorkerRegistration | undefined;
let updateSW: ((reload?: boolean) => Promise<void>) | null = null;
const listeners = new Set<() => void>();

const HOUR = 60 * 60 * 1000;

function changed(): void {
  for (const fn of listeners) fn();
}

export function onPwaChange(fn: () => void): void {
  listeners.add(fn);
}

export const offlineStatus = (): OfflineStatus => status;
export const updateWaiting = (): boolean => needRefresh;
export const canInstall = (): boolean => installPrompt !== null;
export const isInstalled = (): boolean => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
export const isOfflineFile = (): boolean => __OFFLINE_FILE__ || location.protocol === 'file:';

export function startPwa(): void {
  if (isOfflineFile()) {
    status = 'file';
    return;
  }
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  status = navigator.serviceWorker.controller ? 'ready' : 'saving';
  updateSW = registerSW({
    onNeedRefresh() {
      needRefresh = true;
      changed();
    },
    onOfflineReady() {
      status = 'ready';
      changed();
    },
    onRegisteredSW(_url, reg) {
      registration = reg;
      // A long lesson can outlast a release; look again every hour while online
      if (reg) setInterval(() => void (navigator.onLine && reg.update()), HOUR);
    },
    onRegisterError() {
      status = 'none';
      changed();
    },
  });
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e as InstallPrompt;
    changed();
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    changed();
  });
}

/** Loads the waiting version. The unsaved-changes warning still applies. */
export function reloadToUpdate(): void {
  if (updateSW) void updateSW(true);
  else location.reload();
}

/** Asks the browser for a newer version now; true if one is coming. */
export async function checkForUpdate(): Promise<boolean> {
  if (!registration) return false;
  await registration.update();
  return needRefresh || !!registration.installing || !!registration.waiting;
}

export async function install(): Promise<void> {
  if (!installPrompt) return;
  const p = installPrompt;
  installPrompt = null;
  await p.prompt();
  await p.userChoice;
  changed();
}
