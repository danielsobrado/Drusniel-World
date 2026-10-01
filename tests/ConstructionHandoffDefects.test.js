import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeConstructionRecord } from '../src/editor/construction/ConstructionSchema.js';
import { createCubicBezierPathFromStroke } from '../src/editor/construction/curve/CubicBezierPath.js';
import { planConstruction } from '../src/editor/construction/planning/ConstructionPlanner.js';
import { selectConstructionLod } from '../src/editor/construction/render/ConstructionLod.js';
import { selectProjectedLod } from '../src/editor/stylized/lod/projectedLod.js';

/** Wall implementation handoff (2026-09-28) §4A and §4B, plus the top-course band. */

function wall(path, { height = 3.2, key = 'rounded-fieldstone' } = {}) {
  return normalizeConstructionRecord({
    version: 1, id: 'handoff', revision: 1, seed: 3141, kind: 'wall',
    style: { key, version: 1 },
    dimensions: { height, thickness: 0.8 },
    top: { style: 'flat' },
    path,
    features: [],
  });
}

function circle(count, radius) {
  const points = Array.from({ length: count }, (_, index) => [
    Math.cos((index * 2 * Math.PI) / count) * radius,
    Math.sin((index * 2 * Math.PI) / count) * radius,
  ]);
  return createCubicBezierPathFromStroke(points, { closed: true, simplifyTolerance: 0.02 });
}

test('a dense circle plans masonry around its whole loop (4A)', () => {
  for (const [count, radius] of [[32, 3.6], [8, 3.6], [64, 6]]) {
    const path = circle(count, radius);
    const plan = planConstruction(wall(path));
    assert.equal(plan.modules.length >= path.segments.length, true, `${count}-point circle`);
    const intervals = plan.modules.map((module) => module.pathInterval);
    assert.ok(Math.abs(intervals[0][0]) < 1e-9);
    assert.ok(Math.abs(intervals.at(-1)[1] - plan.totalLength) < 1e-6, 'covers the loop once');
    for (let index = 1; index < intervals.length; index += 1) {
      assert.ok(Math.abs(intervals[index][0] - intervals[index - 1][1]) < 1e-9, 'no gap between modules');
    }
    const stones = plan.modules.reduce((total, module) => total + module.placements.length, 0);
    assert.ok(stones > 150, `${count}-point circle has ${stones} stones`);
  }
});

test('the top course reaches the capstones at any wall height', () => {
  for (const key of ['rounded-fieldstone', 'coursed-rubble']) {
    for (const height of [2.4, 3.2, 3.5, 4, 4.3]) {
      const path = createCubicBezierPathFromStroke([[0, 0], [5, 0], [10, 0], [15, 0]], { simplifyTolerance: 0.01 });
      const placements = planConstruction(wall(path, { height, key })).modules.flatMap((module) => module.placements);
      const fieldTop = Math.max(...placements.filter((p) => p.category === 'field').map((p) => p.y + p.height / 2));
      const copingBottom = Math.min(...placements.filter((p) => p.category === 'coping').map((p) => p.y - p.height / 2));
      assert.ok(copingBottom - fieldTop < 0.03, `${key} ${height} m: ${(copingBottom - fieldTop).toFixed(3)} m bare band`);
    }
  }
});

test('a far band never holds past an intermediate threshold it has crossed (4B)', () => {
  for (const pixels of [100, 139, 140, 150, 161]) {
    assert.equal(selectConstructionLod({ pixels, previous: 'shell' }), 'coarse', `${pixels} px`);
  }
  assert.equal(selectConstructionLod({ pixels: 170, previous: 'shell' }), 'near');
  // Adjacent boundaries keep their hysteresis in both directions.
  assert.equal(selectConstructionLod({ pixels: 150, previous: 'coarse' }), 'coarse');
  assert.equal(selectConstructionLod({ pixels: 125, previous: 'near' }), 'near');
  assert.equal(selectConstructionLod({ pixels: 38, previous: 'shell' }), 'shell');
  assert.equal(selectConstructionLod({ pixels: 32, previous: 'coarse' }), 'coarse');
  // A zoom-out across two bands lands where the crossed margins allow.
  assert.equal(selectConstructionLod({ pixels: 32, previous: 'near' }), 'coarse');
  assert.equal(selectConstructionLod({ pixels: 10, previous: 'near' }), 'shell');
});

test('the shared selector skips bands the same way for other consumers', () => {
  const thresholds = { nearPixels: 200, proxyPixels: 80, impostorPixels: 20, clusterPixels: 0 };
  assert.equal(selectProjectedLod({ pixels: 150, previous: 'impostor', ...thresholds }), 'proxy');
  assert.equal(selectProjectedLod({ pixels: 150, previous: 'culled', ...thresholds }), 'proxy');
  assert.equal(selectProjectedLod({ pixels: 220, previous: 'proxy', ...thresholds }), 'proxy');
  assert.equal(selectProjectedLod({ pixels: 240, previous: 'proxy', ...thresholds }), 'near');
});
