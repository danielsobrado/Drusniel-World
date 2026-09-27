import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeConstructionRecord } from '../src/editor/construction/ConstructionSchema.js';
import {
  createCubicBezierPathFromStroke,
  sampleCubicBezierPath,
} from '../src/editor/construction/curve/CubicBezierPath.js';
import { planConstruction } from '../src/editor/construction/planning/ConstructionPlanner.js';
import { ConstructionStore } from '../src/editor/construction/ConstructionStore.js';
import { executeConstructionCommand } from '../src/editor/construction/ConstructionCommands.js';

/**
 * The module content hash is the renderer's cache key, and the contract is
 * *equal hash ⇒ identical generated geometry*. A cross-cutting review found the
 * hash incomplete in a specific way: the masonry lattice (`CourseLattice`,
 * `moduleCourseRange`), the bed ramp and the joint lean all resolve in the
 * wall's **absolute** arc coordinate, so re-parameterising the wall — moving a
 * distant anchor, extending an end — re-rolls stones that never physically
 * moved, while the module's hash (which omitted the module's arc range and the
 * neighbouring shape the curvature reads) stayed put. The renderer then kept
 * stale stones and swapped them visibly on the next rebuild.
 *
 * These tests pin the restored guarantee. They deliberately do *not* assert the
 * stronger locality goal ("a length change leaves far modules bit-identical"):
 * that needs the lattice keyed on a stable local origin, which is not
 * expressible without breaking the wall-global seam continuity the bed ramp and
 * joint lean rely on, and is left as future work.
 */

const SEGMENT_PREFIX = 'construction-1-segment';
const ANCHOR_PREFIX = 'construction-1-anchor';

function strokePoints(lastAnchorX = 32) {
  return [[0, 0], [8, 1], [16, -1], [24, 2], [lastAnchorX, 0]];
}

function record({
  seed = 11,
  thickness = 0.8,
  top = { style: 'flat', base: 3.5, profile: [] },
  lastAnchorX = 32,
} = {}) {
  return normalizeConstructionRecord({
    version: 1,
    id: 'construction-1',
    revision: 1,
    seed,
    kind: 'wall',
    label: 'Arc domain wall',
    style: { key: 'coursed-rubble', version: 1, materials: {} },
    dimensions: { height: 3.5, thickness },
    top,
    path: createCubicBezierPathFromStroke(strokePoints(lastAnchorX), {
      simplifyTolerance: 0.001,
      anchorPrefix: ANCHOR_PREFIX,
      segmentPrefix: SEGMENT_PREFIX,
    }),
    features: [],
  });
}

function storeWith(source) {
  const store = new ConstructionStore();
  executeConstructionCommand(store, { type: 'create', record: source });
  return store;
}

function plan(store) {
  return planConstruction(store.get('construction-1'), { maxModuleLength: 8 });
}

function moduleMap(planned) {
  return new Map(planned.modules.map((module) => [module.id, module]));
}

/** Deep equality with a numeric tolerance, as a predicate. */
function sameGeometry(actual, expected, epsilon, where) {
  if (Array.isArray(actual) || Array.isArray(expected)) {
    if (!Array.isArray(actual) || !Array.isArray(expected) || actual.length !== expected.length) {
      return false;
    }
    return actual.every((value, index) => sameGeometry(value, expected[index], epsilon, where));
  }
  if (actual && expected && typeof actual === 'object') {
    const keys = Object.keys(actual);
    if (keys.length !== Object.keys(expected).length) return false;
    return keys.every((key) => (
      Object.hasOwn(expected, key) && sameGeometry(actual[key], expected[key], epsilon, where)
    ));
  }
  if (typeof actual === 'number' && typeof expected === 'number') {
    return Object.is(actual, expected) || Math.abs(actual - expected) <= epsilon;
  }
  return actual === expected;
}

/**
 * Whether two modules' placements are the same up to `epsilon`.
 *
 * The planner's hash quantises positions to 0.1 mm and re-sampling a Bézier can
 * perturb a saved stone in the last few bits, so "the stones moved" has to mean
 * "moved more than that".
 */
function placementsMatch(actual, expected, epsilon = 1e-6) {
  return sameGeometry(actual, expected, epsilon, 'placement');
}

function moveAnchor(store, anchorIndex, position) {
  executeConstructionCommand(store, {
    type: 'move_anchor',
    constructionId: 'construction-1',
    anchorId: store.get('construction-1').path.anchors[anchorIndex].id,
    position,
  });
}

