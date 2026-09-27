import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';

import { SnowPowderKicks, createPowderGeometry } from '../src/editor/stylized/powder/SnowPowderKicks.js';

test('each slot owns a run of puffs', () => {
  const geometry = createPowderGeometry(3, 4, () => 0.5);
  const slots = geometry.attributes.powderSlot;
  assert.equal(slots.count, 3 * 4 * 4);
  assert.equal(slots.getX(0), 0);
  assert.equal(slots.getX(4 * 4), 1, 'the fifth puff starts slot 1');
  assert.equal(slots.getX(slots.count - 1), 2);
});

test('footfalls kick forward, reuse the oldest slot, ride the origin and settle', () => {
  const scene = new THREE.Scene();
  const powder = new SnowPowderKicks({ scene, config: { slots: 2 } });
  assert.equal(powder.mesh.visible, false);
  powder.update(10);
  powder.kick({ x: 1, y: 2, z: 3, facing: 0, speed: 7 });
  const [first] = powder.uniforms.kicks.array;
  assert.deepEqual([first.x, first.y, first.z, first.w], [1, 2.05, 3, 10]);
  const motion = powder.uniforms.motions.array[0];
  assert.ok(Math.abs(motion.x) < 1e-12 && motion.y === 1, 'facing 0 kicks toward +z, the way the figure faces');
  assert.ok(motion.z > 1, 'a run kicks harder than a walk');
  assert.equal(powder.mesh.visible, true);

  powder.kick({ x: 4, y: 0, z: 0, facing: Math.PI / 2 });
  powder.kick({ x: 9, y: 0, z: 0 });
  assert.equal(powder.uniforms.kicks.array[0].x, 9, 'the oldest slot is reused');

  powder.shiftWorld(5, -2);
  assert.equal(powder.uniforms.kicks.array[0].x, 4);
  assert.equal(powder.uniforms.kicks.array[0].z, 2);

  powder.update(10.5);
  assert.equal(powder.mesh.visible, true);
  powder.update(12);
  assert.equal(powder.mesh.visible, false, 'hidden once every kick has settled');
  powder.dispose();
});
