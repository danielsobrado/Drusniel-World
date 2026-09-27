import assert from 'node:assert/strict';
import test from 'node:test';

import { FOOT_LEFT, FOOT_RIGHT, FootstepTracker } from '../src/editor/character/glb/FootstepTracker.js';
import { parseAudioConfig } from '../src/editor/audio/audio_config.js';

const landings = {
  walk: { left: [0.3], right: [0.82] },
  run: { left: [0.2], right: [0.68] },
};
const offsets = { walk: 0.3, run: 0.2 };

function stride(tracker, weights, { steps = 60, perStep = 1 / 30, grounded = true, start = 0 } = {}) {
  const feet = [];
  let phase = start;
  tracker.update(phase, weights, grounded);
  for (let step = 0; step < steps; step += 1) {
    phase = (phase + perStep) % 1;
    const foot = tracker.update(phase, weights, grounded);
    if (foot) feet.push([foot, Number(phase.toFixed(3))]);
  }
  return feet;
}

test('each cycle lands the left foot at the shared zero and the right where the clip puts it', () => {
  const feet = stride(new FootstepTracker(landings, offsets), { walk: 1, run: 0 }, { start: 0.9 });
  assert.deepEqual(feet.map(([foot]) => foot), [FOOT_LEFT, FOOT_RIGHT, FOOT_LEFT, FOOT_RIGHT]);
  const right = feet.find(([foot]) => foot === FOOT_RIGHT)[1];
  assert.ok(Math.abs(right - 0.52) < 1 / 30 + 1e-9, `right lands at ${right}`);
});

test('running reads the run clip\'s right landing', () => {
  const feet = stride(new FootstepTracker(landings, offsets), { walk: 0, run: 1 }, { start: 0.9, steps: 30 });
  const right = feet.find(([foot]) => foot === FOOT_RIGHT)[1];
  assert.ok(Math.abs(right - 0.48) < 1 / 30 + 1e-9, `right lands at ${right}`);
});

test('no footfalls while standing, airborne or swimming', () => {
  assert.deepEqual(stride(new FootstepTracker(landings, offsets), { walk: 0.2, run: 0.1 }), []);
  assert.deepEqual(stride(new FootstepTracker(landings, offsets), { walk: 1, run: 0 }, { grounded: false }), []);
});

test('a phase that jumps backwards or a long way is not a footfall', () => {
  const tracker = new FootstepTracker(landings, offsets);
  tracker.update(0.9, { walk: 1, run: 0 }, true);
  assert.equal(tracker.update(0.45, { walk: 1, run: 0 }, true), null, 'over half a cycle in one frame is a reset, not a stride');
  tracker.update(0.6, { walk: 1, run: 0 }, true);
  assert.equal(tracker.update(0.55, { walk: 1, run: 0 }, true), null);
});

test('footstep sounds are registered with the audio bus', () => {
  const config = parseAudioConfig();
  assert.equal(config.events['player.footstep'].synth, 'footstep');
  assert.equal(config.events['player.footstep.water'].synth, 'splash');
});
