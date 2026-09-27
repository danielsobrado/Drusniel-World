import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { collectHumanoidBones } from '../src/editor/character/glb/humanoidRig.js';
import { SwimMotion } from '../src/editor/character/glb/SwimMotion.js';
import { SwimStroke } from '../src/editor/character/glb/SwimStroke.js';

const DT = 1 / 60;

function hold(swim, seconds, { swimming = true, submerged = false, speed = 0, climb = 0 } = {}) {
  let footY = swim._previousFootY ?? 0;
  for (let step = 0; step < Math.round(seconds / DT); step += 1) {
    footY += climb * DT;
    swim.update(DT, swimming, submerged, speed, footY);
  }
  return swim;
}

test('treading water keeps the body upright and the stroke out', () => {
  const swim = hold(new SwimMotion({ treadCadence: 0.55, pivotHeight: 1.2 }), 2);
  assert.ok(swim.weight > 0.99);
  assert.ok(swim.stroke < 1e-3);
  assert.ok(Math.abs(swim.pitch) < 1e-3);
});

test('swimming along the surface lies flat but keeps the head up', () => {
  const swim = hold(new SwimMotion({ treadCadence: 0.55, pivotHeight: 1.2 }), 3, { speed: 5 });
  assert.ok(swim.stroke > 0.99);
  assert.ok(Math.abs(swim.pitch - 1.3) < 0.01, `pitch ${swim.pitch}`);
});

test('a diver pitches head-down, and rising brings the body upright', () => {
  const diving = hold(new SwimMotion({ treadCadence: 0.55, pivotHeight: 1.2 }), 3, { submerged: true, speed: 2, climb: -3 });
  assert.ok(diving.pitch > Math.PI / 2 + 0.3, `diving pitch ${diving.pitch}`);
  const rising = hold(new SwimMotion({ treadCadence: 0.55, pivotHeight: 1.2 }), 3, { submerged: true, speed: 0.5, climb: 3 });
  assert.ok(rising.pitch < 0.4, `rising pitch ${rising.pitch}`);
});

test('leaving the water eases the whole layer out', () => {
  const swim = hold(new SwimMotion({ treadCadence: 0.55, pivotHeight: 1.2 }), 2, { speed: 5 });
  hold(swim, 2, { swimming: false, speed: 5 });
  assert.ok(swim.weight < 0.001 && swim.stroke < 0.001 && swim.pitch < 0.01);
});

test('a teleport between frames is not read as a plunge', () => {
  const swim = hold(new SwimMotion({ treadCadence: 0.55, pivotHeight: 1.2 }), 1);
  swim.update(DT, true, true, 0, -500);
  assert.equal(swim.verticalSpeed, 0);
});

function createRig() {
  const bone = (name, x, y, z, parent) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    parent?.add(b);
    return b;
  };
  const model = new THREE.Group();
  const hips = bone('Hips', 0, 1, 0, null);
  model.add(hips);
  const spine = bone('Spine', 0, 0.3, 0, hips);
  bone('Head', 0, 0.35, 0, spine);
  for (const [side, sign] of [['Left', 1], ['Right', -1]]) {
    const upLeg = bone(`${side}UpLeg`, 0.1 * sign, -0.05, 0, hips);
    const leg = bone(`${side}Leg`, 0, -0.42, 0.02, upLeg);
    bone(`${side}Foot`, 0, -0.43, -0.02, leg);
    const arm = bone(`${side}Arm`, 0.18 * sign, 0.12, 0, spine);
    const foreArm = bone(`${side}ForeArm`, 0.02 * sign, -0.28, -0.02, arm);
    bone(`${side}Hand`, 0, -0.26, 0.02, foreArm);
  }
  model.updateMatrixWorld(true);
  return { model, bones: collectHumanoidBones(model) };
}

const world = (object) => object.getWorldPosition(new THREE.Vector3());

test('the crawl reaches one arm overhead while the other finishes its pull', () => {
  const { model, bones } = createRig();
  new SwimStroke(model, bones).apply(1, 1, 0, 0);
  model.updateMatrixWorld(true);
  const shoulderL = world(bones.left.arm);
  const shoulderR = world(bones.right.arm);
  assert.ok(world(bones.left.hand).y > shoulderL.y + 0.35, 'left hand reaches past the head');
  assert.ok(world(bones.right.hand).y < shoulderR.y - 0.3, 'right hand is down by the hip');
});

test('treading sculls both hands in front of the chest', () => {
  const { model, bones } = createRig();
  new SwimStroke(model, bones).apply(1, 0, 0, 0.25);
  model.updateMatrixWorld(true);
  for (const side of ['left', 'right']) {
    const hand = world(bones[side].hand);
    const shoulder = world(bones[side].arm);
    assert.ok(hand.z > shoulder.z + 0.15, `${side} hand in front`);
    assert.ok(hand.y < shoulder.y, `${side} hand below the shoulder`);
  }
});

test('the stroke follows the body frame when the body lies flat', () => {
  const { model, bones } = createRig();
  const body = new THREE.Group();
  body.add(model);
  body.rotation.x = Math.PI / 2;
  body.updateMatrixWorld(true);
  new SwimStroke(model, bones).apply(1, 1, 0, 0);
  body.updateMatrixWorld(true);
  // Lying flat, "overhead" is forward along the surface, not up.
  assert.ok(world(bones.left.hand).z > world(bones.left.arm).z + 0.35);
});

test('zero weight leaves the pose alone', () => {
  const { model, bones } = createRig();
  const before = world(bones.left.hand);
  new SwimStroke(model, bones).apply(0, 1, 0.3, 0.3);
  assert.ok(world(bones.left.hand).equals(before));
});

test('a short swimmer is lifted until its chest rides just under the surface', () => {
  const swim = new SwimMotion({ treadCadence: 0.55, pivotHeight: 0.82 });
  // The player floats with the soles 1.35 m under a surface at 0.
  for (let step = 0; step < 180; step += 1) swim.update(DT, true, false, 0, -1.35, 0);
  assert.ok(Math.abs(-1.35 + 0.82 + swim.lift - -0.15) < 1e-3, `lift ${swim.lift}`);
  for (let step = 0; step < 180; step += 1) swim.update(DT, true, true, 0, -6, 0);
  assert.ok(Math.abs(swim.lift) < 1e-3, 'no lift once fully under water');
});
