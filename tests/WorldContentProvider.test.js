import assert from 'node:assert/strict';
import test from 'node:test';
import {
  IndexedDbWorldContentProvider,
  LocalFirstWorldContentProvider,
  MemoryWorldContentProvider,
  UrlWorldContentProvider,
} from '../src/editor/world/WorldContentProvider.js';

function createFakeIndexedDb() {
  const values = new Map();
  return {
    open() {
      const listeners = { upgradeneeded: [], success: [], error: [] };
      const database = {
        objectStoreNames: { contains: () => false },
        createObjectStore() {},
        close() {},
        transaction() {
          // `IndexedDbWorldContentProvider.transact` resolves on the IDB
          // transaction's 'complete' event, which fires after the request
          // settles, so the fake must surface that event too.
          const listeners = { complete: [], abort: [], error: [] };
          let settled = false;
          const settle = (type) => {
            if (settled) return;
            settled = true;
            for (const handler of listeners[type]) handler();
          };
          return {
            addEventListener(type, handler) {
              if (listeners[type]) listeners[type].push(handler);
            },
            objectStore() {
              return {
                get(key) {
                  return makeRequest(values.get(key), () => settle('complete'));
                },
                put(value, key) {
                  values.set(key, structuredClone(value));
                  return makeRequest(key, () => settle('complete'));
                },
              };
            },
          };
        },
      };
      const request = {
        result: database,
        addEventListener(type, handler) {
          listeners[type].push(handler);
        },
      };
      queueMicrotask(() => {
        for (const handler of listeners.upgradeneeded) handler();
        for (const handler of listeners.success) handler();
      });
      return request;
    },
  };
}

function makeRequest(result, onSuccess = null) {
  const listeners = { success: [], error: [] };
  const request = {
    result,
    addEventListener(type, handler) {
      listeners[type].push(handler);
    },
  };
  queueMicrotask(() => {
    for (const handler of listeners.success) handler();
    // Runs after the request listeners so the transaction can observe the
    // settled result, mirroring a real IDB transaction 'complete' event.
    onSuccess?.();
  });
  return request;
}

test('local-first content returns local data without calling the URL provider', async () => {
  const local = new MemoryWorldContentProvider();
  await local.putChunk('world-a', 3, -2, { settlements: [{ id: 'local' }] });
  let remoteCalls = 0;
  const remote = {
    async getChunk() {
      remoteCalls += 1;
      return { settlements: [{ id: 'remote' }] };
    },
  };
  const provider = new LocalFirstWorldContentProvider({ local, remote });
  assert.deepEqual(
    await provider.getChunk('world-a', 3, -2),
    { settlements: [{ id: 'local' }] },
  );
  assert.equal(remoteCalls, 0);
});

test('local-first content caches URL results locally and falls back cleanly offline', async () => {
  const local = new MemoryWorldContentProvider();
  const remote = {
    async getChunk() {
      return { encounters: [{ id: 'remote-encounter' }] };
    },
  };
  const provider = new LocalFirstWorldContentProvider({ local, remote });
  const result = await provider.getChunk('world-a', 1, 2);
  assert.deepEqual(result, { encounters: [{ id: 'remote-encounter' }] });
  assert.deepEqual(await local.getChunk('world-a', 1, 2), result);

  provider.remote = { getChunk: async () => { throw new TypeError('offline'); } };
  assert.deepEqual(await provider.getChunk('world-a', 1, 2), result);
  assert.equal(await provider.getChunk('world-a', 8, 9), null);
});

test('URL content provider treats 404 as an empty chunk', async () => {
  const provider = new UrlWorldContentProvider({
    baseUrl: 'https://world.example/content',
    fetchImpl: async () => ({ ok: false, status: 404 }),
  });
  assert.equal(await provider.getChunk('world-a', -1, 4), null);
});

test('URL content provider loads JSON and reports server errors', async () => {
  const success = new UrlWorldContentProvider({
    baseUrl: 'https://world.example/content/',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ settlements: [{ id: 'capital' }] }),
    }),
  });
  assert.deepEqual(
    await success.getChunk('world/a', 1, 4),
    { settlements: [{ id: 'capital' }] },
  );

  const failed = new UrlWorldContentProvider({
    baseUrl: 'https://world.example/content',
    fetchImpl: async () => ({ ok: false, status: 503 }),
  });
  await assert.rejects(() => failed.getChunk('world-a', 1, 4), /status 503/);
});

test('IndexedDB content persists chunks and degrades to empty when unavailable', async () => {
  const original = globalThis.indexedDB;
  try {
    delete globalThis.indexedDB;
    const unavailable = new IndexedDbWorldContentProvider();
    assert.equal(await unavailable.getChunk('world-a', 0, 0), null);
    await unavailable.putChunk('world-a', 0, 0, { ignored: true });

    globalThis.indexedDB = createFakeIndexedDb();
    const provider = new IndexedDbWorldContentProvider();
    await provider.putChunk('world-a', -3, 7, { zones: [{ id: 'wilds' }] });
    assert.deepEqual(
      await provider.getChunk('world-a', -3, 7),
      { zones: [{ id: 'wilds' }] },
    );
  } finally {
    if (original === undefined) {
      delete globalThis.indexedDB;
    } else {
      globalThis.indexedDB = original;
    }
  }
});

test('content providers validate construction and persist explicit local writes', async () => {
  assert.throws(() => new UrlWorldContentProvider(), /base URL/);
  assert.throws(
    () => new LocalFirstWorldContentProvider({ local: null }),
    /local provider/,
  );
  const local = new MemoryWorldContentProvider();
  const provider = new LocalFirstWorldContentProvider({ local });
  await provider.putChunk('world-a', 2, 2, { markers: [{ id: 'ruin' }] });
  assert.deepEqual(
    await provider.getChunk('world-a', 2, 2),
    { markers: [{ id: 'ruin' }] },
  );
});