function segmentSamples(source) {
  const sampled = sampleCubicBezierPath(source.path);
  const bySegment = new Map();
  for (const point of sampled.points) {
    if (!bySegment.has(point.segmentId)) bySegment.set(point.segmentId, []);
    bySegment.get(point.segmentId).push([point.x, point.z, point.tangentX, point.tangentZ]);
  }
  return bySegment;
}

// ---------------------------------------------------------------------------
// The core defect: a distant endpoint move re-grids far modules silently
// ---------------------------------------------------------------------------

test('a distant endpoint move never re-grids a module without moving its hash', () => {
  // Fixture and numbers from the review: five anchors, seed 11, thickness 0.8,
  // maxModuleLength 8. Moving anchor 0 from [0,0] to [0,-3] used to change
  // segment-3/4 spans (71→74, 69→68, 53→57 stones) without changing a single
  // content hash.
  const store = storeWith(record());
  const before = plan(store);
  moveAnchor(store, 0, { x: 0, z: -3 });
  const after = plan(store);

  const beforeMap = moduleMap(before);
  let compared = 0;
  let farMoved = 0;
  for (const module of after.modules) {
    const original = beforeMap.get(module.id);
    if (!original) continue;
    compared += 1;
    const moved = !placementsMatch(module.placements, original.placements);
    if (!moved) {
      // Equal hash ⇒ equal geometry: reuse is safe.
      assert.equal(
        module.contentHash,
        original.contentHash,
        `${module.id} kept its stones but moved its hash`,
      );
      continue;
    }
    assert.notEqual(
      module.contentHash,
      original.contentHash,
      `${module.id} re-gridded without changing its hash`,
    );
    if (module.segmentId.includes('segment-3')) farMoved += 1;
  }
  assert.ok(compared >= 4, `expected surviving modules, got ${compared}`);
  assert.ok(farMoved > 0, 'the distant move must actually re-grid a far module');
});

test('equal contentHash implies byte-identical geometry across an interior merge', () => {
  // An interior edit re-parameterises only the tail, so the leading segment's
  // modules keep their hash *and* must keep their stones bit-for-bit: that is
  // what makes it safe for the renderer to reuse them.
  const store = storeWith(record());
  const before = plan(store);
  executeConstructionCommand(store, {
    type: 'delete_anchor',
    constructionId: 'construction-1',
    anchorId: store.get('construction-1').path.anchors[2].id,
  });
  const after = plan(store);

  const beforeMap = moduleMap(before);
  let shared = 0;
  for (const module of after.modules) {
    const original = beforeMap.get(module.id);
    if (!original) continue;
    if (module.contentHash !== original.contentHash) continue;
    shared += 1;
    assert.ok(
      placementsMatch(module.placements, original.placements, 0),
      `${module.id} shares a hash but not its stones`,
    );
  }
  // The leading segment's parameterisation is untouched, so the fixture must
  // exercise the reuse path rather than pass vacuously.
  assert.ok(shared > 0, 'expected some module to keep its hash through the merge');
});

test('the hash covers the arc domain the lattice keys on, not just the module centreline', () => {
  // The distant segment's own samples are unchanged by the move — only the
  // wall's arc parameterisation shifts — so only an arc-domain-aware hash can
  // tell that its stones moved.
  const store = storeWith(record());
  const before = plan(store);
  const beforeSamples = segmentSamples(store.get('construction-1'));
  moveAnchor(store, 0, { x: 0, z: -3 });
  const after = plan(store);
  const afterSamples = segmentSamples(store.get('construction-1'));

  // Guard: the far segment's centreline really is untouched.
  for (const segmentId of ['construction-1-segment-3', 'construction-1-segment-4']) {
    assert.deepEqual(
      afterSamples.get(segmentId),
      beforeSamples.get(segmentId),
      `${segmentId} moved, so this fixture no longer isolates the arc domain`,
    );
  }

  const beforeMap = moduleMap(before);
  const distant = after.modules.filter((module) => module.segmentId.includes('segment-4'));
  assert.ok(distant.length > 0, 'fixture must have a distant segment-4 module');
  let moved = 0;
  for (const module of distant) {
    const original = beforeMap.get(module.id);
    if (!original || placementsMatch(module.placements, original.placements)) continue;
    moved += 1;
    assert.notEqual(
      module.contentHash,
      original.contentHash,
      `${module.id} moved with the arc domain but kept its hash`,
    );
  }
  assert.ok(moved > 0, 'the arc-domain move must reach a distant module');
});

// ---------------------------------------------------------------------------
// Sibling finding: a no-op top point leaked into unrelated modules' hashes
// ---------------------------------------------------------------------------

