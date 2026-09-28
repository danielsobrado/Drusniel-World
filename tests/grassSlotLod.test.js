import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import {
  createClumpGeometry,
  StylizedGrassSlot,
} from '../src/editor/stylized/StylizedGrassSlot.js';
import { enrichPageVegetationScatter } from '../src/editor/stylized/vegetationScatter.js';

const CHUNK_SIZE = 4;
const TILE_SIZE = 2;
const CHUNK_WORLD_SIZE = CHUNK_SIZE * TILE_SIZE;
const CLUMPS_PER_CELL = 2;

const CONFIG = {
  grass: {
    residentRadius: 1,
    nearRadius: 0,
    outerRingDensity: 0.45,
    bladesPerCell: 16,
    bladesPerClump: 8,
    tileIds: [3, 4, 12],
    minWidth: 0.014,
    maxWidth: 0.032,
    minLength: 0.1,
    maxLength: 0.32,
    lod: { coverage: { enabled: true, outerFadeMeters: 64, presenceWindow: 0.06 } },
  },
  streaming: { grassScatterGroupsPerSlice: 2, inactiveReleaseFrames: 30 },
  trees: { forestFloor: {} },
};

function makePage({ tiles } = {}) {
  return {
    chunkX: 2,
    chunkZ: 3,
    tiles: tiles ?? new Uint8Array(CHUNK_SIZE * CHUNK_SIZE).fill(3),
    heights: new Float32Array((CHUNK_SIZE + 1) ** 2),
    grassScatter: null,
  };
}

/**
 * A slot with the resource-building path stubbed out, so the test drives the parts
 * that decide geometry, coverage and scheduling without a GPU.
 */
function makeSlot({ page = makePage(), centerWorldX = 100, centerWorldZ = -50 } = {}) {
  const slot = Object.create(StylizedGrassSlot.prototype);
  Object.assign(slot, {
    config: CONFIG,
    chunkSize: CHUNK_SIZE,
    tileSize: TILE_SIZE,
    chunkWorldSize: CHUNK_WORLD_SIZE,
    clumpsPerCell: CLUMPS_PER_CELL,
    bladesPerClump: 8,
    maxInstances: CHUNK_SIZE * CHUNK_SIZE * CLUMPS_PER_CELL,
    nearRadius: 0,
    time: uniform(0),
    chunkCenter: uniform(new THREE.Vector2()),
    lodCoverage: uniform(new THREE.Vector4(0, 1, 1, 1)),
    coverageSettings: CONFIG.grass.lod.coverage,
    coverageEnabled: true,
    bandDensity: 1,
    ringDistance: 0,
    band: 'near',
    builtProfileRevision: -1,
    builtProfileSetId: null,
    dominantPage: null,
    dominantRevision: -1,
    dominantSetId: null,
    readyKey: null,
    readyRevision: -1,
    readyClumpsPerCell: 0,
    pendingRebuild: null,
    buildState: null,
    inactiveFrames: 0,
    resourcesPinned: false,
    bladeProfileProvider: () => null,
    forestFieldProvider: () => null,
    trampleTexture: null,
    mesh: { visible: false, position: { copy() {} } },
  });
  slot.instanceBase = new THREE.InstancedBufferAttribute(
    new Float32Array(slot.maxInstances * 3),
    3,
  );
  slot.instanceParams = new THREE.InstancedBufferAttribute(
    new Float32Array(slot.maxInstances * 4),
    4,
  );
  slot.geometry = createClumpGeometry({
    bladesPerClump: slot.bladesPerClump,
    segments: 3,
    instanceBase: slot.instanceBase,
    instanceParams: slot.instanceParams,
  });
  slot.ensureResources = () => {};
  slot.setBand = () => {};
  slot.updateTrampleTexture = () => {};
  slot.terrainSlot = {
    slotIndex: 0,
    descriptor: { key: '2:3', chunkX: 2, chunkZ: 3, centerWorldX, centerWorldZ },
    mesh: { visible: true, position: { copy() {} } },
    page,
    pageRevision: 1,
  };
  return slot;
}

function closeTo(actual, expected, message) {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `${message}: ${actual} is not ${expected}`,
  );
}

test('coverage comes from the chunk box, not its centre', () => {
  const slot = makeSlot();
  const focus = { x: 100, z: -50 };
  slot.updateCoverage(slot.terrainSlot.descriptor, focus);
  const [inner, outer, coverageInner, coverageOuter] = slot.lodCoverage.value.toArray();
  // The camera sits on the chunk's centre, so the nearest point of the box is the
  // camera itself and the farthest is a diagonal corner.
  assert.equal(inner, 0);
  assert.ok(Math.abs(outer - Math.hypot(4, 4)) < 1e-9, `outer ${outer}`);
  // Ring 0 is compacted at full density, so nothing is retired right here...
  assert.equal(coverageInner, 1);
  // ...and the corner is a third of the way down the falloff to the outer ring,
  // which is exactly the gradient the per-ring compaction cannot express.
  const expected = 1 + (0.45 - 1) * (outer / CHUNK_WORLD_SIZE);
  assert.ok(Math.abs(coverageOuter - expected) < 1e-9, `coverage ${coverageOuter}`);
  // A single number for the whole chunk would have been `coverageInner`, and the
  // falloff would have stayed a step.
  assert.ok(coverageOuter < coverageInner);
});

