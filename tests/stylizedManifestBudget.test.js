import assert from 'node:assert/strict';
import test from 'node:test';
import { StylizedBuildQueue } from '../src/editor/stylized/StylizedBuildQueue.js';
import { StylizedGrassSlot } from '../src/editor/stylized/StylizedGrassSlot.js';
import { StylizedRockView } from '../src/editor/stylized/StylizedRockView.js';
import {
  shouldScheduleTreeLodRebuild,
  StylizedTreeView,
} from '../src/editor/stylized/StylizedTreeView.js';
import { TreeManifestStore } from '../src/editor/stylized/TreeManifestStore.js';

test('rock blocker preparation advances at most one bounded manifest slice per frame', () => {
  const manifests = new Map();
  const view = Object.create(StylizedRockView.prototype);
  view.blockerRequests = new Set();
  view.pendingManifestBuilds = new Map();
  view.manifestBuildsThisFrame = 0;
  view.manifestBuildBudgetMs = 100;
  view.manifestFrameStartedAt = performance.now();
  view.manifestKey = (chunkX, chunkZ) => `key:${chunkX}:${chunkZ}`;
  view.cachedManifestForChunk = (chunkX, chunkZ) => (
    manifests.get(`${chunkX}:${chunkZ}`) ?? null
  );
  view.storeManifest = (cacheKey, key, scattered) => {
    manifests.set(cacheKey, scattered);
    return scattered;
  };

  const startFrame = () => {
    view.manifestBuildsThisFrame = 0;
    view.manifestFrameStartedAt = performance.now();
  };

  // Cold manifest whose builder yields two bounded slices before completing.
  const slices = [];
  const placements = [{ chunkX: 3, chunkZ: 6 }];
  const builder = {
    done: false,
    step({ shouldYield } = {}) {
      slices.push(typeof shouldYield === 'function');
      return slices.length < 3 ? null : placements;
    },
  };
  view.pendingManifestBuilds.set('3:6', { key: 'key:3:6', cacheKey: '3:6', builder });

  // Every frame drives exactly one slice of the same cold build and reports
  // "not ready" until that build completes.
  for (let frame = 0; frame < 2; frame += 1) {
    startFrame();
    assert.equal(view.prepareManifestForChunk(3, 6), null);
    assert.equal(slices.length, frame + 1);
    assert.equal(manifests.size, 0);
    assert.strictEqual(view.pendingManifestBuilds.get('3:6').builder, builder);
  }

  startFrame();
  assert.deepEqual(view.prepareManifestForChunk(3, 6), placements);
  assert.equal(slices.length, 3);
  assert.deepEqual(manifests.get('3:6'), placements);
  assert.equal(view.pendingManifestBuilds.size, 0);

  // A prepared manifest is served from cache without resuming the builder.
  startFrame();
  assert.deepEqual(view.prepareManifestForChunk(3, 6), placements);
  assert.equal(slices.length, 3);

  // The per-frame build budget refuses a second cold manifest in the same frame.
  startFrame();
  view.manifestBuildsThisFrame = 1;
  assert.equal(view.prepareManifestForChunk(3, 7), null);
  assert.equal(slices.length, 3);

  // ...and the elapsed-time budget refuses a cold manifest in a spent frame.
  startFrame();
  view.manifestFrameStartedAt = performance.now() - view.manifestBuildBudgetMs - 1;
  assert.equal(view.prepareManifestForChunk(3, 7), null);
  assert.equal(slices.length, 3);

  assert.deepEqual(slices, [true, true, true]);

  // Halo callers keep the one-cold-manifest-per-frame bound: the new builder is
  // driven incrementally and the halo is only complete once all nine neighbouring
  // manifests have been prepared.
  const haloManifests = new Map();
  const live = Object.create(StylizedRockView.prototype);
  live.blockerRequests = new Set();
  live.pendingManifestBuilds = new Map();
  live.manifestBuildsThisFrame = 0;
  live.manifestBuildBudgetMs = 100;
  live.manifestFrameStartedAt = performance.now();
  live.manifestKey = (chunkX, chunkZ) => `key:${chunkX}:${chunkZ}`;
  live.cachedManifestForChunk = (chunkX, chunkZ) => (
    haloManifests.get(`${chunkX}:${chunkZ}`) ?? null
  );
  live.storeManifest = (cacheKey, key, scattered) => {
    haloManifests.set(cacheKey, scattered);
    return scattered;
  };
  // Cheap deterministic options: one accepted rock per chunk, no spacing
  // conflicts, so each prepared manifest holds exactly one placement.
  live.manifestOptions = (chunkX, chunkZ) => ({
    kind: 'manifest-budget-test',
    chunkX,
    chunkZ,
    chunkSize: 1,
    tileSize: 1,
    perChunk: 1,
    tileIds: new Set([1]),
    tileAt: () => 1,
    heightAt: () => 0,
    prototypeCount: 1,
    prototypeIndexForRoll: () => 0,
    minScale: 1,
    maxScale: 1,
    radiusForScale: () => 0,
    candidateEvaluator: null,
  });

  for (let frame = 0; frame < 8; frame += 1) {
    live.manifestBuildsThisFrame = 0;
    live.manifestFrameStartedAt = performance.now();
    assert.equal(live.getPreparedBlockersForChunk(4, 7, 1), null);
    assert.equal(haloManifests.size, frame + 1);
  }

  live.manifestBuildsThisFrame = 0;
  live.manifestFrameStartedAt = performance.now();
  const blockers = live.getPreparedBlockersForChunk(4, 7, 1);
  assert.equal(haloManifests.size, 9);
  assert.equal(blockers.length, 9);
  assert.equal(live.blockerRequests.size, 9);
});

