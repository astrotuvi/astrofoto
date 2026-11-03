// The dialog that asks for the mentor password before mentor mode is switched on (§4.7).

import { h } from '../dom';
import { t } from '../i18n';
import { isMentorPassword, setMentor } from '../mentor';

export function askMentorPassword(): void {
  const input = h('input', { type: 'password', autocomplete: 'off', autofocus: true });
  const error = h('p', { class: 'error', role: 'alert', hidden: true }, t('mentor.wrongPassword'));
  const dialog = h('dialog', { class: 'app-dialog', 'aria-labelledby': 'mentor-login-title' },
    h('form', {
      onsubmit: (e: Event) => {
        e.preventDefault();
        if (!isMentorPassword(input.value)) {
          error.hidden = false;
          input.select();
          return;
        }
        dialog.close();
        setMentor(true);
      },
    },
    h('h2', { id: 'mentor-login-title' }, t('mentor.label')),
    h('p', {}, t('mentor.confirm')),
    h('label', { class: 'field' }, t('mentor.password'), input),
    error,
    h('div', { class: 'dialog-buttons' },
      h('button', { type: 'button', onclick: () => dialog.close() }, t('project.cancel')),
      h('button', { type: 'submit', class: 'primary' }, t('mentor.switchOn')))));
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}
