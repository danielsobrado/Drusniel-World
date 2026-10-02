import assert from 'node:assert/strict';
import test from 'node:test';
import { InfiniteTerrainView } from '../src/editor/InfiniteTerrainView.js';
import { TerrainCommitQueue } from '../src/editor/world/TerrainCommitQueue.js';
import { createTerrainChunkDescriptor } from '../src/editor/world/TerrainStreamingPlan.js';

function createView(t, requestChunk) {
  t.mock.method(console, 'error', () => {});
  const view = Object.create(InfiniteTerrainView.prototype);
  Object.assign(view, {
    disposed: false,
    clock: 0,
    chunkSize: 8,
    worldStore: { tileSize: 2, requestChunk },
    streamingConfig: { prefetchSeconds: 0, loadRadius: 0, unloadRadius: 0 },
    focusChunk: { chunkX: 0, chunkZ: 0 },
    focusVelocity: { x: 0, z: 0 },
    focusChunkKey: '0:0|0:0',
    pendingFetches: new Set(),
    commitQueue: new TerrainCommitQueue(),
    positionSlot() {},
    positionSlots() {},
  });
  const slot = {
    slotIndex: 0, token: 0, loading: false, mesh: { visible: false },
  };
  view.slots = [slot];
  const descriptor = createTerrainChunkDescriptor({
    chunkX: 0, chunkZ: 0, chunkSize: 8, tileSize: 2,
  });
  return { view, slot, descriptor };
}

for (const synchronous of [false, true]) {
  test(`failed terrain requests retry at a stationary focus (${synchronous ? 'sync' : 'async'} error)`, async (t) => {
    let requests = 0;
    const page = { key: '0:0' };
    const { view, slot, descriptor } = createView(t, () => {
      requests += 1;
      if (requests > 1) return Promise.resolve(page);
      if (synchronous) throw new Error('temporary outage');
      return Promise.reject(new Error('temporary outage'));
    });
    await view.assignSlot(slot, descriptor);
    const retryAt = slot.retryAt;
    assert.equal(slot.loading, false);
    await view.updateStreaming({ x: 0, z: 0 }, retryAt - 1);
    assert.equal(requests, 1, 'does not hammer a failed provider every frame');
    await view.updateStreaming({ x: 0, z: 0 }, retryAt);
    await Promise.all(view.pendingFetches);
    assert.equal(requests, 2);
    assert.equal(slot.retryAt, null);
    assert.equal(view.commitQueue.size, 1);
    view.commitQueue.drain((job) => {
      assert.equal(job.page, page);
      assert.equal(job.slot, slot);
    });
  });
}

test('an evicted failed slot requests its new chunk instead of retrying its old chunk', async (t) => {
  const requests = [];
  const { view, slot, descriptor } = createView(t, (x, z) => {
    requests.push([x, z]);
    return requests.length === 1 ? Promise.reject(new Error('failed')) : Promise.resolve({ key: '1:0' });
  });
  await view.assignSlot(slot, descriptor);
  await view.updateStreaming({ x: 16, z: 0 }, slot.retryAt + 1);
  await Promise.all(view.pendingFetches);
  assert.deepEqual(requests, [[0, 0], [1, 0]]);
  assert.equal(slot.key, '1:0');
  assert.equal(view.commitQueue.size, 1);
});

test('late failures cannot schedule retries for a reassigned slot', async (t) => {
  let rejectOld;
  const { view, slot, descriptor } = createView(t, (x) => x === 0
    ? new Promise((_, reject) => { rejectOld = reject; })
    : Promise.resolve({ key: '1:0' }));
  const oldRequest = view.assignSlot(slot, descriptor);
  await Promise.resolve();
  await view.assignSlot(slot, createTerrainChunkDescriptor({
    chunkX: 1, chunkZ: 0, chunkSize: 8, tileSize: 2,
  }));
  rejectOld(new Error('stale failure'));
  await oldRequest;
  assert.equal(slot.retryAt, null);
  assert.equal(slot.loading, true, 'new page still waits for its budgeted commit');
});

test('disposed views do not restart failed terrain requests', async (t) => {
  let requests = 0;
  const { view, slot, descriptor } = createView(t, () => {
    requests += 1;
    return Promise.reject(new Error('failed'));
  });
  await view.assignSlot(slot, descriptor);
  view.disposed = true;
  await view.updateStreaming({ x: 0, z: 0 }, slot.retryAt + 1);
  assert.equal(requests, 1);
});
