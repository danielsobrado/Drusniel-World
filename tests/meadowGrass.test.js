import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';

import { createCompaction } from '../src/editor/stylized/meadow/meadowGrassCompaction.js';
import { MEADOW_GRASS_DEFAULTS, resolveMeadowGrassConfig } from '../src/editor/stylized/meadow/meadowGrassConfig.js';
import { createMeadowTemplate, createStableInstances } from '../src/editor/stylized/meadow/meadowGrassGeometry.js';
import {
  LOD_ORDER, bandStemCount, grassTrianglesPerBlade, lodBandVectors, lodThresholds, selectLod, tileDistanceSquared, validateLodBands,
} from '../src/editor/stylized/meadow/meadowGrassLayout.js';
import { EMPTY_POSITION, MeadowGrassBatches } from '../src/editor/stylized/meadow/MeadowGrassBatches.js';
import { MeadowGroundSampler } from '../src/editor/stylized/meadow/MeadowGroundSampler.js';
import { MeadowInteractionMap } from '../src/editor/stylized/meadow/MeadowInteractionMap.js';
import { meadowShapeId, resolveShapeTable } from '../src/editor/stylized/meadow/meadowGrassShapes.js';

const SETTINGS = resolveMeadowGrassConfig({ ...MEADOW_GRASS_DEFAULTS });

test('bands are picked by the nearest point of a tile and end at maxDistance', () => {
  const thresholds = lodThresholds(50, SETTINGS.lod);
  assert.equal(selectLod(0, thresholds), 'high');
  assert.equal(selectLod(10 ** 2, thresholds), 'medium');
  assert.equal(selectLod(20 ** 2, thresholds), 'low');
  assert.equal(selectLod(49 ** 2, thresholds), 'veryLow');
  assert.equal(selectLod(51 ** 2, thresholds), null, 'past the last band nothing is drawn');
  assert.equal(tileDistanceSquared(0, 0, 3, 0, 8), 0, 'inside the tile');
  assert.equal(tileDistanceSquared(0, 0, 14, 0, 8), 100);
  assert.equal(grassTrianglesPerBlade(5), 9);
});

test('band vectors retire each band\'s extra stems toward the next band\'s count', () => {
  const vectors = lodBandVectors(SETTINGS);
  assert.equal(vectors.length, 4);
  const counts = LOD_ORDER.map((band) => bandStemCount(8, SETTINGS.lod[band].density));
  vectors.forEach(([end, count, next], index) => {
    assert.equal(count, counts[index]);
    assert.equal(next, counts[index + 1] ?? 0);
    assert.ok(end > (vectors[index - 1]?.[0] ?? 0));
  });
  assert.throws(() => validateLodBands({ ...SETTINGS.lod, low: { detail: 6, density: 1, distance: 0.6 } }, 'x'), /detail/);
  assert.throws(() => validateLodBands({ ...SETTINGS.lod, veryLow: { detail: 1, density: 1, distance: 0.9 } }, 'x'), /must be 1/);
});

test('every prefix of the stable stem sequence covers the whole tile', () => {
  const tileSize = 8;
  const { position, count } = createStableInstances({ count: 400, tileSize });
  for (const prefix of [16, 64, 400]) {
    const quadrants = new Set();
    for (let index = 0; index < prefix; index += 1) {
      const x = position[index * 4];
      const z = position[index * 4 + 2];
      assert.ok(Math.abs(x) <= tileSize / 2 && Math.abs(z) <= tileSize / 2);
      quadrants.add(`${Math.floor((x / tileSize + 0.5) * 4)}:${Math.floor((z / tileSize + 0.5) * 4)}`);
    }
    assert.ok(quadrants.size >= Math.min(16, prefix) * 0.8, `prefix ${prefix} spreads over the tile (${quadrants.size}/16)`);
  }
  assert.equal(count, 400);
  const template = createMeadowTemplate({ detail: 3, count: 100, tileSize });
  assert.equal(template.instanceCount, 100);
  assert.equal(template.userData.meadow.triangles, 5);
  assert.equal(Object.keys(template.attributes).length, 6, 'seven vertex buffers once the batch adds instanceTile');
});

