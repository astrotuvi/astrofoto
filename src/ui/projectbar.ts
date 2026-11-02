// New / open / save buttons, Ctrl+S, and the warning before closing with unsaved changes.

import { h } from '../dom';
import { canSaveInPlace, Cancelled, type FileHandle, pickFile, saveFile } from '../fileio';
import { type Key, t } from '../i18n';
import { open, PROJECT_EXT, ProjectError, projectTitle, serialize, suggestedName } from '../project';
import { state } from '../state';

const TYPE = { description: 'Astrofoto', accept: { 'application/zip': [PROJECT_EXT] } };

export class ProjectBar {
  readonly element = h('div', { class: 'project-bar' });
  private handle: FileHandle | null = null;
  private message: { text: string; level: 'ok' | 'error' | 'warning' } | null = null;
  private busy = false;

  /** `opened` is called after a project has been opened (to show the resume page). */
  constructor(private opened: (warning?: string) => void, private cleared: () => void) {
    state.on((kind) => {
      if (kind === 'saved' || kind === 'info' || kind === 'frames' || !state.dirty !== !this.element.dataset.dirty) this.render();
    });
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void this.save(e.shiftKey);
      }
    });
    window.addEventListener('beforeunload', (e) => {
      if (state.dirty && state.frames.length) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    this.render();
  }

  render(): void {
    this.element.dataset.dirty = state.dirty ? '1' : '';
    const hasFrames = state.frames.length > 0;
    const name = this.handle?.name ?? projectTitle();
    this.element.replaceChildren(h('div', { class: 'project-inner' },
      h('div', { class: 'segmented', role: 'group', 'aria-label': t('project.label') },
        h('button', { type: 'button', onclick: () => this.newProject(), disabled: this.busy }, t('project.new')),
        h('button', { type: 'button', onclick: () => void this.pick(), disabled: this.busy }, t('project.open')),
        h('button', {
          type: 'button',
          onclick: () => void this.save(false),
          disabled: this.busy || !hasFrames,
          title: t('project.saveTip'),
        }, this.busy ? t('project.saving') : t('project.save')),
        canSaveInPlace ? h('button', { type: 'button', onclick: () => void this.save(true), disabled: this.busy || !hasFrames }, t('project.saveAs')) : null,
      ),
      hasFrames ? h('span', { class: 'project-name' + (state.dirty ? ' dirty' : ''), title: state.dirty ? t('project.unsaved') : undefined },
        name, state.dirty ? ' •' : '') : null,
      this.message ? h('span', { class: `project-message ${this.message.level}`, role: 'status' }, this.message.text) : null,
    ));
  }

  private say(text: string, level: 'ok' | 'error' | 'warning'): void {
    this.message = { text, level };
    this.render();
    if (level === 'ok') {
      setTimeout(() => {
        if (this.message?.text === text) {
          this.message = null;
          this.render();
        }
      }, 4000);
    }
  }

  private confirmDiscard(): boolean {
    return !state.dirty || state.frames.length === 0 || confirm(t('project.discard'));
  }

  /** Asks for the title and the student, and says what happens to the open project. */
  private newProject(): void {
    const isOpen = state.frames.length > 0;
    const title = h('input', { type: 'text', placeholder: t('project.defaultTitle'), autofocus: true });
    const student = h('input', { type: 'text', value: isOpen ? state.info.student : '' });
    const dialog = h('dialog', { class: 'new-project', 'aria-labelledby': 'new-project-title' },
      h('form', { method: 'dialog' },
        h('h2', { id: 'new-project-title' }, t('project.newTitle')),
        isOpen ? h('p', {}, t('project.closeNote', { name: this.handle?.name ?? projectTitle() })) : null,
        isOpen && state.dirty ? h('p', { class: 'warning' }, t('project.unsavedNote')) : null,
        h('label', { class: 'field' }, t('resume.projectTitle'), title),
        h('label', { class: 'field' }, t('resume.student'), student),
        h('div', { class: 'dialog-buttons' },
          h('button', { type: 'button', onclick: () => dialog.close() }, t('project.cancel')),
          h('button', { type: 'submit', class: 'primary', value: 'ok' }, t('project.start')))));
    dialog.addEventListener('close', () => {
      dialog.remove();
      if (dialog.returnValue !== 'ok') return;
      this.handle = null;
      this.message = null;
      state.clear();
      state.setInfo({ title: title.value.trim(), student: student.value.trim() });
      this.cleared();
    });
    document.body.append(dialog);
    dialog.showModal();
  }

  async save(saveAs: boolean): Promise<void> {
    if (!state.frames.length || this.busy) return;
    this.busy = true;
    this.render();
    try {
      // Let the button show "Saving…" before the zip is built
      await new Promise((r) => setTimeout(r, 20));
      const data = serialize();
      this.handle = await saveFile(data, suggestedName(), TYPE, this.handle, saveAs);
      state.info.lastSaved = new Date().toISOString();
      state.markSaved();
      this.busy = false;
      this.say(canSaveInPlace ? t('project.saved') : t('project.downloaded'), 'ok');
    } catch (e) {
      this.busy = false;
      if (e instanceof Cancelled) this.render();
      else this.say(t('project.saveFailed', { detail: String(e) }), 'error');
    }
  }

  private async pick(): Promise<void> {
    if (!this.confirmDiscard()) return;
    try {
      const { file, handle } = await pickFile(TYPE);
      await this.openFile(file, handle, true);
    } catch (e) {
      if (!(e instanceof Cancelled)) this.say(t('project.openFailed', { detail: String(e) }), 'error');
    }
  }

  /** Opens a project file, e.g. one dropped on the files step. */
  async openFile(file: File, handle: FileHandle | null = null, confirmed = false): Promise<void> {
    if (!confirmed && !this.confirmDiscard()) return;
    this.busy = true;
    this.render();
    try {
      await new Promise((r) => setTimeout(r, 20));
      const result = open(new Uint8Array(await file.arrayBuffer()));
      // A handle from the file picker lets Ctrl+S save over the same file
      this.handle = handle;
      if (!state.info.title) state.setInfo({ title: file.name.replace(/\.astroproj$/i, '') });
      state.markSaved();
      this.message = null;
      this.busy = false;
      this.render();
      this.opened(result.newerApp ? t('project.newerApp', { version: result.newerApp }) : undefined);
    } catch (e) {
      this.busy = false;
      const key = e instanceof ProjectError ? (`project.error.${e.code}` as Key) : null;
      this.say(key ? t(key, { detail: e instanceof Error ? e.message : '' }) : t('project.openFailed', { detail: String(e) }), 'error');
    }
  }
}
