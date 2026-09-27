import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
  characterOcclusionUniforms,
  updateCharacterOcclusion,
} from '../src/editor/character/CharacterOcclusion.js';

const renderer = {
  getDrawingBufferSize(target) {
    return target.set(1600, 900);
  },
};

function camera() {
  const value = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
  value.position.set(0, 2, 4);
  value.lookAt(0, 1, 0);
  value.updateMatrixWorld(true);
  return value;
}

test('the window centres on the character and scales with distance', () => {
  updateCharacterOcclusion({ renderer, camera: camera(), target: new THREE.Vector3(0, 1, 0), height: 1.8 });
  const { center, radius, depth, strength } = characterOcclusionUniforms;
  assert.equal(strength.value, 1);
  assert.ok(Math.abs(center.value.x - 800) < 1e-6 && Math.abs(center.value.y - 450) < 1e-6);
  assert.ok(Math.abs(depth.value - Math.hypot(4, 1)) < 1e-9);
  const near = radius.value;
  const far = camera();
  far.position.set(0, 2, 12);
  far.lookAt(0, 1, 0);
  far.updateMatrixWorld(true);
  updateCharacterOcclusion({ renderer, camera: far, target: new THREE.Vector3(0, 1, 0), height: 1.8 });
  assert.ok(radius.value < near / 2);
});

test('a reduced scene resolution shrinks the window with it', () => {
  updateCharacterOcclusion({ renderer, camera: camera(), target: new THREE.Vector3(0, 1, 0), height: 1.8, pixelScale: 0.5 });
  assert.ok(Math.abs(characterOcclusionUniforms.center.value.x - 400) < 1e-6);
});

test('first person, a character behind the camera, or disabling switches the cut off', () => {
  updateCharacterOcclusion({ renderer, camera: camera(), target: new THREE.Vector3(0, 1, 10), height: 1.8 });
  assert.equal(characterOcclusionUniforms.strength.value, 0);
  updateCharacterOcclusion({ renderer, camera: camera(), target: new THREE.Vector3(0, 1, 0), height: 1.8, enabled: false });
  assert.equal(characterOcclusionUniforms.strength.value, 0);
});
