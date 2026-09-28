import assert from 'node:assert/strict';
import test from 'node:test';

import { STEP_STATES } from '../src/editor/ui/LoadingTracker.js';
import { tickerLayout } from '../src/editor/ui/loadingTicker.js';

const { PENDING, ACTIVE, DONE, FAILED } = STEP_STATES;
const steps = (...states) => states.map((state) => ({ state }));

test('the active stage holds the bottom row; finished stages rise and fade', () => {
  const layout = tickerLayout(steps(DONE, DONE, DONE, ACTIVE, PENDING));
  assert.deepEqual(layout.map((entry) => entry.row), [-3, -2, -1, 0, 1]);
  const opacity = layout.map((entry) => entry.opacity);
  assert.equal(opacity[3], 1, 'the running stage is solid');
  assert.ok(opacity[2] > opacity[1] && opacity[1] > opacity[0] && opacity[0] > 0, 'fading as they climb');
  assert.equal(opacity[4], 0, 'the next stage waits unseen below');
});

test('stages far above the slot are gone, and a failure holds the slot', () => {
  const layout = tickerLayout(steps(DONE, DONE, DONE, DONE, DONE, ACTIVE));
  assert.equal(layout[0].opacity, 0);
  assert.equal(tickerLayout(steps(DONE, FAILED, PENDING))[1].row, 0);
});

test('before the first start the first stage waits in the slot; at the end the last keeps it', () => {
  assert.deepEqual(tickerLayout(steps(PENDING, PENDING)).map((entry) => entry.row), [0, 1]);
  assert.deepEqual(tickerLayout(steps(DONE, DONE, DONE)).map((entry) => entry.row), [-2, -1, 0]);
});
