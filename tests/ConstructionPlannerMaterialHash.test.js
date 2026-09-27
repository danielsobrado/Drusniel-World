import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCubicBezierPathFromStroke,
  insertCubicBezierAnchor,
} from '../src/editor/construction/curve/CubicBezierPath.js';
import { planConstruction } from '../src/editor/construction/planning/ConstructionPlanner.js';

function record(materials = {}) {
  return {
    version: 1,
    id: 'construction-material-hash',
    revision: 1,
    seed: 41,
    kind: 'wall',
    style: { key: 'soft-limestone-rubble', version: 1, materials },
    dimensions: { height: 3.5, thickness: 0.8 },
    path: createCubicBezierPathFromStroke([
      [0, 0],
      [10, 3],
      [24, 0],
      [38, 4],
    ], { simplifyTolerance: 0.01 }),
    features: [],
  };
}

function hashes(plan) {
  return plan.modules.map(({ id, contentHash }) => [id, contentHash]);
}

/**
 * Whether two modules' generated placements agree to `epsilon`. Starts
 * bit-identical and falls back to the hash's 0.1 mm quantum: re-sampling a
 * Bézier can perturb an untouched stone in the last few bits (~1e-17 here).
 */
function placementsMatch(actual, expected, epsilon = 1e-9) {
  if (Array.isArray(actual) || Array.isArray(expected)) {
    if (!Array.isArray(actual) || !Array.isArray(expected) || actual.length !== expected.length) {
      return false;
    }
    return actual.every((value, index) => placementsMatch(value, expected[index], epsilon));
  }
  if (actual && expected && typeof actual === 'object') {
    const keys = Object.keys(actual);
    if (keys.length !== Object.keys(expected).length) return false;
    return keys.every((key) => (
      Object.hasOwn(expected, key) && placementsMatch(actual[key], expected[key], epsilon)
    ));
  }
  if (typeof actual === 'number' && typeof expected === 'number') {
    return Object.is(actual, expected) || Math.abs(actual - expected) <= epsilon;
  }
  return actual === expected;
}

test('material changes do not alter geometry hashes', () => {
  const before = planConstruction(record(), { maxModuleLength: 8 });
  const painted = planConstruction(record({
    stone: 'granite-masonry',
    mortar: 'limestone-masonry',
    roof: null,
  }), { maxModuleLength: 8 });

  assert.equal(painted.contentHash, before.contentHash);
  assert.deepEqual(hashes(painted), hashes(before));
  assert.deepEqual(
    painted.modules.map(({ placements }) => placements),
    before.modules.map(({ placements }) => placements),
  );
});

test('painting before a local edit does not invalidate unrelated modules', () => {
  // Material state (the paint) is not a geometry input — the hash covers the
  // style *key*, not its materials — so it must not widen the set of modules a
  // local edit rebuilds. The edit here is a de Casteljau `insert_anchor` on the
  // first segment: it preserves the wall's curve exactly, so every module on a
  // segment the split never reaches keeps its hash and its stones (measured:
  // segments 2 and 3 byte-identical, only the split pair on segment 1 rebuilds).
  //
  // The previous form of this test drove a length-changing anchor move instead.
  // That genuinely re-grids the whole wall — the masonry course lattice resolves
  // in the wall's absolute arc coordinate — so the modules it "invalidated" were
  // the arc-domain re-grid, not the paint. The soundness assertion that replaces
  // that case lives in `ConstructionPlanner.test.js`
  // ("a length-changing endpoint move moves a far module's hash with its geometry").
  const source = record({ stone: 'granite-masonry' });
  const before = planConstruction(source, { maxModuleLength: 8 });
  const splitSegmentId = source.path.segments[0].id;
  const splitPath = insertCubicBezierAnchor(source.path, splitSegmentId, 0.5);
  const after = planConstruction(
    { ...structuredClone(source), path: splitPath },
    { maxModuleLength: 8 },
  );

  const beforeHashes = new Map(hashes(before));
  const beforeModules = new Map(before.modules.map((module) => [module.id, module]));
  const untouched = new Set(source.path.segments.slice(1).map(({ id }) => id));

  let unrelated = 0;
  let changedCount = 0;
  for (const module of after.modules) {
    const originalHash = beforeHashes.get(module.id);
    if (originalHash === undefined) continue; // the new half of the split
    if (untouched.has(module.segmentId)) {
      unrelated += 1;
      assert.equal(
        module.contentHash,
        originalHash,
        `material state widened the edit to unrelated module ${module.id}`,
      );
      assert.ok(
        placementsMatch(module.placements, beforeModules.get(module.id).placements),
        `material state moved unrelated module ${module.id}'s stones`,
      );
      continue;
    }
    if (module.contentHash !== originalHash) changedCount += 1;
  }
  assert.ok(unrelated >= 3, `expected several unrelated modules, got ${unrelated}`);
  assert.ok(changedCount > 0, 'the local edit must actually rebuild the split segment');
});