test('compaction keeps only stems on grass, with their ground, rank and shape', () => {
  const template = createMeadowTemplate({ detail: 2, count: 256, tileSize: 8 });
  const sample = (x, z, rank, out) => {
    if (x < 100) return false;
    out.height = 12.5;
    out.strength = 0.75;
    out.shape = 1;
    out.path = 0.25;
    return true;
  };
  const compaction = createCompaction({ template, centerX: 100, centerZ: 0, sample });
  assert.equal(compaction.advance(100), true, 'resumable');
  assert.equal(compaction.done, false);
  compaction.advance(Infinity);
  assert.equal(compaction.done, true);
  const { output } = compaction;
  assert.ok(output.count > 80 && output.count < 176, `about half the tile survives (${output.count})`);
  for (let index = 0; index < output.count; index += 1) {
    assert.ok(output.position[index * 4] >= 0);
    assert.equal(output.position[index * 4 + 1], 12.5);
    assert.equal(output.position[index * 4 + 3], 0.75);
    assert.equal(Math.floor(output.data[index * 4]), 1);
    assert.ok(Math.abs(output.data[index * 4] % 1 - 0.25) < 1e-6);
  }
  const ranks = Array.from({ length: output.count }, (_, index) => output.data[index * 4 + 1]);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), 'survivors keep their stable order');
});

test('a batch gives each tile its own slot and clears it when the tile leaves', () => {
  const scene = new THREE.Scene();
  const template = createMeadowTemplate({ detail: 2, count: 8, tileSize: 8 });
  const batches = new MeadowGrassBatches({ scene, templates: { high: template }, material: new THREE.MeshBasicNodeMaterial(), name: 't' });
  const tile = (id, count, x) => ({
    buildId: id, renderX: x, renderZ: 0,
    output: { count, position: new Float32Array(32).fill(1), rotation: new Float32Array(16), data: new Float32Array(32) },
  });
  const a = tile(1, 5, 0);
  const b = tile(2, 8, 8);
  batches.begin();
  batches.add('high', a);
  batches.add('high', b);
  assert.deepEqual(batches.commit(), { high: 13 });
  const geometry = batches.batches.get('high').geometry;
  assert.equal(geometry.instanceCount, 16);
  const position = geometry.getAttribute('instancePosition').array;
  assert.equal(position[5 * 4], EMPTY_POSITION, 'unused stems in a slot are parked out of range');
  assert.equal(geometry.getAttribute('instanceTile').array[8 * 2], 8, 'each stem carries its tile origin');
  batches.begin();
  batches.add('high', a);
  batches.commit();
  assert.equal(geometry.instanceCount, 8, 'a trailing free slot stops being drawn');
  batches.dispose();
  assert.equal(scene.children.length, 0);
});

test('the ground sampler reads height, grass, water and shape from the resident page', () => {
  const chunkSize = 4;
  const tiles = new Uint8Array(16).fill(4);
  tiles[5] = 12;
  tiles[15] = 13;
  const mask = new Uint8Array(16 * 4);
  for (let cell = 0; cell < 16; cell += 1) mask[cell * 4 + 1] = 255;
  mask[3 * 4 + 1] = 0;
  const heights = new Float32Array(25).map((_, index) => index);
  const slot = {
    descriptor: { key: '0:0', chunkX: 0, chunkZ: 0, originCellX: 0, originCellZ: 0, centerWorldX: 4, centerWorldZ: -4 },
    page: { tiles, heights, surfaceMaskPixels: mask },
    pageRevision: 3,
    loading: false,
  };
  const terrainView = { slots: [slot], worldStore: { chunkSize, tileSize: 2 } };
  const sampler = new MeadowGroundSampler({
    terrainView, tileIds: [4, 12], shapeTable: resolveShapeTable({ 12: 'reed' }),
  });
  sampler.beginFrame();
  assert.equal(sampler.revisionAt(3, -3), '0:0:3:', 'page revision, no rocks');
  assert.equal(sampler.revisionAt(20, -3), null, 'no page, no build');
  const ground = sampler.forTile(4, -4);
  assert.equal(ground.revision, sampler.revisionAt(4, -4), 'a job and its tile agree on the revision, or it never finishes');
  const out = {};
  assert.equal(ground.sample(1, -1, 0, out), true);
  assert.ok(Math.abs(out.height - 3) < 1e-9, 'bilinear over the vertex grid');
  assert.equal(out.shape, meadowShapeId('slender'));
  assert.equal(ground.sample(3, -3, 0, out), true);
  assert.equal(out.shape, meadowShapeId('reed'), 'wetland wears reeds');
  assert.equal(ground.sample(7, -7, 0, out), false, 'a road is not grass');
  assert.equal(ground.sample(7.9, -0.1, 0, out), false, 'the surface mask says no grass there');

  // A rock at (2, -2): nothing grows under it, the stand is pressed flat around it.
  const rocky = new MeadowGroundSampler({
    terrainView, tileIds: [4, 12], shapeTable: resolveShapeTable({}),
    rockPlacementsProvider: () => [{ x: 2, z: -2, radius: 0.5 }],
    rocks: { radius: 0.5, falloff: 1, flatten: 0.8 },
  });
  rocky.beginFrame();
  assert.notEqual(rocky.revisionAt(3, -3), '0:0:3:', 'the rocks join the revision');
  const rockGround = rocky.forTile(4, -4, 4);
  assert.equal(rockGround.revision, rocky.revisionAt(4, -4), 'rocks included on both sides');
  assert.equal(rockGround.sample(2.2, -2, 0, out), false, 'under the rock');
  assert.equal(rockGround.sample(2.8, -2, 0, out), true);
  assert.ok(out.strength < 0.9, `pressed flatter beside it (${out.strength})`);
  assert.equal(rockGround.sample(1, -1, 0, out), true);
});