test('a no-op top point at base height does not move modules it never reaches', () => {
  const lastSegment = record().path.segments.at(-1).id;
  const store = storeWith(record());
  const before = plan(store);
  // Semantically a no-op: a single control point at the base height on the far
  // segment reshapes nothing.
  executeConstructionCommand(store, {
    type: 'set_top_profile',
    constructionId: 'construction-1',
    top: {
      style: 'flat',
      base: 3.5,
      profile: [{ segmentId: lastSegment, arcFraction: 0.5, height: 3.5 }],
    },
  });
  const after = plan(store);

  const beforeMap = moduleMap(before);
  let unrelated = 0;
  for (const module of after.modules) {
    // Everything on the first three segments lies wholly before the new point.
    if (!module.segmentId.includes('segment-3')) continue;
    const original = beforeMap.get(module.id);
    if (!original) continue;
    unrelated += 1;
    assert.equal(
      module.contentHash,
      original.contentHash,
      `${module.id} hash moved with a point at the far end`,
    );
    assert.ok(
      placementsMatch(module.placements, original.placements, 0),
      `${module.id} stones moved with a point at the far end`,
    );
  }
  assert.ok(unrelated > 0, 'fixture must have modules before the new point');
});

// ---------------------------------------------------------------------------
// Sibling finding: a distant top raise re-normalised every stone's weathering
// ---------------------------------------------------------------------------

test('a distant top raise does not move far stones\u2019 geometry or weathering ratio', () => {
  const lastSegment = record().path.segments.at(-1).id;
  const profile = (peak) => [
    { segmentId: lastSegment, arcFraction: 0.5, height: 3.5 },
    { segmentId: lastSegment, arcFraction: 0.65, height: 3.5 },
    { segmentId: lastSegment, arcFraction: 0.8, height: peak },
    { segmentId: lastSegment, arcFraction: 0.95, height: 3.5 },
  ];
  const store = storeWith(record({ top: { style: 'flat', base: 3.5, profile: profile(5) } }));
  const before = plan(store);
  executeConstructionCommand(store, {
    type: 'set_top_profile',
    constructionId: 'construction-1',
    top: { style: 'flat', base: 3.5, profile: profile(6) },
  });
  const after = plan(store);

  const beforeMap = moduleMap(before);
  const far = (module) => !module.segmentId.includes('segment-4');
  let stones = 0;
  for (const module of after.modules) {
    if (!far(module)) continue;
    const original = beforeMap.get(module.id);
    if (!original) continue;
    assert.equal(module.contentHash, original.contentHash, `${module.id} hash moved with a raise`);
    for (const placement of module.placements ?? []) {
      const source = (original.placements ?? []).find(
        (candidate) => candidate.stableIndex === placement.stableIndex,
      );
      if (!source) continue;
      stones += 1;
      // `heightRatio` is the weathering/shading input; byte-for-byte equal.
      assert.equal(
        placement.heightRatio,
        source.heightRatio,
        `${module.id}.${placement.stableIndex} re-normalised its weathering ratio`,
      );
    }
  }
  assert.ok(stones > 100, `expected many far stones, got ${stones}`);
});

// ---------------------------------------------------------------------------
// A neighbour's shape reaches into a module through the curvature difference
// ---------------------------------------------------------------------------

test('a module\u2019s hash sees the neighbouring segment\u2019s shape at the seam', () => {
  // `CurveArcTable.curvatureAt` is a finite difference that reaches 0.1 m past
  // the range, and the stone width is capped by the peak curvature. Merging the
  // two interior segments therefore changes the widths packed into the first
  // segment's last span at the seam — a generation input the module's own arc
  // range does not show.
  const store = storeWith(record());
  const before = plan(store);
  const segments = store.get('construction-1').path.segments.map(({ id }) => id);
  executeConstructionCommand(store, {
    type: 'delete_anchor',
    constructionId: 'construction-1',
    anchorId: store.get('construction-1').path.anchors[2].id,
  });
  const after = plan(store);

  const beforeMap = moduleMap(before);
  let reGridded = 0;
  const wide = new Set([segments[0], segments.at(-1)]);
  for (const module of after.modules) {
    if (!wide.has(module.segmentId)) continue;
    const original = beforeMap.get(module.id);
    if (!original) continue;
    if (placementsMatch(module.placements, original.placements)) continue;
    reGridded += 1;
    assert.notEqual(
      module.contentHash,
      original.contentHash,
      `${module.id} re-gridded at the seam without moving its hash`,
    );
  }
  assert.ok(reGridded > 0, 'the merge must re-grid a module that touches the seam');
});
