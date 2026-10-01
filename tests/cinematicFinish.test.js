import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_CINEMATIC_FINISH, resolveCinematicFinish } from '../src/editor/stylized/cinematicFinish.js';

test('the finish resolves to the donor grade, and bad values fail at load', () => {
  const finish = resolveCinematicFinish({});
  assert.equal(finish.enabled, true);
  assert.equal(finish.contrast, DEFAULT_CINEMATIC_FINISH.contrast);
  assert.deepEqual(finish.gain, [...DEFAULT_CINEMATIC_FINISH.gain]);
  assert.equal(finish.bloom.threshold, 2.1);
  assert.deepEqual(resolveCinematicFinish({ enabled: false }), { enabled: false });
  assert.equal(resolveCinematicFinish({ bloom: { enabled: false } }).bloom.enabled, false);
  assert.throws(() => resolveCinematicFinish({ lift: [0, 0] }), /triple/);
  assert.throws(() => resolveCinematicFinish({ vignette: 3 }), /vignette/);
});
