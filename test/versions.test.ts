import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { beforeEach, describe, expect, it } from 'vitest';
import { importFiles } from '../src/import';
import { refreshAll } from '../src/masters';
import { open, serialize } from '../src/project';
import { state } from '../src/state';
import type { TaskPart } from '../src/tasks';
import { MeasureContext } from '../src/tasks/context';
import { answerKey } from '../src/ui/task';
import { computeVersion, differences, isFresh, saveVersion } from '../src/versions';
import { synthFits } from './helpers';

const W = 6;
// Flats are brighter on the right, so dividing by the flat changes the lights
const frame = (name: string, type: string, value: (x: number) => number, filter = 'V') => ({
  name,
  file: new File([synthFits({
    bitpix: 16, width: W, height: 4, raw: Array.from({ length: W * 4 }, (_, i) => value(i % W)),
    cards: [['IMAGETYP', type], ['FILTER', filter], ['EXPTIME', type === 'BIAS' ? 0 : 30]],
  })], name),
});

async function load(): Promise<string> {
  await importFiles([
    frame('b1.fits', 'BIAS', () => 1000),
    frame('f1.fits', 'FLAT', (x) => 21000 + 2000 * x),
    frame('l1.fits', 'LIGHT', () => 1500),
  ]);
  state.updateSettings({ trim: null });
  for (const s of ['trim', 'bias', 'dark', 'flat', 'calibrate'] as const) state.setStep(s, { done: true });
  refreshAll();
  return state.framesOf('light')[0].meta.id;
}

describe('versions', () => {
  beforeEach(() => state.clear());

  it('computes a version with its own settings and leaves the current images alone', async () => {
    const id = await load();
    saveVersion('with flat');
    state.updateSettings({ useFlat: false });
    refreshAll();
    const current = state.calibrated.get(id)!;
    expect(current.data[0]).toBe(500);
    state.select(`cal:${id}`);
    state.markSaved();

    const events: string[] = [];
    state.on((k) => events.push(k));
    const p = computeVersion('v1')!;
    expect(events).toEqual([]);
    expect(state.dirty).toBe(false);
    expect(state.selectedId).toBe(`cal:${id}`);
    expect(state.calibrated.get(id)).toBe(current);
    expect(state.settings.useFlat).toBe(false);
    // With the flat, the right side of the light is divided by a brighter flat
    const v = p.calibrated.get(id)!;
    expect(v.data[W - 1]).toBeLessThan(v.data[0]);
    expect(state.viewable(`v:v1:cal:${id}`)!.image).toBe(v);
    expect(state.viewable(`v:v1:master:bias`)).toBeDefined();

    expect(differences(state.versions[0].settings, state.settings)).toEqual([{ what: 'useFlat', value: true }]);
    expect(isFresh('v1')).toBe(true);
    // A version follows the steps done in the project
    state.setStep('calibrate', undefined);
    expect(isFresh('v1')).toBe(false);
  });

  it('keeps the images of two versions only', async () => {
    await load();
    for (const name of ['a', 'b', 'c']) saveVersion(name);
    for (const v of ['v1', 'v2', 'v3']) computeVersion(v);
    expect([...state.versionProducts.keys()]).toEqual(['v2', 'v3']);
    computeVersion('v2');
    computeVersion('v1');
    expect([...state.versionProducts.keys()]).toEqual(['v2', 'v1']);
  });

  it('keeps versions and mentor comments in the project file', async () => {
    await load();
    saveVersion('ilma tasaväljata');
    state.addComment('step:flat', 'Vaata nurki veel kord.');
    state.addComment('task:flat-corners', 'Hea!');
    state.removeComment('task:flat-corners', 0);
    const bytes = serialize();
    state.clear();
    open(bytes);
    expect(state.versions.map((v) => v.name)).toEqual(['ilma tasaväljata']);
    expect(state.comments['step:flat'][0].text).toBe('Vaata nurki veel kord.');
    expect(state.comments['task:flat-corners']).toBeUndefined();

    // Projects from 0.5 have no versions and an empty comment list
    const files = unzipSync(bytes);
    const json = JSON.parse(strFromU8(files['project.json']));
    delete json.versions;
    delete json.mentorComments;
    files['project.json'] = strToU8(JSON.stringify(json));
    open(zipSync(files));
    expect(state.versions).toEqual([]);
    expect(state.comments).toEqual({});
  });
});

describe('answer key', () => {
  it('shows the expected values and tolerance', () => {
    const ctx = new MeasureContext();
    const number: TaskPart = { id: 'n', label: { et: '', en: '' }, type: 'number', unit: 'px', expected: () => [2.3, 4.25], tolerance: { rel: 0.15, abs: 0.4 } };
    expect(answerKey(number, ctx)).toBe('2,3 / 4,25 px (±15 % või ±0,4 px)');
    const choice: TaskPart = { id: 'c', label: { et: '', en: '' }, type: 'choice', options: [{ id: 'a', label: { et: 'mediaan', en: 'median' } }], correct: 'a' };
    expect(answerKey(choice, ctx)).toBe('mediaan');
    expect(answerKey({ ...number, expected: () => undefined }, ctx)).toMatch(/arvutatakse/);
    expect(answerKey({ id: 't', label: { et: '', en: '' }, type: 'text' }, ctx)).toBeNull();
  });
});