test('the shipped defaults resolve, and bad names fail at load', () => {
  assert.equal(resolveMeadowGrassConfig({ enabled: false }), null);
  assert.equal(SETTINGS.maxDistance, 50);
  assert.throws(() => resolveMeadowGrassConfig({ shapes: { byTileId: { 12: 'fern' } } }), /unknown shape/);
});

test('the interaction window resolves, and can be switched off', () => {
  assert.deepEqual(SETTINGS.interaction, {
    enabled: true, resolution: 256, worldSize: 27, recoverySpeed: 0.94, strength: 1, bodyRadius: 0.26,
  });
  assert.equal(resolveMeadowGrassConfig({ interaction: { enabled: false } }).interaction, null);
  assert.equal(resolveMeadowGrassConfig({ interaction: { worldSize: 40 } }).interaction.worldSize, 40);
  assert.throws(() => resolveMeadowGrassConfig({ interaction: { bodyRadius: 0 } }), /interaction\.bodyRadius/);
  assert.throws(() => resolveMeadowGrassConfig({ interaction: { resolution: 8 } }), /interaction\.resolution/);
});

test('the body stamp is anchored to the world, so a floating-origin rebase scrolls nothing', () => {
  const map = new MeadowInteractionMap({
    resolution: 32, worldSize: 8, recoverySpeed: 1, strength: 1, bodyRadius: 1, getHeight: () => 0,
  });
  map.update({ x: 0, y: 0, z: 0 });
  assert.ok(map.peak > 0, 'the body leaves a stamp');
  const stamped = Uint8Array.from(map.pixels);
  const ink = { ...map.ink };

  // The origin moved 2 m: the same world point is now 2 m lower in render space, so
  // the window re-bases and the player's own position moved with it — not a walk.
  map.shiftOrigin(2, 0);
  assert.equal(map.center.x, -2, 'the window re-bases with the origin');
  assert.deepEqual(map.pixels, stamped, 'the ink stays exactly where it was in the world');
  assert.deepEqual(map.ink, ink);

  map.update({ x: -2, y: 0, z: 0 });
  assert.deepEqual(map.ink, ink, 'the re-based frame is not a movement: no scroll');
  assert.equal(map.hasInk(), true);
  map.dispose();
});

test('the print fades once the body stops, and a recovered map uploads nothing', () => {
  const map = new MeadowInteractionMap({
    resolution: 32, worldSize: 8, recoverySpeed: 0.5, strength: 1, bodyRadius: 1, getHeight: () => 0,
  });
  map.update({ x: 0, y: 0, z: 0 });
  const peak = map.peak;
  assert.ok(peak > 0);
  for (let frame = 0; frame < 12; frame += 1) map.update(null);
  assert.equal(map.peak, 0, 'the stand rises again');
  assert.equal(map.hasInk(), false);
  const version = map.texture.version;
  map.update(null);
  assert.equal(map.texture.version, version, 'nothing is uploaded once the trail is gone');
  map.dispose();
});