test('a chunk measures its distance from the camera, and adopts the ring it is on', () => {
  const slot = makeSlot({ centerWorldX: 1e6, centerWorldZ: -2e6 });
  // A camera a long way from the world origin: the distances are differences, so
  // how far the pair sits from zero cannot change the answer.
  slot.updateCoverage(slot.terrainSlot.descriptor, { x: 1e6, z: -2e6 });
  assert.equal(slot.lodCoverage.value.x, 0);
  assert.ok(Math.abs(slot.lodCoverage.value.y - Math.hypot(4, 4)) < 1e-9);
  assert.equal(slot.bandDensity, 1);

  // On the outer ring the same chunk is compacted to 45%, so the law and the
  // compaction already agree and there is nothing to retire.
  slot.ringDistance = 1;
  slot.updateCoverage(slot.terrainSlot.descriptor, { x: 1e6, z: -2e6 });
  closeTo(slot.bandDensity, 0.45, 'the outer ring compacts to the far density');
  assert.equal(slot.lodCoverage.value.z, 1);
  assert.equal(slot.lodCoverage.value.w, 1);
});

test('coverage without a camera, or switched off, leaves the field alone', () => {
  const slot = makeSlot();
  slot.updateCoverage(slot.terrainSlot.descriptor, null);
  assert.deepEqual(slot.lodCoverage.value.toArray(), [0, 1, 1, 1]);

  slot.coverageEnabled = false;
  slot.ringDistance = 1;
  slot.updateCoverage(slot.terrainSlot.descriptor, { x: 100, z: -50 });
  assert.deepEqual(slot.lodCoverage.value.toArray(), [0, 1, 1, 1]);
  // The ring still decides the population, so disabling coverage must not stop the
  // density target following the distance.
  closeTo(slot.bandDensity, 0.45, 'the ring still sets the compaction target');
});

test('a chunk leaves residency mid-build and forgets the half-written population', () => {
  // A build writes a slice per frame straight into the live instance buffers. If a
  // chunk left residency in the middle of one, the buffers hold two populations
  // mixed; leaving `readyKey` naming the old build would let the mesh be drawn with
  // it as soon as the chunk came back, without its page having changed.
  const slot = makeSlot();
  slot.readyKey = '2:3';
  slot.pendingRebuild = { key: 'grass:0', signature: 'x' };
  slot.buildState = { signature: 'x' };
  slot.terrainSlot.mesh.visible = false;

  slot.update(0, { chunkX: 2, chunkZ: 3 }, '', [], { x: 100, z: -50 });
  assert.equal(slot.readyKey, null);
  assert.equal(slot.pendingRebuild, null);
  assert.equal(slot.buildState, null);

  // A chunk that was only inactive with nothing in flight keeps its population, so
  // walking back and forth over a boundary does not rebuild the world.
  const settled = makeSlot();
  settled.readyKey = '2:3';
  settled.terrainSlot.mesh.visible = false;
  settled.update(0, { chunkX: 2, chunkZ: 3 }, '', [], { x: 100, z: -50 });
  assert.equal(settled.readyKey, '2:3');
});

test('the scatter build is sliced across frames and lands the same population', () => {
  const tiles = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE).fill(3);
  const page = makePage({ tiles });
  page.grassScatter = {
    base: new Float32Array(CHUNK_SIZE * CHUNK_SIZE * 4 * 3),
    parameters: new Float32Array(CHUNK_SIZE * CHUNK_SIZE * 4 * 4),
    count: CHUNK_SIZE * CHUNK_SIZE * 4,
    clumpsPerCell: 4,
    minimumHeight: 0,
    maximumHeight: 0,
  };
  for (let index = 0; index < page.grassScatter.count; index += 1) {
    page.grassScatter.base[index * 3 + 1] = 5 + index * 0.01;
    page.grassScatter.base[index * 3] = index * 0.5;
    page.grassScatter.base[index * 3 + 2] = -index * 0.25;
    page.grassScatter.parameters[index * 4 + 3] = 0.5;
  }

  const whole = makeSlot({ page });
  whole.pendingRebuild = {
    key: 'grass:0', page, descriptor: whole.terrainSlot.descriptor,
    revision: 1, clumpsPerCell: 2, signature: 'whole',
  };
  whole.config = { ...CONFIG, streaming: { grassScatterGroupsPerSlice: 10000 } };
  whole.applyPendingRebuild();
  const wholeCount = whole.geometry.instanceCount;

  // 16 cells at two clumps each, capped at two source cells a frame.
  const sliced = makeSlot({ page });
  sliced.pendingRebuild = {
    key: 'grass:0', page, descriptor: sliced.terrainSlot.descriptor,
    revision: 1, clumpsPerCell: 2, signature: 'sliced',
  };
  let frames = 0;
  while (sliced.pendingRebuild && frames < 50) {
    sliced.applyPendingRebuild();
    frames += 1;
  }
  assert.ok(frames > 1, 'the build should not land in one frame');
  assert.equal(sliced.geometry.instanceCount, wholeCount);
  assert.deepEqual(
    Array.from(sliced.instanceBase.array.subarray(0, wholeCount * 3)),
    Array.from(whole.instanceBase.array.subarray(0, wholeCount * 3)),
  );
  // Two clumps of the four the page holds, in each of sixteen cells.
  assert.equal(wholeCount, CHUNK_SIZE * CHUNK_SIZE * 2);
});

