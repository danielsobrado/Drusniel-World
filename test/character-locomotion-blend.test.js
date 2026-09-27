import assert from 'node:assert/strict';
import test from 'node:test';

import { LocomotionBlend } from '../src/editor/character/glb/LocomotionBlend.js';

const DT = 1 / 60;

// Drusniel's calibration: 1.85 m tall, a 1.033 s walk and a 0.7 s run.
function createBlend(limits = {}) {
  return new LocomotionBlend({
    height: 1.85,
    clipSpeedInHeights: { walk: 0.85, run: 2.4 },
    durations: { walk: 1.033, run: 0.7 },
    limits: { maxTimeScale: 3.2, minTimeScale: 0.5, swimCadence: 0.55, ...limits },
  });
}

function hold(blend, seconds, speed, grounded = true, swimming = false) {
  const steps = Math.round(seconds / DT);
  for (let step = 0; step < steps; step += 1) blend.update(DT, speed, grounded, swimming);
  return blend;
}

function assertWeightsSumToOne(blend) {
  assert.ok(Math.abs(blend.idle + blend.walk + blend.run - 1) < 1e-9);
}

test('a standing figure shows only the standing clip and does not cycle', () => {
  const blend = hold(createBlend(), 1, 0);
  assert.equal(blend.idle, 1);
  assert.equal(blend.timeScale, 0);
  assert.equal(blend.phase, 0);
});

test('weights always sum to one, so the bind pose never leaks through', () => {
  const blend = createBlend();
  for (const speed of [0, 0.5, 1.2, 2.5, 3.2, 5, 9, 16.2, 0]) {
    for (let step = 0; step < 20; step += 1) {
      blend.update(DT, speed, true, false);
      assertWeightsSumToOne(blend);
    }
  }
});

test('below the playback caps the stride phase advances by distance, not time', () => {
  const blend = hold(createBlend(), 2, 1.2);
  assert.ok(blend.walk > 0.999, 'a slow walk is all walk');
  const start = blend.phase;
  const seconds = 0.5;
  hold(blend, seconds, 1.2);
  const walkStride = 1.85 * 0.85 * 1.033;
  const expected = (start + (1.2 * seconds) / walkStride) % 1;
  assert.ok(Math.abs(blend.phase - expected) < 1e-6);
});

test("the game's 9 m/s walk plays the run clip at its speed-matched rate", () => {
  const blend = hold(createBlend(), 2, 9);
  assert.ok(blend.run > 0.999);
  assert.ok(Math.abs(blend.timeScale - 9 / (1.85 * 2.4)) < 1e-9);
});

test('a sprint past the cap keeps the cadence readable instead of blurring the legs', () => {
  const blend = hold(createBlend(), 2, 16.2);
  assert.equal(blend.timeScale, 3.2);
});

test('an airborne figure holds its stride where the jump left it', () => {
  const blend = hold(createBlend(), 2, 9);
  const { phase, idle, walk, run } = blend;
  hold(blend, 0.5, 9, false);
  assert.equal(blend.phase, phase);
  assert.deepEqual([blend.idle, blend.walk, blend.run], [idle, walk, run]);
});

test('swimming stands the legs down and hands them to the swim layer', () => {
  const blend = hold(createBlend(), 2, 9);
  const phase = blend.phase;
  hold(blend, 3, 5, false, true);
  assert.ok(blend.idle > 0.999);
  assert.equal(blend.timeScale, 0);
  assert.equal(blend.phase, phase);
});

test('reset drops straight back to standing', () => {
  const blend = hold(createBlend(), 1, 9);
  blend.reset();
  assert.deepEqual([blend.idle, blend.walk, blend.run, blend.timeScale], [1, 0, 0, 0]);
});