test('tree manifest jobs remain queued while their blocker halo is preparing', () => {
  const store = Object.create(TreeManifestStore.prototype);
  store.queue = new StylizedBuildQueue({ buildsPerFrame: 1, budgetMs: 100 });
  store.pendingKeys = new Set(['2:3']);
  store.activeKeys = new Set(['2:3']);
  let attempts = 0;
  let notifications = 0;
  store.build = () => {
    attempts += 1;
    return attempts === 1 ? null : [];
  };
  store.onBuilt = () => {
    notifications += 1;
  };
  store.queue.enqueue({
    key: '2:3',
    chunkX: 2,
    chunkZ: 3,
    rockSource: {},
    priority: 0,
  });

  assert.deepEqual(store.flush(), { built: 1, remaining: 1 });
  assert.equal(store.pendingKeys.has('2:3'), true);
  assert.equal(notifications, 0);

  assert.deepEqual(store.flush(), { built: 1, remaining: 0 });
  assert.equal(store.pendingKeys.has('2:3'), false);
  assert.equal(notifications, 1);
});

test('prewarmed grass slots pin their reusable resources', () => {
  const slot = Object.create(StylizedGrassSlot.prototype);
  slot.resourcesPinned = false;
  let allocations = 0;
  slot.ensureResources = () => {
    allocations += 1;
  };

  slot.pinResources();

  assert.equal(allocations, 1);
  assert.equal(slot.resourcesPinned, true);
});

test('tree LOD rebuilds batch manifest arrivals while preserving final updates', () => {
  const common = {
    planChanged: true,
    manifestsBuilt: true,
    queueRemaining: 20,
    lastRebuildAt: 100,
    minimumIntervalMs: 33,
  };
  assert.equal(shouldScheduleTreeLodRebuild({ ...common, timestamp: 120 }), false);
  assert.equal(shouldScheduleTreeLodRebuild({ ...common, timestamp: 133 }), true);
  assert.equal(shouldScheduleTreeLodRebuild({
    ...common,
    timestamp: 101,
    queueRemaining: 0,
  }), true);
  assert.equal(shouldScheduleTreeLodRebuild({
    ...common,
    timestamp: 101,
    manifestsBuilt: false,
    queueRemaining: 0,
  }), false);
  assert.equal(shouldScheduleTreeLodRebuild({
    ...common,
    timestamp: 200,
    planChanged: false,
    manifestsBuilt: false,
  }), false);
  assert.equal(typeof StylizedTreeView, 'function');
});
