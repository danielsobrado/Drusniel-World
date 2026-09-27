import assert from 'node:assert/strict';
import test from 'node:test';
import { planConstruction } from '../src/editor/construction/planning/ConstructionPlanner.js';
import {
  createCubicBezierPathFromStroke,
  insertCubicBezierAnchor,
} from '../src/editor/construction/curve/CubicBezierPath.js';

/**
 * The module content hash is the renderer's cache key: `ConstructionView`
 * rebuilds a module only when its hash changes, so the contract has to be
 * *equal hash => equal geometry*. Deriving the per-module seed from the module's
 * index in the flat module array broke that: inserting a control point upstream
 * shifted every downstream index, re-rolled their stones, and left their hashes
 * untouched — the renderer kept the stale stones and visibly swapped them on the
 * next rebuild. These tests pin the seed derivation (segment lineage, not array
 * position) and the completeness of the hash.
 */

function record(overrides = {}) {
  return {
    version: 1,
    id: 'seed-stability',
    revision: 1,
    seed: 7,
    kind: 'wall',
    style: { key: 'coursed-rubble', version: 1 },
    dimensions: { height: 4, thickness: 0.9 },
    path: createCubicBezierPathFromStroke([
      [0, 0], [8, 5], [18, -3], [28, 4], [38, -2], [48, 3],
    ], { simplifyTolerance: 0.01 }),
    features: [],
    top: { style: 'flat', base: 4, profile: [] },
    ...overrides,
  };
}

const OPTIONS = { maxModuleLength: 8 };

function hashById(plan) {
  return new Map(plan.modules.map(({ id, contentHash }) => [id, contentHash]));
}

function placementsById(plan) {
  return new Map(plan.modules.map(({ id, placements }) => [id, placements]));
}

/**
 * Deep equality with a numeric tolerance.
 *
 * Numbers are compared with `epsilon` so the Bézier sampler's floating-point
 * re-sampling does not masquerade as a geometry change; everything else — array
 * lengths, string fields, key presence — is exact. `epsilon = 0` is a
 * byte-identical comparison.
 */
function assertSameGeometry(actual, expected, epsilon, where) {
  if (Array.isArray(actual) || Array.isArray(expected)) {
    assert.ok(Array.isArray(actual) && Array.isArray(expected), `${where}: array mismatch`);
    assert.equal(actual.length, expected.length, `${where}: length ${actual.length} vs ${expected.length}`);
    for (let index = 0; index < actual.length; index += 1) {
      assertSameGeometry(actual[index], expected[index], epsilon, `${where}[${index}]`);
    }
    return;
  }
  if (actual && expected && typeof actual === 'object') {
    const keys = Object.keys(actual);
    assert.deepEqual(Object.keys(expected), keys, `${where}: key set differs`);
    for (const key of keys) {
      assertSameGeometry(actual[key], expected[key], epsilon, `${where}.${key}`);
    }
    return;
  }
  if (typeof actual === 'number' && typeof expected === 'number') {
    if (Object.is(actual, expected)) return;
    assert.ok(
      Math.abs(actual - expected) <= epsilon,
      `${where}: ${actual} vs ${expected} differ by ${Math.abs(actual - expected)}`,
    );
    return;
  }
  assert.equal(actual, expected, `${where}: ${String(actual)} vs ${String(expected)}`);
}

test('the same authored record always produces the same plan', () => {
  const source = record();
  // Byte-identical, twice and through a structural clone: the plan is a pure
  // function of the record.
  assert.deepEqual(planConstruction(source, OPTIONS), planConstruction(source, OPTIONS));
  assert.deepEqual(
    planConstruction(source, OPTIONS),
    planConstruction(structuredClone(source), OPTIONS),
  );
});

test('the hash changes when any geometry-affecting input changes', () => {
  const base = planConstruction(record(), OPTIONS);
  const baseHashes = hashById(base);
  const lastSegmentId = record().path.segments.at(-1).id;

  const variants = {
    seed: record({ seed: 8 }),
    height: record({
      dimensions: { height: 5, thickness: 0.9 },
      top: { style: 'flat', base: 5, profile: [] },
    }),
    thickness: record({ dimensions: { height: 4, thickness: 1.1 } }),
    'top profile slice': record({
      top: {
        style: 'flat',
        base: 4,
        profile: [
          { segmentId: lastSegmentId, arcFraction: 0.3, height: 3.5 },
          { segmentId: lastSegmentId, arcFraction: 0.55, height: 4.8 },
          { segmentId: lastSegmentId, arcFraction: 0.8, height: 3.5 },
        ],
      },
    }),
    style: record({ style: { key: 'ashlar', version: 1 } }),
  };

  for (const [label, variant] of Object.entries(variants)) {
    const plan = planConstruction(variant, OPTIONS);
    const changedModules = plan.modules.filter(({ id, contentHash }) => (
      baseHashes.has(id) && contentHash !== baseHashes.get(id)
    ));
    assert.ok(changedModules.length > 0, `${label} must change at least one module hash`);
    assert.notEqual(plan.contentHash, base.contentHash, `${label} must change the plan hash`);
  }
});

