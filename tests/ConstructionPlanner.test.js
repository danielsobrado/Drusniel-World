import assert from 'node:assert/strict';
import test from 'node:test';
import { planConstruction } from '../src/editor/construction/planning/ConstructionPlanner.js';
import {
  createCubicBezierPathFromStroke,
  insertCubicBezierAnchor,
} from '../src/editor/construction/curve/CubicBezierPath.js';

function record() {
  return {
    version: 1,
    id: 'construction-1',
    revision: 3,
    seed: 11,
    kind: 'wall',
    label: 'Planner wall',
    style: { key: 'coursed-rubble', version: 1 },
    dimensions: { height: 4, thickness: 1 },
    path: createCubicBezierPathFromStroke([
      [0, 0],
      [10, 4],
      [25, 0],
      [36, 3],
    ], { simplifyTolerance: 0.01 }),
    features: [],
    // A flat, capped top: an unset `top` now defaults to an irregular, uncapped
    // crown (commit dc4406ef), which would leave ragged top courses.
    top: { style: 'flat', base: 4, profile: [] },
  };
}

/**
 * Whether two modules' generated placements agree to `epsilon`.
 *
 * `contentHash` quantises positions to 0.1 mm and re-sampling a Bézier can
 * perturb an untouched stone in the last few bits (measured ~1e-17 on the
 * modules this file calls "untouched"), so "the stones are the same" means
 * "equal to within the hash's own quantum", not "bit-identical".
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

test('construction planning emits stable bounded semantic modules', () => {
  const first = planConstruction(record(), { maxModuleLength: 8 });
  const second = planConstruction(record(), { maxModuleLength: 8 });
  assert.deepEqual(first, second);
  assert.equal(first.constructionRevision, 3);
  assert.ok(first.totalLength > 25);
  assert.ok(first.modules.length >= 4);
  assert.equal(new Set(first.modules.map(({ id }) => id)).size, first.modules.length);
  for (const module of first.modules) {
    assert.ok(module.pathInterval[1] > module.pathInterval[0]);
    assert.ok(module.bounds.maxX > module.bounds.minX);
    assert.ok(module.bounds.maxZ > module.bounds.minZ);
  }
});

test('modules tile the whole wall with no gap between them', () => {
  // Module intervals used to come from each segment's own sampled points, but
  // the sampler drops every segment's duplicated first point — so segment n+1
  // started strictly after segment n ended, and each joint left an unwalled
  // sliver. It is visible in a finished wall as a vertical gap at every
  // segment boundary, and nothing inside the masonry packer can close it.
  const plan = planConstruction(record(), { maxModuleLength: 8 });
  const intervals = plan.modules.map(({ pathInterval }) => pathInterval);
  assert.ok(intervals.length > 3);

  assert.ok(Math.abs(intervals[0][0]) < 1e-9, 'the first module must start at the wall start');
  assert.ok(
    Math.abs(intervals.at(-1)[1] - plan.totalLength) < 1e-9,
    'the last module must end at the wall end',
  );
  for (let index = 1; index < intervals.length; index += 1) {
    const gap = intervals[index][0] - intervals[index - 1][1];
    assert.ok(
      Math.abs(gap) < 1e-9,
      `modules ${index - 1} and ${index} leave a ${gap.toFixed(4)} m gap`,
    );
  }
});

test('masonry covers every course from wall start to wall end', () => {
  const plan = planConstruction(record(), { maxModuleLength: 8 });
  // Grouped by course and then by base cell: `CourseLattice` can cut a cell into
  // several stones, so it is the cells that tile the course. Keyed on
  // `courseIndex` rather than on `heightRatio`, which a ramped bed joint no
  // longer holds constant along a course.
  const courses = new Map();
  for (const module of plan.modules) {
    for (const placement of module.placements ?? []) {
      if (placement.category !== 'field') continue;
      if (!courses.has(placement.courseIndex)) courses.set(placement.courseIndex, new Map());
      const cells = courses.get(placement.courseIndex);
      // `cellIndex` is module-local, so qualify it before pooling modules.
      const key = `${module.id}:${placement.cellIndex}`;
      const leaves = cells.get(key);
      if (leaves) leaves.push(placement);
      else cells.set(key, [placement]);
    }
  }
  assert.ok(courses.size >= 4, 'the fixture should have several courses');
  for (const [courseIndex, cells] of courses) {
    const spans = [...cells.values()]
      .map((leaves) => [
        Math.min(...leaves.map((leaf) => leaf.s - leaf.packedWidth / 2)),
        Math.max(...leaves.map((leaf) => leaf.s + leaf.packedWidth / 2)),
      ])
      .sort((a, b) => a[0] - b[0]);
    assert.ok(
      Math.abs(spans[0][0]) < 1e-6,
      `course ${courseIndex} does not reach the wall start`,
    );
    assert.ok(
      Math.abs(spans.at(-1)[1] - plan.totalLength) < 1e-6,
      `course ${courseIndex} does not reach the wall end`,
    );
    for (let index = 1; index < spans.length; index += 1) {
      const gap = spans[index][0] - spans[index - 1][1];
      assert.ok(Math.abs(gap) < 1e-6, `course ${courseIndex} has a ${gap.toFixed(4)} m hole`);
    }
  }
});

test('an edit that does not re-parameterise the wall leaves unrelated modules untouched', () => {
  // The locality the README promises: "Local edits stay local. Every command
  // declares its dirty segments and every module carries a content hash; the
  // view rebuilds only hash-changed modules."
  //
  // `insert_anchor` is the edit that actually honours it. It splits one segment
  // with de Casteljau, which reproduces the wall's curve *exactly*, so the arc
  // domain (and therefore every other segment's `[from, to]`) is unchanged and
  // every module on a segment the split never reached keeps its content hash
  // *and* its stones. Measured on this fixture at maxModuleLength 8: totalLength
  // 37.9672 m before and after, the four modules on segments 2 and 3 identical
  // to within ~2.8e-17 m, and only the split pair on segment 1 rebuilding.
  //
  // Contrast the length-changing endpoint move below, which re-parameterises the
  // whole wall and so legitimately re-grids far modules too.
  const source = record();
  const before = planConstruction(source, { maxModuleLength: 8 });
  const splitSegmentId = source.path.segments[0].id;
  const splitPath = insertCubicBezierAnchor(source.path, splitSegmentId, 0.5);
  const after = planConstruction(
    { ...structuredClone(source), path: splitPath },
    { maxModuleLength: 8 },
  );

  const beforeHashes = new Map(before.modules.map(({ id, contentHash }) => [id, contentHash]));
  const beforePlacements = new Map(before.modules.map(({ id, placements }) => [id, placements]));
  // The segments the split cannot touch: everything downstream of the split.
  const untouched = new Set(source.path.segments.slice(1).map(({ id }) => id));

  let preserved = 0;
  let changed = 0;
  for (const module of after.modules) {
    const originalHash = beforeHashes.get(module.id);
    if (originalHash === undefined) continue; // the new half of the split has a fresh id
    if (untouched.has(module.segmentId)) {
      assert.equal(
        module.contentHash,
        originalHash,
        `${module.id} hash moved with a distant split`,
      );
      assert.ok(
        placementsMatch(module.placements, beforePlacements.get(module.id)),
        `${module.id} stones moved with a distant split`,
      );
      preserved += 1;
      continue;
    }
    if (module.contentHash !== originalHash) changed += 1;
  }
  assert.ok(preserved >= 3, `expected several untouched modules, got ${preserved}`);
  assert.ok(changed > 0, 'the split segment itself must rebuild');
  assert.notEqual(before.contentHash, after.contentHash);
  assert.ok(
    Math.abs(after.totalLength - before.totalLength) < 1e-9,
    'de Casteljau must preserve the wall length',
  );
});

// A distant length-changing path edit legitimately re-grids far modules, and
// that is not a regression: the masonry course lattice (`moduleCourseRange`, the
// bed ramp and the joint lean) resolves in the wall's *absolute* arc coordinate,
// so moving anchor 0 re-parameterises the wall even though the distant
// centreline never moves. Measured on this fixture at maxModuleLength 8: moving
// anchor 0 from [0, 0] to [0, -4] grows totalLength 37.9672 m -> 40.1820 m and
// re-grids all six modules (2 per segment) — e.g. segment-3-span-1 moves its
// interval [26.483, 32.225] -> [28.697, 34.440] and its stones 77 -> 82, and
// segment-3-span-2 moves [32.225, 37.967] -> [34.440, 40.182], 88 -> 95 stones.
// What must hold here is only the *soundness* contract the renderer's cache key
// rests on: identical hash ⇒ identical geometry, i.e. a module whose stones
// moved must carry a new hash. The stronger locality goal — far modules
// bit-identical through a length change — needs the stable local layout origin
// described in `docs/plans/tiny-glade-wall-builder/phase-11-look-feel-and-usability.md`
// §9.4 ("Stable masonry through edits"). That was deliberately deferred: keying
// the lattice on a per-segment origin would break the wall-global course-grid
// seam continuity that `tests/ConstructionMasonry.test.js` ("adjacent modules
// share a course grid so courses do not step") depends on, so the bed ramp and
// joint lean would step at every seam. This test therefore asserts the
// soundness invariant, never the stale-hash form.
test('a length-changing endpoint move moves a far module\u2019s hash with its geometry', () => {
  const source = record();
  const before = planConstruction(source, { maxModuleLength: 8 });
  const changed = structuredClone(source);
  changed.path.anchors[0].position[1] = -4;
  changed.revision += 1;
  const after = planConstruction(changed, { maxModuleLength: 8 });

  const beforeMap = new Map(before.modules.map((module) => [module.id, module]));
  let compared = 0;
  let reGridded = 0;
  let farReGridded = 0;
  for (const module of after.modules) {
    const original = beforeMap.get(module.id);
    if (!original) continue;
    compared += 1;
    if (placementsMatch(module.placements, original.placements)) {
      // Equal hash ⇒ equal geometry: a module the move never reached is safe to
      // reuse, so its hash may not move either.
      assert.equal(
        module.contentHash,
        original.contentHash,
        `${module.id} kept its stones but moved its hash`,
      );
      continue;
    }
    reGridded += 1;
    // The soundness fix: geometry moved ⇒ hash moved. Asserting the converse
    // (a far module keeps its hash) is the unsound assumption this replaced.
    assert.notEqual(
      module.contentHash,
      original.contentHash,
      `${module.id} re-gridded without changing its hash`,
    );
    if (module.segmentId === 'segment-3') farReGridded += 1;
  }
  assert.ok(compared >= 4, `expected surviving modules, got ${compared}`);
  assert.ok(reGridded > 0, 'the length change must re-grid some module');
  assert.ok(farReGridded > 0, 'the length change must re-grid a distant segment-3 module');
});

test('a material swap leaves geometry hashes unchanged', () => {
  const source = record();
  const before = planConstruction(source, { maxModuleLength: 8 });
  const painted = structuredClone(source);
  painted.style.materials = { stone: 'granite-masonry', mortar: null, roof: null };
  painted.revision += 1;
  const after = planConstruction(painted, { maxModuleLength: 8 });

  assert.equal(after.contentHash, before.contentHash);
  assert.equal(before.modules.length, after.modules.length);
  for (let index = 0; index < before.modules.length; index += 1) {
    assert.equal(before.modules[index].contentHash, after.modules[index].contentHash);
    assert.deepEqual(before.modules[index].pathInterval, after.modules[index].pathInterval);
    assert.deepEqual(before.modules[index].placements, after.modules[index].placements);
  }
});

test('a top profile edit only reaches the modules it interpolates across', () => {
  // The raise gesture writes bracketing control points at base height on either
  // side of the edit, which is what confines it. Without brackets a lone
  // control point sets the whole wall, because the profile clamps outside its
  // outermost point — so this test uses the shape the gesture actually emits.
  const lastSegmentId = record().path.segments.at(-1).id;
  const hashesOf = (shoulder, peak) => {
    const source = record();
    source.top = {
      style: 'flat',
      base: 4,
      profile: [
        { segmentId: lastSegmentId, arcFraction: 0.5, height: 4 },
        { segmentId: lastSegmentId, arcFraction: 0.65, height: shoulder },
        { segmentId: lastSegmentId, arcFraction: 0.8, height: peak },
        { segmentId: lastSegmentId, arcFraction: 0.95, height: 4 },
      ],
    };
    return new Map(
      planConstruction(source, { maxModuleLength: 8 })
        .modules.map(({ id, contentHash }) => [id, contentHash]),
    );
  };

  const base = hashesOf(4, 5);
  const ids = [...base.keys()];

  // A shoulder moved under the peak, and a raise that lifts the peak itself.
  // Both stay local, including the second: the course grid is the style's course
  // height flat, so no top edit can re-space the courses on a module the edit
  // never reached. Deriving the grid from the wall's tallest point instead made
  // every raise a whole-wall rebuild.
  for (const [label, changed] of [
    ['shoulder', hashesOf(4.6, 5)],
    ['peak', hashesOf(4, 7)],
  ]) {
    assert.equal(
      changed.get(ids[0]),
      base.get(ids[0]),
      `a ${label} edit at the far end reached the near end`,
    );
    assert.notEqual(changed.get(ids.at(-1)), base.get(ids.at(-1)));
  }
});

test('editing one segment leaves other segment module IDs stable', () => {
  const source = record();
  const before = planConstruction(source, { maxModuleLength: 8 });
  const changed = structuredClone(source);
  changed.path.anchors[0].position[1] = -4;
  changed.revision += 1;
  const after = planConstruction(changed, { maxModuleLength: 8 });
  const lastSegmentId = source.path.segments.at(-1).id;
  assert.deepEqual(
    before.modules.filter(({ segmentId }) => segmentId === lastSegmentId).map(({ id }) => id),
    after.modules.filter(({ segmentId }) => segmentId === lastSegmentId).map(({ id }) => id),
  );
});
