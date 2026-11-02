// Mentor comments on a step or a task (§4.7). Everyone sees them; only mentor mode can add or
// remove them. The block redraws itself, so the step around it is not rebuilt.

import { h } from '../dom';
import { getLang, t } from '../i18n';
import { isMentor } from '../mentor';
import { state } from '../state';

export function formatCommentDate(iso: string): string {
  return new Date(iso).toLocaleString(getLang() === 'et' ? 'et-EE' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

/** Comments for 'step:<id>' or 'task:<id>'; null when there are none and mentor mode is off. */
export function renderComments(key: string): HTMLElement | null {
  if (!isMentor() && !state.comments[key]?.length) return null;
  const box = h('div', { class: 'comments' });
  const draw = () => {
    const list = state.comments[key] ?? [];
    const text = h('textarea', { rows: 2, 'aria-label': t('comment.new') });
    box.replaceChildren(
      ...list.map((c, i) => h('div', { class: 'mentor-comment' },
        h('div', { class: 'comment-head' },
          h('strong', {}, t('comment.title')), ' ', h('span', { class: 'date' }, formatCommentDate(c.date)),
          isMentor() ? h('button', {
            type: 'button',
            class: 'small danger',
            onclick: () => {
              state.removeComment(key, i);
              draw();
            },
          }, t('comment.remove')) : null),
        h('p', { class: 'comment-text' }, c.text))),
      ...(isMentor() ? [h('form', {
        class: 'comment-form',
        onsubmit: (e: Event) => {
          e.preventDefault();
          const v = text.value.trim();
          if (!v) return;
          state.addComment(key, v);
          draw();
        },
      }, text, h('button', { type: 'submit' }, t('comment.add')))] : []),
    );
  };
  draw();
  return box;
}