test('material ids stay out of the geometry hash and leave the stones untouched', () => {
  // Material ids are render inputs, not geometry inputs, and the invariant only
  // requires the hash to cover what can move the stones. Painting a wall must
  // therefore keep every hash and every generated placement byte-identical.
  const plain = planConstruction(record(), OPTIONS);
  const painted = planConstruction(record({
    style: {
      key: 'coursed-rubble',
      version: 1,
      materials: { stone: 'granite-masonry', mortar: 'limestone-masonry', roof: null },
    },
  }), OPTIONS);

  assert.equal(painted.contentHash, plain.contentHash);
  assert.deepEqual(hashById(painted), hashById(plain));
  assert.deepEqual(
    painted.modules.map(({ placements }) => placements),
    plain.modules.map(({ placements }) => placements),
  );
});

test('identical module hashes imply identical module geometry', () => {
  const lastSegmentId = record().path.segments.at(-1).id;
  const plans = [
    planConstruction(record(), OPTIONS),
    // Revision is metadata: nothing about the generated wall may move.
    planConstruction(record({ revision: 9 }), OPTIONS),
    // Material ids are not geometry inputs (see the material-hash suite).
    planConstruction(record({
      style: { key: 'coursed-rubble', version: 1, materials: { stone: 'granite-masonry', mortar: null, roof: null } },
    }), OPTIONS),
    // A top point at base height on the far segment reshapes only that end.
    planConstruction(record({
      top: {
        style: 'flat',
        base: 4,
        profile: [{ segmentId: lastSegmentId, arcFraction: 0.25, height: 4 }],
      },
    }), OPTIONS),
    // A taller wall genuinely re-grids every course.
    planConstruction(record({
      dimensions: { height: 5, thickness: 0.9 },
      top: { style: 'flat', base: 5, profile: [] },
    }), OPTIONS),
  ];

  let pairsCompared = 0;
  let pairsShared = 0;
  for (let left = 0; left < plans.length; left += 1) {
    for (let right = left + 1; right < plans.length; right += 1) {
      const leftById = new Map(plans[left].modules.map((module) => [module.id, module]));
      for (const module of plans[right].modules) {
        const other = leftById.get(module.id);
        if (!other) continue;
        pairsCompared += 1;
        if (other.contentHash !== module.contentHash) continue;
        pairsShared += 1;
        // The hash is a cache key, so an unchanged hash must mean the generated
        // stones are unchanged. Where the path is not re-sampled this is exact.
        assertSameGeometry(module.placements, other.placements, 0, `${module.id} (plans ${left}/${right})`);
      }
    }
  }
  assert.ok(pairsCompared > 20, `expected many shared modules, compared ${pairsCompared}`);
  assert.ok(pairsShared > 10, `expected many same-hash modules, shared ${pairsShared}`);
});

test('inserting a control point early leaves far modules bit-identical', () => {
  // This module length makes the split *add* a module ahead of the downstream
  // segments — the condition that shifted their flat-array index under the old
  // seed derivation. The guard below keeps the fixture honest.
  const options = { maxModuleLength: 5 };
  const source = record();
  const before = planConstruction(source, options);
  const splitSegment = source.path.segments[1];
  const inserted = {
    ...source,
    revision: source.revision + 1,
    path: insertCubicBezierAnchor(source.path, splitSegment.id, 0.5),
  };
  const after = planConstruction(inserted, options);

  // The wall really did change: the split segment re-partitions.
  assert.notEqual(after.contentHash, before.contentHash);

  // Every module on a segment downstream of the split keeps its stable id, its
  // hash and its stones.
  const downstream = new Set(source.path.segments.slice(2).map(({ id }) => id));
  const upstreamCount = (plan) => plan.modules
    .filter(({ segmentId }) => !downstream.has(segmentId)).length;
  assert.ok(
    upstreamCount(after) > upstreamCount(before),
    'the fixture must add a module ahead of the downstream segments, or it no '
    + 'longer exercises the flat-array seed bug',
  );

  const beforeHashes = hashById(before);
  const beforeGeometry = placementsById(before);
  let compared = 0;
  for (const module of after.modules) {
    if (!downstream.has(module.segmentId)) continue;
    assert.ok(beforeHashes.has(module.id), `${module.id} lost its stable id`);
    assert.equal(module.contentHash, beforeHashes.get(module.id), `${module.id} hash moved`);
    assertSameGeometry(
      module.placements,
      beforeGeometry.get(module.id),
      1e-9,
      `${module.id} placement`,
    );
    compared += 1;
  }
  assert.ok(compared >= 4, `expected several downstream modules, compared ${compared}`);
});