test('the silhouette of a chunk comes from the biome most of it stands on', () => {
  const pool = {
    revision: 3,
    setForTile: (tile) => (tile === 12 ? 'familyReed' : 'authored'),
  };
  const slot = makeSlot();
  slot.bladeProfileProvider = () => pool;
  slot.profileSetFor(slot.terrainSlot.page);
  assert.equal(slot.dominantSetId, 'authored');

  // A wetland chunk wears the reed set, and the vote is cached until the page
  // changes because it reads every cell in the chunk.
  const wetland = makeSlot({ page: makePage({ tiles: new Uint8Array(16).fill(12) }) });
  wetland.bladeProfileProvider = () => pool;
  assert.equal(wetland.profileSetFor(wetland.terrainSlot.page), 'familyReed');
  const cached = wetland.dominantSetId;
  assert.equal(wetland.profileSetFor(wetland.terrainSlot.page), cached);
  assert.equal(wetland.dominantPage, wetland.terrainSlot.page);
});

test('the scatter the worker actually ships builds a chunk through the composer', () => {
  // The seam the two halves have to agree on: the worker writes one packed group of
  // `clumpsPerCell` instances per eligible cell and reports that count on the
  // scatter, and the composer strides the source by exactly that. A mismatch here
  // would not throw — it would publish one cell's grass as another's.
  const page = makePage();
  enrichPageVegetationScatter(page, {
    tileSize: TILE_SIZE,
    grass: {
      enabled: true,
      clumpsPerCell: 3,
      tileIds: [3],
      minWidth: 0.014,
      maxWidth: 0.032,
      minLength: 0.1,
      maxLength: 0.32,
    },
    flowers: null,
  });
  const scatter = page.grassScatter;
  assert.equal(scatter.clumpsPerCell, 3);
  assert.equal(scatter.count, CHUNK_SIZE * CHUNK_SIZE * 3);

  const slot = makeSlot({ page });
  slot.pendingRebuild = {
    key: 'grass:0', page, descriptor: slot.terrainSlot.descriptor,
    revision: 1, clumpsPerCell: 2, signature: 'worker',
  };
  while (slot.pendingRebuild) slot.applyPendingRebuild();

  // Two of each cell's three clumps, so the first two instances of each group are
  // the worker's first two, in order.
  assert.equal(slot.geometry.instanceCount, CHUNK_SIZE * CHUNK_SIZE * 2);
  const stride = scatter.clumpsPerCell;
  for (const group of [0, 5, 15]) {
    for (const clump of [0, 1]) {
      const source = group * stride + clump;
      const target = group * 2 + clump;
      for (let component = 0; component < 3; component += 1) {
        closeTo(
          slot.instanceBase.array[target * 3 + component],
          scatter.base[source * 3 + component],
          `group ${group} clump ${clump} base[${component}]`,
        );
      }
      for (let component = 0; component < 4; component += 1) {
        closeTo(
          slot.instanceParams.array[target * 4 + component],
          scatter.parameters[source * 4 + component],
          `group ${group} clump ${clump} params[${component}]`,
        );
      }
    }
  }
});

test('a chunk whose biome wants another blade set builds it once, not every frame', () => {
  // The pool maps this chunk's biome to 'reed' while the default is 'generated'.
  // Building with the set the slot last had would leave `update` seeing a changed
  // shape on every frame, tearing the chunk down before its scatter could finish.
  const slot = makeSlot();
  const pool = {
    revision: 1,
    setForTile: (tile) => (tile === 3 ? 'reed' : 'generated'),
    forSet: (setId = 'generated') => ({ setId, near: [], far: [] }),
  };
  slot.bladeProfileProvider = () => pool;
  slot.builtProfileRevision = 1;
  slot.builtProfileSetId = 'generated';
  const built = [];
  let releases = 0;
  slot.releaseResources = () => { releases += 1; slot.geometry = null; };
  slot.ensureResources = (setId) => {
    if (slot.geometry) return;
    built.push(setId);
    slot.builtProfileSetId = pool.forSet(setId ?? undefined).setId;
    slot.geometry = {};
  };

  for (let frame = 0; frame < 5; frame += 1) {
    slot.update(frame * 16, { chunkX: 2, chunkZ: 3 }, '', [], { x: 100, z: -50 });
  }
  assert.deepEqual(built, ['reed'], 'built once, with the biome\'s own set');
  assert.equal(releases, 1, 'only the switch away from the old set');
});
