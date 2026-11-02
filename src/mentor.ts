// Mentor mode: answer key, all steps open, the app's suggestions at once, and comments (§4.7).
// The switch is saved in the browser, not in the project, so a student's copy opens without it.

import { state } from './state';

const STORAGE_KEY = 'astrofoto.mentor';

let on = load();

function load(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function isMentor(): boolean {
  return on;
}

export function setMentor(value: boolean): void {
  on = value;
  try {
    if (value) localStorage.setItem(STORAGE_KEY, '1');
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // not saved; mentor mode lasts until the page is closed
  }
  state.emit('mentor');
}
