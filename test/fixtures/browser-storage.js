// Event-driven in-memory storage with injectable browser failures. Transactions
// finish after request handlers, so callers must await the real commit boundary.
export function installBrowserStorage(t) {
  const originals = new Map(['indexedDB', 'localStorage', 'IDBKeyRange'].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)],
  ));
  const primary = new Map();
  const local = new Map();
  const faults = { open: false, write: false, cleanup: false, localRead: false };
  const fire = (target, event) => target.dispatchEvent(new Event(event));

  globalThis.indexedDB = {
    open() {
      if (faults.open) throw new Error('IndexedDB unavailable');
      const request = new EventTarget();
      request.result = {
        close() {},
        transaction(_storeName, mode) {
          const transaction = new EventTarget();
          transaction.objectStore = () => {
            const perform = (operation) => {
              const result = new EventTarget();
              queueMicrotask(() => {
                if (mode === 'readwrite' && faults.write) {
                  transaction.error = new Error('IndexedDB write failed');
                  fire(transaction, 'abort');
                  return;
                }
                result.result = operation();
                fire(result, 'success');
                fire(transaction, 'complete');
              });
              return result;
            };
            return {
              get: (key) => perform(() => structuredClone(primary.get(key))),
              put: (value, key) => perform(() => primary.set(key, structuredClone(value))),
              delete: (key) => perform(() => primary.delete(key)),
              openCursor: ({ lower, upper }) => {
                const request = new EventTarget();
                const entries = [...primary].filter(([key]) => key >= lower && key <= upper);
                const advance = () => queueMicrotask(() => {
                  const entry = entries.shift();
                  request.result = entry ? {
                    key: entry[0], value: structuredClone(entry[1]), continue: advance,
                  } : null;
                  fire(request, 'success');
                  if (!entry) fire(transaction, 'complete');
                });
                advance();
                return request;
              },
            };
          };
          return transaction;
        },
      };
      queueMicrotask(() => fire(request, 'success'));
      return request;
    },
  };
  globalThis.IDBKeyRange = { bound: (lower, upper) => ({ lower, upper }) };
  globalThis.localStorage = {
    get length() { return local.size; },
    key: (index) => [...local.keys()][index] ?? null,
    getItem(key) {
      if (faults.localRead) throw new Error('localStorage denied');
      return local.get(key) ?? null;
    },
    setItem: (key, value) => local.set(key, String(value)),
    removeItem(key) {
      if (faults.cleanup) throw new Error('localStorage cleanup denied');
      local.delete(key);
    },
  };
  t.mock.method(console, 'warn', () => {});
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return { primary, local, faults };
}
