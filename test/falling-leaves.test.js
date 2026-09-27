import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';

import {
  FallingLeaves,
  createLeafGeometry,
  sheddingCanopyShare,
} from '../src/editor/stylized/leaves/FallingLeaves.js';

test('each leaf is a seeded quad whose seeds switch on in order', () => {
  const geometry = createLeafGeometry(50, () => 0.5);
  assert.equal(geometry.index.count, 50 * 6);
  const seeds = geometry.attributes.leafSeed;
  assert.equal(seeds.count, 200);
  // All four corners of a leaf share its seed.
  for (let vertex = 1; vertex < 4; vertex += 1) assert.equal(seeds.getW(vertex), seeds.getW(0));
  const order = Array.from({ length: 50 }, (_, leaf) => seeds.getW(leaf * 4));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'amount reveals leaves in a fixed order');
});

test('only shedding canopy drops leaves, and never around an orbit camera', () => {
  assert.equal(sheddingCanopyShare([6, 6, 8, 4], [6, 8]), 0.75);
  assert.equal(sheddingCanopyShare([], [6, 8]), 0);

  const scene = new THREE.Scene();
  let tile = 6;
  const leaves = new FallingLeaves({
    scene,
    getTile: () => tile,
    getTileSize: () => 2,
    getOrigin: () => ({ x: 0, z: 0 }),
  });
  const camera = new THREE.PerspectiveCamera();
  for (let frame = 0; frame < 120; frame += 1) leaves.update(frame / 30, 1 / 30, camera, { x: 1, z: 0 });
  assert.ok(leaves.uniforms.amount.value > 0.8);
  assert.equal(leaves.mesh.visible, true);

  for (let frame = 0; frame < 300; frame += 1) leaves.update(4 + frame / 30, 1 / 30, camera, { x: 1, z: 0 }, false);
  assert.equal(leaves.mesh.visible, false, 'orbiting hides them');

  tile = 4;
  for (let frame = 0; frame < 300; frame += 1) leaves.update(14 + frame / 30, 1 / 30, camera, { x: 1, z: 0 });
  assert.equal(leaves.mesh.visible, false, 'grassland sheds nothing');
  leaves.dispose();
  assert.equal(scene.children.length, 0);
});
