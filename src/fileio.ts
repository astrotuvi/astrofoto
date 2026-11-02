// Saving and opening files: File System Access API where available (Chrome, Edge),
// download and <input type="file"> elsewhere. See docs/DESIGN.md §6.2.

interface FileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: BlobPart): Promise<void>; close(): Promise<void> }>;
}

interface PickerType { description: string; accept: Record<string, string[]> }

type PickerWindow = Window & {
  showSaveFilePicker?: (o: { suggestedName?: string; types?: PickerType[] }) => Promise<FileHandle>;
  showOpenFilePicker?: (o: { types?: PickerType[]; multiple?: boolean }) => Promise<FileHandle[]>;
};

const w = window as PickerWindow;

export const canSaveInPlace = typeof w.showSaveFilePicker === 'function';

export class Cancelled extends Error {}

function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

/** Writes to a handle, or asks for a file name first. Returns the handle used (null after a download). */
export async function saveFile(
  data: Uint8Array,
  suggestedName: string,
  type: PickerType,
  handle: FileHandle | null,
  saveAs = false,
): Promise<FileHandle | null> {
  if (canSaveInPlace) {
    let h = saveAs ? null : handle;
    if (!h) {
      try {
        h = await w.showSaveFilePicker!({ suggestedName, types: [type] });
      } catch (e) {
        if (isAbort(e)) throw new Cancelled();
        throw e;
      }
    }
    const out = await h.createWritable();
    await out.write(data as Uint8Array<ArrayBuffer>);
    await out.close();
    return h;
  }
  download(data as Uint8Array<ArrayBuffer>, suggestedName);
  return null;
}

export function download(data: BlobPart, name: string): void {
  const url = URL.createObjectURL(new Blob([data]));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Lets the student pick one file. Resolves with the file and, where supported, its handle. */
export async function pickFile(type: PickerType): Promise<{ file: File; handle: FileHandle | null }> {
  if (typeof w.showOpenFilePicker === 'function') {
    try {
      const [h] = await w.showOpenFilePicker({ types: [type], multiple: false });
      return { file: await h.getFile(), handle: h };
    } catch (e) {
      if (isAbort(e)) throw new Cancelled();
      throw e;
    }
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = Object.values(type.accept).flat().join(',');
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) resolve({ file, handle: null });
      else reject(new Cancelled());
    });
    input.addEventListener('cancel', () => reject(new Cancelled()));
    input.click();
  });
}

export type { FileHandle };
