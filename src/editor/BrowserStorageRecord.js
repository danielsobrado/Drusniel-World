const RECORD_KIND = 'simcity-dnd-browser-document';

function isRecord(value) {
  return value?.kind === RECORD_KIND && value.version === 1
    && Object.hasOwn(value, 'document');
}

export function browserDocument(record) {
  return isRecord(record) ? record.document : record;
}

export function fallbackId(record) {
  return isRecord(record) ? record.fallbackId ?? null : null;
}

export function createBrowserStorageRecord(document, localRecord, { fallback = false } = {}) {
  return {
    kind: RECORD_KIND,
    version: 1,
    document,
    ...(fallback
      ? { fallbackId: globalThis.crypto.randomUUID() }
      : { supersedesFallbackId: fallbackId(localRecord) }),
  };
}

// A recovered IndexedDB may still contain the save from before its outage.
// Only a successful write that observed this fallback can supersede it. Tokens
// avoid depending on document timestamps or the user's wall clock.
export function preferredBrowserRecord(primary, local) {
  if (primary == null) return local;
  const id = fallbackId(local);
  if (id !== null && (!isRecord(primary) || primary.supersedesFallbackId !== id)) {
    return local;
  }
  return primary;
}

export function serializeBrowserFallback(record) {
  return JSON.stringify(record, function checkJsonValue(key, value) {
    // Inspect the original value too: JSON invokes toJSON before the replacer.
    const original = this[key];
    if (original !== null && typeof original === 'object') {
      const prototype = Object.getPrototypeOf(original);
      if (!Array.isArray(original) && prototype !== Object.prototype && prototype !== null) {
        throw new Error('This browser document requires IndexedDB; localStorage cannot preserve binary or non-JSON data.');
      }
    }
    if (typeof original === 'function' || typeof original === 'symbol'
        || typeof original === 'bigint'
        || (typeof original === 'number' && !Number.isFinite(original))) {
      throw new Error('This browser document requires IndexedDB; localStorage cannot preserve non-JSON data.');
    }
    return value;
  });
}
