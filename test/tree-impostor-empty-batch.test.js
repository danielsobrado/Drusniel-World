import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { CpuTreeImpostorBatch } from '../src/editor/stylized/impostor/CpuTreeImpostorBatch.js';
import { GpuTreeImpostorBatch } from '../src/editor/stylized/impostor/GpuTreeImpostorBatch.js';

function createFixture(Batch) {
  const scene = new THREE.Scene();
  const atlas = {
    width: 4, height: 8, columns: 8, rows: 2, tileSize: 128,
    lowElevationDegrees: 12, highElevationDegrees: 58,
    albedo: new THREE.Texture(), normal: new THREE.Texture(),
  };
  const computes = [];
  const batch = new Batch({
    scene, atlas, capacity: 4, name: 'test tree impostors',
    renderer: { backend: { isWebGPUBackend: true }, compute: (...args) => computes.push(args) },
  });
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.updateMatrixWorld();
  return { batch, scene, camera, atlas, computes };
}

function isTraversed(scene, mesh) {
  const visible = [];
  scene.traverseVisible((object) => visible.push(object));
  return visible.includes(mesh);
}

const record = { x: 0, y: 0, z: -10, scale: 1, yaw: 0, fade: 1, seed: 0.3, radius: 1 };

test('empty GPU impostor batches leave render traversal and can become populated again', () => {
  const { batch, scene, camera, atlas, computes } = createFixture(GpuTreeImpostorBatch);
  try {
    batch.setRecords([record]);
    batch.update(camera, { x: 0, z: 0 });
    assert.ok(isTraversed(scene, batch.mesh));
    assert.equal(computes.length, 2);

    batch.setRecords([]);
    batch.update(camera, { x: 0, z: 0 });
    assert.equal(isTraversed(scene, batch.mesh), false);
    assert.equal(computes.length, 3, 'the previous indirect instance count still resets');
    batch.update(camera, { x: 0, z: 0 });
    assert.equal(computes.length, 3, 'an empty batch does not keep dispatching');

    batch.setRecords([record]);
    batch.update(camera, { x: 0, z: 0 });
    assert.ok(isTraversed(scene, batch.mesh));
    assert.equal(computes.length, 5);
  } finally {
    batch.dispose();
    atlas.albedo.dispose();
    atlas.normal.dispose();
  }
});

test('CPU impostor batches leave render traversal when empty or entirely culled', () => {
  const { batch, scene, camera, atlas } = createFixture(CpuTreeImpostorBatch);
  try {
    batch.setRecords([record]);
    assert.equal(batch.update(camera, { x: 0, z: 0 }), 1);
    assert.ok(isTraversed(scene, batch.mesh));

    batch.setRecords([]);
    assert.equal(batch.update(camera, { x: 0, z: 0 }), 0);
    assert.equal(isTraversed(scene, batch.mesh), false);

    batch.setRecords([{ ...record, x: 1000 }]);
    assert.equal(batch.update(camera, { x: 0, z: 0 }), 0);
    assert.equal(isTraversed(scene, batch.mesh), false);

    batch.setRecords([record]);
    assert.equal(batch.update(camera, { x: 0, z: 0 }), 1);
    assert.ok(isTraversed(scene, batch.mesh));
  } finally {
    batch.dispose();
    atlas.albedo.dispose();
    atlas.normal.dispose();
  }
});
