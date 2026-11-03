// Mentor mode: answer key, all steps open, the app's suggestions at once, and comments (§4.7).
// The switch is saved in the browser, not in the project, so a student's copy opens without it.
// Switching it on needs the mentor password. It only keeps students from switching it on by
// chance: the app has no server, so it cannot be kept secret (§4.7).

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

/** FNV-1a hash of the password, so that it is not written in the code as it is. */
const PASSWORD_HASH = 0x60725e43;

function hash(s: string): number {
  let x = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return x;
}

export function isMentorPassword(password: string): boolean {
  return hash(password) === PASSWORD_HASH;
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
