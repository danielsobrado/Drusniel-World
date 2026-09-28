import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getUnderwaterBlend,
  isLandStreamingSuspended,
  setUnderwaterBlend,
} from '../src/editor/water/underwaterState.js';

test('the blend is published and read back clamped to [0, 1]', () => {
  setUnderwaterBlend(0.25);
  assert.equal(getUnderwaterBlend(), 0.25);
  // Everything that writes this could be handed a bad frame time or a NaN from a
  // missing camera, and a NaN blend would suspend the land forever with no way to
  // notice.
  setUnderwaterBlend(2);
  assert.equal(getUnderwaterBlend(), 1);
  setUnderwaterBlend(-3);
  assert.equal(getUnderwaterBlend(), 0);
  setUnderwaterBlend(Number.NaN);
  assert.equal(getUnderwaterBlend(), 0);
});

test('land streaming stands down once the camera is genuinely under', () => {
  setUnderwaterBlend(0);
  assert.equal(isLandStreamingSuspended(), false);
  // At the surface: still streaming. A player bobbing at the waterline must not
  // start and stop the world's streaming every wave, which is why the threshold is
  // well inside the transition rather than at its start.
  setUnderwaterBlend(0.3);
  assert.equal(isLandStreamingSuspended(), false);
  setUnderwaterBlend(0.9);
  assert.equal(isLandStreamingSuspended(), true);
  setUnderwaterBlend(1);
  assert.equal(isLandStreamingSuspended(), true);
  // A threshold of its own, for a caller that wants to sit at the waterline.
  assert.equal(isLandStreamingSuspended(0.2), true);
});

test('surfacing resumes the land', () => {
  setUnderwaterBlend(1);
  assert.equal(isLandStreamingSuspended(), true);
  setUnderwaterBlend(0.4);
  assert.equal(isLandStreamingSuspended(), false);
  setUnderwaterBlend(0);
  assert.equal(isLandStreamingSuspended(), false);
});
