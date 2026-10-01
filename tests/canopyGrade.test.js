import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_CANOPY_GRADE, gradeCanopy, resolveCanopyGrade } from '../src/editor/stylized/forest/canopyGrade.js';

test('the canopy grade defaults to the donor palette and can be turned off', () => {
  const grade = resolveCanopyGrade(undefined);
  assert.equal(grade.shadow, DEFAULT_CANOPY_GRADE.shadow);
  assert.equal(grade.light, DEFAULT_CANOPY_GRADE.light);
  assert.equal(grade.tint, 0.9);
  assert.equal(resolveCanopyGrade({ enabled: false }), null);
  assert.equal(resolveCanopyGrade({ tint: 0.5 }).tint, 0.5);
});

test('the canopy grade rejects bad colours and tints', () => {
  assert.throws(() => resolveCanopyGrade({ shadow: 'green' }), /canopyGrade\.shadow/);
  assert.throws(() => resolveCanopyGrade({ tint: 2 }), /canopyGrade\.tint/);
});

test('an ungraded canopy passes its sample through', () => {
  const sample = { marker: true };
  assert.equal(gradeCanopy(sample, null), sample);
});
