import assert from 'node:assert/strict';
import test from 'node:test';
import { createCameraChunkDistance } from '../src/editor/stylized/lod/chunkLodDistance.js';
import { buildChunkLodPlan } from '../src/editor/stylized/lod/StylizedLodRuntime.js';

function planAt({ x, z, origin = { x: 0, z: 0 }, distanceFromCamera = true }) {
  const camera = { position: { x, y: 10, z }, fov: 68 };
  return buildChunkLodPlan({
    focus: { chunkX: 0, chunkZ: 0 }, radius: 6, chunkWorldSize: 128,
    camera, floatingOrigin: { getState: () => origin },
    viewportHeight: 720, objectHeight: 16,
    thresholds: { nearPixels: 32, proxyPixels: 8, impostorPixels: 2, clusterPixels: 0 },
    radii: {
      meshRadius: 1, proxyRadius: 1, impostorRadius: 5, clusterRadius: 5,
      forceNearWithinMeshRadius: true,
    },
    transitionStates: new Map(), timestamp: 0, transitionMs: 320,
    distanceForChunk: distanceFromCamera ? createCameraChunkDistance(camera, origin, 128) : null,
  });
}

function band(plan, x, z) {
  return plan.entries.find((entry) => entry.chunkX === x && entry.chunkZ === z).band;
}

test('trees beside an offset editor camera keep full geometry outside the editing focus ring', () => {
  const plan = planAt({ x: 150, z: 150 });
  assert.equal(band(plan, 1, -2), 'near');
  assert.equal(band(plan, 0, -2), 'near');
  assert.equal(band(plan, -2, 2), 'impostor');
});

test('close chunk edges retain detail while the streaming focus catches up', () => {
  const plan = planAt({ x: 129, z: -64 });
  assert.equal(band(plan, 2, 0), 'near');
  assert.equal(band(plan, -2, 0), 'impostor');
});

test('camera chunk distance is invariant under floating-origin rebasing', () => {
  const original = planAt({ x: 150, z: 150 });
  const rebased = planAt({ x: 150 - 4096, z: 150 + 4096, origin: { x: 4096, z: -4096 } });
  assert.deepEqual(rebased.entries.map((entry) => entry.band), original.entries.map((entry) => entry.band));
});

test('camera-based near windows fit the existing radius-plus-one buffer allocation', () => {
  for (const x of [-128, -1, 0, 127, 128, 150]) {
    for (const z of [-128, -1, 0, 127, 128, 150]) {
      const plan = planAt({ x, z });
      assert.ok(plan.entries.filter((entry) => entry.band === 'near').length <= 25);
    }
  }
});

test('other layers keep the existing focus-based radius policy by default', () => {
  const plan = planAt({ x: 150, z: 150, distanceFromCamera: false });
  assert.equal(band(plan, 1, -2), 'impostor');
  assert.equal(band(plan, 0, 0), 'near');
});
