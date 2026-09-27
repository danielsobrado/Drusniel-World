import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WorldChunkWorkerClient,
  resolveWorkerCount,
} from '../src/editor/world/WorldChunkWorkerClient.js';
import { ProceduralWorldGenerator } from '../src/editor/world/ProceduralWorldGenerator.js';

class FakeWorker {
  constructor() {
    this.posted = [];
    this.terminated = false;
    this.listeners = { message: [], error: [] };
    FakeWorker.instances.push(this);
  }

  addEventListener(type, handler) {
    // Any event a real Worker dispatches (the client also listens for messageerror).
    (this.listeners[type] ??= []).push(handler);
  }

  postMessage(data) {
    this.posted.push(data);
  }

  terminate() {
    this.terminated = true;
  }

  /** Test helper: deliver a worker result for a posted request. */
  resolve(id, page = { key: `page-${id}` }) {
    for (const handler of this.listeners.message) {
      handler({ data: { id, page } });
    }
  }
}
FakeWorker.instances = [];

const generator = new ProceduralWorldGenerator({ seed: 7 });

function withFakeWorkers(run) {
  const original = globalThis.Worker;
  globalThis.Worker = FakeWorker;
  FakeWorker.instances = [];
  try {
    return run();
  } finally {
    globalThis.Worker = original;
  }
}

function makeClient(options = {}) {
  return new WorldChunkWorkerClient({ chunkSize: 4, generator, ...options });
}

/** Which chunk each dispatched message corresponds to, in dispatch order. */
function dispatchOrder() {
  return FakeWorker.instances
    .flatMap((worker) => worker.posted)
    .sort((a, b) => a.id - b.id)
    .map((message) => `${message.request.chunkX}:${message.request.chunkZ}`);
}

test('resolveWorkerCount clamps and honors overrides', () => {
  assert.equal(resolveWorkerCount(3), 3);
  assert.ok(resolveWorkerCount(0) >= 2 && resolveWorkerCount(0) <= 8);
  assert.ok(resolveWorkerCount(null) >= 2 && resolveWorkerCount(null) <= 8);
});

test('falls back to synchronous generation without a Worker global', async () => {
  const client = makeClient();
  assert.equal(client.workerCount, 0);
  const page = await client.request(0, 0);
  assert.ok(page && typeof page.key === 'string');
});

test('dispatches at most one job per worker and queues the rest', () => {
  withFakeWorkers(() => {
    const client = makeClient({ workerCount: 2 });
    assert.equal(client.workerCount, 2);
    for (let i = 0; i < 4; i += 1) {
      client.request(i, 0);
    }
    const posted = FakeWorker.instances.reduce((n, w) => n + w.posted.length, 0);
    assert.equal(posted, 2, 'only one job in flight per worker');
    assert.equal(client.queue.length, 2, 'remaining jobs wait in the client queue');
  });
});

test('serves queued requests in priority order', async () => {
  await withFakeWorkers(async () => {
    const client = makeClient({ workerCount: 1 });
    const worker = FakeWorker.instances[0];
    client.request(10, 0, { priority: 5 }); // dispatched immediately (id 1)
    client.request(11, 0, { priority: 1 }); // queued (id 2)
    client.request(12, 0, { priority: 3 }); // queued (id 3)
    assert.equal(worker.posted.length, 1);

    worker.resolve(1); // frees the worker -> highest priority (lowest number) next
    assert.equal(worker.posted.at(-1).request.chunkX, 11);
    worker.resolve(2);
    assert.equal(worker.posted.at(-1).request.chunkX, 12);
    assert.deepEqual(dispatchOrder(), ['10:0', '11:0', '12:0']);
  });
});

test('cancels a still-queued request without dispatching it', async () => {
  await withFakeWorkers(async () => {
    const client = makeClient({ workerCount: 1 });
    const worker = FakeWorker.instances[0];
    client.request(20, 0); // dispatched (id 1)
    const cancelled = client.request(21, 0); // queued (id 2)
    client.request(22, 0); // queued (id 3)

    let rejection = null;
    cancelled.catch((error) => { rejection = error; });

    assert.equal(client.cancel(21, 0), true);
    assert.equal(client.cancel(21, 0), false, 'second cancel is a no-op');

    worker.resolve(1); // frees worker -> 22 dispatched, 21 skipped
    await Promise.resolve();
    assert.equal(worker.posted.at(-1).request.chunkX, 22);
    assert.ok(rejection && rejection.cancelled === true);
  });
});

test('reprioritize reorders a queued job', () => {
  withFakeWorkers(() => {
    const client = makeClient({ workerCount: 1 });
    const worker = FakeWorker.instances[0];
    client.request(30, 0, { priority: 0 }); // dispatched
    client.request(31, 0, { priority: 5 }); // queued
    client.request(32, 0, { priority: 6 }); // queued

    assert.equal(client.reprioritize(32, 0, 1), true); // 32 now beats 31
    assert.equal(client.reprioritize(99, 0, 0), false, 'unknown chunk is a no-op');

    worker.resolve(1);
    assert.equal(worker.posted.at(-1).request.chunkX, 32);
  });
});

test('dispose rejects pending and queued work', async () => {
  await withFakeWorkers(async () => {
    const client = makeClient({ workerCount: 1 });
    const inFlight = client.request(40, 0);
    const queued = client.request(41, 0);
    const inFlightErr = inFlight.catch((e) => e);
    const queuedErr = queued.catch((e) => e);

    client.dispose();
    assert.ok((await inFlightErr) instanceof Error);
    assert.ok((await queuedErr) instanceof Error);
    assert.ok(FakeWorker.instances.every((w) => w.terminated));
  });
});
