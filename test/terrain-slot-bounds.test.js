import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createSlotGeometry, fitSlotBounds } from '../src/editor/world/TerrainSlotBounds.js';

test('slot geometry shares the plane buffers but owns its bounds', () => {
  const plane = new THREE.PlaneGeometry(128, 128, 4, 4);
  plane.computeBoundingSphere();
  const slot = createSlotGeometry(plane);
  assert.equal(slot.getAttribute('position'), plane.getAttribute('position'));
  assert.equal(slot.index, plane.index);
  fitSlotBounds(slot, Float32Array.from([480, 495, 510, 520, 505]), 128);
  // Bounds follow the displaced height along local +Z, not the flat plane.
  assert.ok(slot.boundingBox.min.z <= 480 && slot.boundingBox.max.z >= 520);
  assert.ok(Math.abs(slot.boundingSphere.center.z - 500) < 1e-9);
  assert.equal(plane.boundingSphere.center.z, 0, 'the shared plane keeps its own bounds');
  slot.dispose();
  assert.ok(plane.getAttribute('position').array.length > 0, 'disposing a slot keeps shared buffers');
});

test('a camera high on a ridge still sees the chunk it looks across', () => {
  const plane = new THREE.PlaneGeometry(128, 128, 4, 4);
  const slot = createSlotGeometry(plane);
  fitSlotBounds(slot, new Float32Array(25).fill(500), 128);
  const mesh = new THREE.Mesh(slot);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, 0, -100);
  mesh.updateMatrixWorld(true);
  const camera = new THREE.PerspectiveCamera(68, 16 / 9, 0.1, 5000);
  camera.position.set(0, 502, 0);
  camera.lookAt(0, 500, -100);
  camera.updateMatrixWorld(true);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );
  assert.ok(frustum.intersectsObject(mesh));
});
