import assert from 'node:assert/strict';
import test from 'node:test';

import { ProceduralWorkshopPlannerClient } from '../src/editor/workshop/ProceduralWorkshopPlannerClient.js';

function emptyRecipe() {
  return { composition: { primitives: [] } };
}

function fakeWorker() {
  const listeners = new Map();
  const posted = [];
  let terminated = false;
  return {
    posted,
    listeners,
    get terminated() {
      return terminated;
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    postMessage(message) {
      posted.push(message);
    },
    terminate() {
      terminated = true;
    },
  };
}

test('workshop planner fallback reports validation failures asynchronously', async () => {
  const client = new ProceduralWorkshopPlannerClient();
  let result;

  assert.doesNotThrow(() => {
    result = client.plan(emptyRecipe(), ['missing']);
  });
  await assert.rejects(result, /Unknown dirty composition primitive/i);
  client.dispose();
});

test('workshop planner accepts an injected worker without relying on the global Worker API', async () => {
  const worker = fakeWorker();
  const client = new ProceduralWorkshopPlannerClient({ workerFactory: () => worker });
  const result = client.plan(emptyRecipe());

  assert.deepEqual(worker.posted, [{
    revision: 1,
    recipe: emptyRecipe(),
    dirtyIds: [],
  }]);
  const plan = { revisionKey: 'test-plan' };
  worker.listeners.get('message')({ data: { revision: 1, plan } });
  assert.equal(await result, plan);

  client.dispose();
  assert.equal(worker.terminated, true);
});

for (const eventType of ['error', 'messageerror']) {
  test(`workshop planner recovers after a worker ${eventType}`, async () => {
    const worker = fakeWorker();
    const client = new ProceduralWorkshopPlannerClient({ workerFactory: () => worker });
    const pending = client.plan(emptyRecipe());
    const rejected = assert.rejects(pending, /worker/i);
    worker.listeners.get(eventType)({ message: 'worker failed' });
    await rejected;
    assert.equal(worker.terminated, true);
    assert.equal(client.pending.size, 0);

    // A late response from the failed worker must not resolve the new plan.
    const recovered = client.plan(emptyRecipe());
    worker.listeners.get('message')({ data: { revision: 2, plan: { stale: true } } });
    const plan = await recovered;
    assert.ok(plan);
    assert.equal(plan.stale, undefined);
    client.dispose();
  });
}

test('workshop planner clears requests that fail to post without disabling the worker', async () => {
  const worker = fakeWorker();
  const client = new ProceduralWorkshopPlannerClient({ workerFactory: () => worker });
  const post = worker.postMessage;
  worker.postMessage = () => { throw new Error('could not clone recipe'); };
  await assert.rejects(client.plan(emptyRecipe()), /could not clone/);
  assert.equal(client.pending.size, 0);
  worker.postMessage = post;
  const result = client.plan(emptyRecipe());
  worker.listeners.get('message')({ data: { revision: 2, plan: { valid: true } } });
  assert.deepEqual(await result, { valid: true });
  client.dispose();
});

test('workshop planner rejects malformed responses and ignores unrelated messages', async () => {
  const worker = fakeWorker();
  const client = new ProceduralWorkshopPlannerClient({ workerFactory: () => worker });
  const result = client.plan(emptyRecipe());
  assert.doesNotThrow(() => worker.listeners.get('message')({ data: null }));
  worker.listeners.get('message')({ data: { revision: 1 } });
  await assert.rejects(result, /invalid plan/);
  client.dispose();
});

test('workshop planner fallback cancels superseded and cancelled work', async () => {
  const client = new ProceduralWorkshopPlannerClient();
  const superseded = client.plan(emptyRecipe());
  const latest = client.plan(emptyRecipe());
  await assert.rejects(superseded, { name: 'AbortError' });
  assert.ok(await latest);
  const cancelled = client.plan(emptyRecipe());
  client.cancel();
  await assert.rejects(cancelled, { name: 'AbortError' });
  client.dispose();
});

test('workshop planner disposal cancels pending work and prevents future plans', async () => {
  for (const worker of [null, fakeWorker()]) {
    const client = new ProceduralWorkshopPlannerClient(worker ? { workerFactory: () => worker } : {});
    const pending = client.plan(emptyRecipe());
    client.dispose();
    client.dispose();
    await assert.rejects(pending, /disposed/);
    await assert.rejects(client.plan(emptyRecipe()), /disposed/);
    assert.equal(client.pending.size, 0);
  }
});

test('workshop planner falls back when worker creation fails', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const client = new ProceduralWorkshopPlannerClient({
    workerFactory() { throw new Error('worker creation denied'); },
  });
  assert.ok(await client.plan(emptyRecipe()));
  client.dispose();
});
