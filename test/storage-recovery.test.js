import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deleteFromBrowser, listBrowserDocuments, loadFromBrowser, saveToBrowser,
} from '../src/editor/storage.js';
import { installBrowserStorage } from './fixtures/browser-storage.js';

const KEY = 'world:recovery';
const document = (name) => ({ version: 6, name });

for (const failure of ['open', 'write']) {
  test(`latest fallback save survives IndexedDB ${failure} recovery`, async (t) => {
    const { faults } = installBrowserStorage(t);
    await saveToBrowser(KEY, document('old'));
    faults[failure] = true;
    await saveToBrowser(KEY, document('latest'));
    faults[failure] = false;

    assert.deepEqual(await loadFromBrowser(KEY), document('latest'));
    assert.deepEqual(await listBrowserDocuments('world:'), [
      { key: KEY, document: document('latest') },
    ]);
    await deleteFromBrowser(KEY);
    assert.equal(await loadFromBrowser(KEY), null);
  });
}

test('successful IndexedDB save supersedes its fallback even when cleanup fails', async (t) => {
  const { faults } = installBrowserStorage(t);
  faults.open = true;
  await saveToBrowser(KEY, document('fallback'));
  faults.open = false;
  faults.cleanup = true;
  await saveToBrowser(KEY, document('recovered'));

  assert.deepEqual(await loadFromBrowser(KEY), document('recovered'));
  assert.deepEqual(await listBrowserDocuments('world:'), [
    { key: KEY, document: document('recovered') },
  ]);
  faults.write = true;
  await saveToBrowser(KEY, document('second outage'));
  faults.write = false;
  assert.deepEqual(await loadFromBrowser(KEY), document('second outage'));
});

test('existing unwrapped saves retain IndexedDB precedence over legacy localStorage', async (t) => {
  const { primary, local, faults } = installBrowserStorage(t);
  primary.set(KEY, document('primary'));
  local.set(KEY, JSON.stringify(document('legacy')));
  assert.deepEqual(await loadFromBrowser(KEY), document('primary'));
  assert.deepEqual(await listBrowserDocuments('world:'), [
    { key: KEY, document: document('primary') },
  ]);
  faults.open = true;
  await saveToBrowser(KEY, document('new fallback'));
  faults.open = false;
  assert.deepEqual(await loadFromBrowser(KEY), document('new fallback'));
});

test('unreadable or malformed localStorage does not hide a valid IndexedDB save', async (t) => {
  const { local, faults } = installBrowserStorage(t);
  faults.localRead = true;
  await saveToBrowser(KEY, document('primary'));
  assert.deepEqual(await loadFromBrowser(KEY), document('primary'));
  faults.localRead = false;
  local.set(KEY, '{broken');
  assert.deepEqual(await loadFromBrowser(KEY), document('primary'));
});

test('a fallback written during an IndexedDB save is not removed by its cleanup', async (t) => {
  const { faults, local } = installBrowserStorage(t);
  const primarySave = saveToBrowser(KEY, document('in flight'));
  // The IDB transaction is pending; another save uses the unavailable backend.
  faults.open = true;
  await saveToBrowser(KEY, document('concurrent fallback'));
  faults.open = false;
  await primarySave;
  assert.ok(local.has(KEY));
  assert.deepEqual(await loadFromBrowser(KEY), document('concurrent fallback'));
});

test('binary assets round-trip through IndexedDB and reject a lossy fallback', async (t) => {
  const { faults, local } = installBrowserStorage(t);
  const asset = { name: 'model.glb', blob: new Blob(['glTF'], { type: 'model/gltf-binary' }) };
  await saveToBrowser(KEY, asset);
  assert.equal(await (await loadFromBrowser(KEY)).blob.text(), 'glTF');
  faults.write = true;
  await assert.rejects(saveToBrowser(KEY, asset), (error) => {
    assert.match(error.cause?.message ?? error.message, /requires IndexedDB/);
    return true;
  });
  assert.equal(local.has(KEY), false);
  faults.write = false;
  assert.equal(await (await loadFromBrowser(KEY)).blob.text(), 'glTF');
});

test('non-JSON fallback failure preserves the previous local save', async (t) => {
  const { faults } = installBrowserStorage(t);
  faults.open = true;
  await saveToBrowser(KEY, document('safe'));
  await assert.rejects(saveToBrowser(KEY, { bytes: new Uint8Array([1, 2, 3]) }));
  assert.deepEqual(await loadFromBrowser(KEY), document('safe'));
});
