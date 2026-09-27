import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { ContactShadow, contactOpacity } from '../src/editor/character/glb/ContactShadow.js';
import { collectHumanoidBones } from '../src/editor/character/glb/humanoidRig.js';

function fakeBlob(name) {
  const geometry = new THREE.PlaneGeometry(2, 2);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.name = name;
  mesh.visible = false;
  return { mesh, opacity: 0, setOpacity(value) { this.opacity = value; } };
}

function createRig(y = 0) {
  const bone = (name, x, by, z, parent) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, by, z);
    parent?.add(b);
    return b;
  };
  const model = new THREE.Group();
  const hips = bone('Hips', 0, 1 + y, 0, null);
  model.add(hips);
  bone('Head', 0, 0.6, 0, hips);
  for (const [side, sign] of [['Left', 1], ['Right', -1]]) {
    const upLeg = bone(`${side}UpLeg`, 0.1 * sign, -0.05, 0, hips);
    const leg = bone(`${side}Leg`, 0, -0.42, 0, upLeg);
    const foot = bone(`${side}Foot`, 0, -0.43, 0, leg);
    bone(`${side}ToeBase`, 0, -0.08, 0.12, foot);
    const arm = bone(`${side}Arm`, 0.18 * sign, 0.45, 0, hips);
    const foreArm = bone(`${side}ForeArm`, 0, -0.28, 0, arm);
    bone(`${side}Hand`, 0, -0.26, 0, foreArm);
  }
  model.updateMatrixWorld(true);
  return collectHumanoidBones(model);
}

function createShadow(terrain, footLift = 0) {
  const parent = new THREE.Group();
  const bones = createRig(footLift);
  const shadow = new ContactShadow({ parent, terrain, bones, height: 1.8, createBlob: fakeBlob });
  return { shadow, parent };
}

test('opacity is full on the ground and gone by the fade height', () => {
  assert.equal(contactOpacity(0, 0.7, 0.8), 0.8);
  assert.equal(contactOpacity(0.7, 0.7, 0.8), 0);
  assert.ok(contactOpacity(0.35, 0.7, 0.8) < 0.8 / 2);
  assert.equal(contactOpacity(Number.NaN, 0.7, 0.8), 0);
});

test('a grounded figure gets a body blob and a patch under each sole', () => {
  const { shadow, parent } = createShadow({ heightAt: () => 0 });
  shadow.update(0, 0, 0, 0);
  const [body, left, right] = shadow.meshes;
  assert.equal(parent.children.length, 3);
  assert.ok(body.visible && left.visible && right.visible);
  assert.ok(shadow.body.opacity > 0.8);
  assert.ok(left.position.x > 0 && right.position.x < 0, 'patches sit under their own feet');
});

test('a jump fades the body blob and lifts the sole patches away', () => {
  const { shadow } = createShadow({ heightAt: () => 0 }, 2);
  shadow.update(0, 0, 2, 0);
  assert.ok(shadow.meshes.every((mesh) => !mesh.visible));
});

test('the blob lies on the slope rather than cutting into it', () => {
  const { shadow } = createShadow({ heightAt: (x) => 0.5 * x });
  shadow.update(0, 0, 0, 0);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(shadow.meshes[0].quaternion);
  const expected = new THREE.Vector3(-0.5, 1, 0).normalize();
  assert.ok(up.angleTo(expected) < 1e-6);
});
