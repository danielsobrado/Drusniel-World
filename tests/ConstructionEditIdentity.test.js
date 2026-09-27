import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { normalizeConstructionRecord } from '../src/editor/construction/ConstructionSchema.js';
import {
  createCubicBezierPathFromStroke,
  sampleCubicBezierPath,
} from '../src/editor/construction/curve/CubicBezierPath.js';
import { planConstruction } from '../src/editor/construction/planning/ConstructionPlanner.js';
import { createCurveArcTable } from '../src/editor/construction/masonry/CurveArcTable.js';
import { constructionStyle } from '../src/editor/construction/masonry/ConstructionStyleCatalog.js';
import { coarsePlacementsForModule } from '../src/editor/construction/render/ConstructionCoarsePlacements.js';
import {
  buildWallGeometry,
  sampleShellPath,
} from '../src/editor/construction/render/ConstructionShell.js';
import { buildModuleMasonry } from '../src/editor/construction/compile/ConstructionMasonryBuilder.js';
import {
  createConstructionMaterials,
  disposeConstructionMaterials,
} from '../src/editor/construction/render/ConstructionMaterials.js';
import { selectConstructionLod } from '../src/editor/construction/render/ConstructionLod.js';
import { moduleBuildKey } from '../src/editor/construction/compile/ConstructionLodState.js';
import { ConstructionStore } from '../src/editor/construction/ConstructionStore.js';
import { executeConstructionCommand } from '../src/editor/construction/ConstructionCommands.js';
import {
  uncoveredFaceShare,
  wallOpenings,
} from '../scripts/lib/constructionFaceCoverage.mjs';

/**
 * Cross-cutting invariants that span the individual wall-builder fixes:
 *
 *  - identity and geometry are preserved through a sequence of edits, and only
 *    the edit's own neighbourhood may move (phase 11: "A local edit preserves
 *    unaffected cell identities, colors and decoration keys");
 *  - equal `contentHash` means byte-identical generated geometry (the cache-key
 *    contract `ConstructionView` relies on);
 *  - near, coarse and shell agree about the opening silhouette, so a distance
 *    transition can neither open nor close a passage (phase 10 "coarse
 *    face-coverage gate" and the phase 11 note that every LOD transition
 *    preserves the opening masks);
 *  - save/load and edit/undo reconstruct the same authored state and the same
 *    deterministic plan, and a save never carries generated masonry.
 */

const ORIGIN = { x: 0, z: 0 };
const SEGMENT_PREFIX = 'construction-1-segment';
const ANCHOR_PREFIX = 'construction-1-anchor';

/** A five-anchor, four-segment wall — enough segments for an edit at one end
 *  to leave a genuinely distant span. */
function strokePoints(lastAnchorX = 32) {
  return [[0, 0], [8, 1], [16, -1], [24, 2], [lastAnchorX, 0]];
}

function baseRecord({
  styleKey = 'coursed-rubble',
  thickness = 0.8,
  seed = 11,
  features = [],
  top = { style: 'flat', base: 3.5, profile: [] },
  lastAnchorX = 32,
} = {}) {
  return normalizeConstructionRecord({
    version: 1,
    id: 'construction-1',
    revision: 1,
    seed,
    kind: 'wall',
    label: 'Identity wall',
    style: { key: styleKey, version: 1, materials: {} },
    dimensions: { height: 3.5, thickness },
    top,
    path: createCubicBezierPathFromStroke(strokePoints(lastAnchorX), {
      simplifyTolerance: 0.001,
      anchorPrefix: ANCHOR_PREFIX,
      segmentPrefix: SEGMENT_PREFIX,
    }),
    features,
  });
}

function storeWith(record = baseRecord()) {
  const store = new ConstructionStore();
  executeConstructionCommand(store, { type: 'create', record });
  return store;
}

function plan(store) {
  return planConstruction(store.get('construction-1'), { maxModuleLength: 8 });
}

function moduleMap(planData) {
  return new Map(planData.modules.map((module) => [module.id, module]));
}

/**
 * Exact equality of two modules' generated placements.
 *
 * `contentHash` is the renderer's cache key, so "the placements are identical"
 * here means byte-for-byte: no numeric tolerance, because a tolerant comparison
 * would let the very drift the hash is supposed to rule out slip through.
 */
function samePlacements(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

/**
 * Whether two modules' placements are the same up to `epsilon`.
 *
 * Re-sampling a Bézier can perturb a saved stone's coordinates in the last few
 * bits, and the planner's hash quantises positions to 0.1 mm, so "the stones
 * moved" has to mean "moved more than that", not "differs in the 12th decimal".
 */
function placementsMatch(actual, expected, epsilon = 1e-6) {
  try {
    assertSameGeometry(actual, expected, epsilon, 'placements');
    return true;
  } catch {
    return false;
  }
}

/**
 * Deep equality with a numeric tolerance. Byte-identical for `epsilon = 0`,
 * tolerant enough that the Bézier sampler's re-sampling cannot masquerade as a
 * geometry change.
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
    for (const key of keys) assertSameGeometry(actual[key], expected[key], epsilon, `${where}.${key}`);
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

/**
 * A fingerprint of one module's real, generated masonry geometry: the meshed
 * vertex positions and indices, not just the plan record. Built with the same
 * builder the near LOD uses.
 */
function moduleGeometryFingerprint(record, module) {
  const arcTable = createCurveArcTable(sampleCubicBezierPath(record.path));
  const materials = createConstructionMaterials(record);
  try {
    const built = buildModuleMasonry(module.placements ?? [], {
      record,
      materials,
      arcTable,
      moduleOrigin: ORIGIN,
      groundHeightAt: () => 0,
    });
    const chunks = [];
    for (const mesh of built.meshes) {
      chunks.push([...mesh.geometry.getAttribute('position').array].map((n) => n.toFixed(6)).join(','));
      const index = mesh.geometry.getIndex();
      chunks.push(index ? [...index.array].join(',') : '');
      mesh.geometry.dispose();
    }
    return chunks.join('|');
  } finally {
    disposeConstructionMaterials();
  }
}

/** Modules on `segmentIds` that exist in both plans, paired before/after. */
function farPairs(beforePlan, afterPlan, segmentIds) {
  const after = moduleMap(afterPlan);
  const pairs = [];
  for (const module of beforePlan.modules) {
    if (!segmentIds.includes(module.segmentId)) continue;
    const changed = after.get(module.id);
    if (changed) pairs.push([module, changed]);
  }
  return pairs;
}

function segmentIdsOf(record) {
  return record.path.segments.map(({ id }) => id);
}

// ---------------------------------------------------------------------------
// 1. Identity through edits
// ---------------------------------------------------------------------------

test('a sequence of path edits keeps distant modules bit-identical where their parameterisation is preserved', () => {
  const store = storeWith();
  const record = () => store.get('construction-1');

  // --- insert an anchor on the first segment -------------------------------
  // The split preserves the curve exactly, so a module wholly on a *downstream*
  // segment must keep its id, its hash and its stones.
  {
    const before = plan(store);
    const segments = segmentIdsOf(record());
    executeConstructionCommand(store, {
      type: 'insert_anchor',
      constructionId: 'construction-1',
      segmentId: segments[0],
      t: 0.5,
    });
    const after = plan(store);
    const downstream = segmentIdsOf(record()).slice(2); // skip the split pair
    const pairs = farPairs(before, after, downstream);
    assert.ok(pairs.length >= 2, `expected downstream modules, got ${pairs.length}`);
    for (const [b, a] of pairs) {
      assert.equal(a.contentHash, b.contentHash, `${b.id} hash moved`);
      assertSameGeometry(a.placements, b.placements, 1e-9, `${b.id} placement`);
    }
    // The edit really did something: the plan changed and a segment was added.
    assert.notEqual(after.contentHash, before.contentHash, 'the split must change the plan');
    assert.equal(
      segmentIdsOf(record()).length,
      segments.length + 1,
      'the split must add a segment',
    );
  }

  // --- move the first anchor -----------------------------------------------
  // The move re-solves the handles through the moved anchor and the segment
  // beyond it. Because the masonry lattice resolves in *absolute* arc
  // coordinates it also re-parameterises every downstream module, so a distant
  // module's stones can move without its own centreline changing. What must hold
  // is the cache-key contract, no matter how far the re-parameterisation
  // reaches: a module whose generated geometry moved must carry a new hash, so
  // the renderer can never keep a stale mesh and swap it in later.
  {
    const before = plan(store);
    const anchorId = record().path.anchors[0].id;
    executeConstructionCommand(store, {
      type: 'move_anchor',
      constructionId: 'construction-1',
      anchorId,
      position: { x: 0, z: -3 },
    });
    const after = plan(store);

    const beforeMap = moduleMap(before);
    let compared = 0;
    let moved = 0;
    for (const module of after.modules) {
      const original = beforeMap.get(module.id);
      if (!original) continue;
      compared += 1;
      if (placementsMatch(module.placements, original.placements)) continue;
      moved += 1;
      assert.notEqual(
        module.contentHash,
        original.contentHash,
        `${module.id} moved its stones but kept its hash`,
      );
    }
    assert.ok(compared >= 4, `expected surviving modules, got ${compared}`);
    // Something must actually change, or the assertion above is vacuous.
    assert.ok(moved > 0, 'the anchor move must reach some module');
  }

  // --- extend the far end --------------------------------------------------
  {
    const before = plan(store);
    const anchorId = record().path.anchors.at(-1).id;
    executeConstructionCommand(store, {
      type: 'move_anchor',
      constructionId: 'construction-1',
      anchorId,
      position: { x: 44, z: 0 },
    });
    const after = plan(store);
    const segments = segmentIdsOf(record());
    const pairs = farPairs(before, after, segments.slice(0, 2));
    assert.ok(pairs.length >= 2, `expected upstream modules, got ${pairs.length}`);
    for (const [b, a] of pairs) {
      assert.equal(a.contentHash, b.contentHash, `${b.id} identity moved with a distant extension`);
    }
  }
});

test('trimming a control point keeps distant module identity where the parameterisation survives', () => {
  const store = storeWith();
  const before = plan(store);
  const segments = segmentIdsOf(store.get('construction-1'));
  // Delete an interior anchor, merging the two segments around it. The surviving
  // end segments keep their identity and their stones; the merge re-parameterises
  // the tail, and any module it re-grids must re-hash.
  executeConstructionCommand(store, {
    type: 'delete_anchor',
    constructionId: 'construction-1',
    anchorId: store.get('construction-1').path.anchors[2].id,
  });
  const after = plan(store);
  const pairs = farPairs(before, after, [segments[0], segments.at(-1)]);
  assert.ok(pairs.length >= 2, `expected surviving distant modules, got ${pairs.length}`);
  let preserved = 0;
  for (const [b, a] of pairs) {
    if (placementsMatch(a.placements, b.placements)) {
      preserved += 1;
      assert.equal(a.contentHash, b.contentHash, `${b.id} kept its stones but moved its hash`);
      continue;
    }
    assert.notEqual(a.contentHash, b.contentHash, `${b.id} re-gridded without moving its hash`);
  }
  // The leading segment's parameterisation is untouched, so it must be preserved
  // rather than merely sound — otherwise the assertions above are vacuous.
  assert.ok(preserved > 0, 'the leading segment must survive the trim untouched');
});

test('raising a top control point leaves every other module and its geometry untouched', () => {
  const lastSegment = baseRecord().path.segments.at(-1).id;
  const profile = (peak) => [
    { segmentId: lastSegment, arcFraction: 0.5, height: 3.5 },
    { segmentId: lastSegment, arcFraction: 0.65, height: 3.5 },
    { segmentId: lastSegment, arcFraction: 0.8, height: peak },
    { segmentId: lastSegment, arcFraction: 0.95, height: 3.5 },
  ];
  // The gesture always emits bracketing control points; the base profile is
  // present on both sides of the edit so only the peak height changes.
  const store = storeWith(baseRecord({ top: { style: 'flat', base: 3.5, profile: profile(5) } }));
  const before = plan(store);
  executeConstructionCommand(store, {
    type: 'set_top_profile',
    constructionId: 'construction-1',
    top: { style: 'flat', base: 3.5, profile: profile(6) },
  });
  const after = plan(store);

  const segments = segmentIdsOf(store.get('construction-1'));
  const far = segments.slice(0, -1); // everything but the raised end
  const pairs = farPairs(before, after, far);
  assert.ok(pairs.length >= 4, `expected several far modules, got ${pairs.length}`);

  const beforeRecord = baseRecord({ top: { style: 'flat', base: 3.5, profile: profile(5) } });
  const afterRecord = store.get('construction-1');
  for (const [b, a] of pairs) {
    assert.equal(a.contentHash, b.contentHash, `${b.id} hash moved with a distant raise`);
    assert.equal(
      moduleGeometryFingerprint(afterRecord, a),
      moduleGeometryFingerprint(beforeRecord, b),
      `${b.id} mesh geometry moved with a distant raise`,
    );
  }
  // The raised end itself must change.
  const endBefore = before.modules.at(-1);
  const endAfter = moduleMap(after).get(endBefore.id);
  assert.notEqual(endAfter.contentHash, endBefore.contentHash, 'the raised end must rebuild');
});

// The stone shaping field normalises each stone's height against a height
// reference, which drives `heightRatio` — a weathering/shading input. Deriving
// that reference from the wall-wide *tallest* point meant raising a distant
// control point re-shaded every far stone even though its position and mesh were
// untouched, breaking the phase-11 clause "a local edit preserves unaffected cell
// identities, colors and decoration keys". The planner now normalises against
// the stable authored height instead, so a distant raise cannot move a far
// stone's ratio: this asserts the guarantee rather than documenting the drift.
test('a distant top raise leaves every far stone, its geometry and its shading ratio untouched', () => {
  const lastSegment = baseRecord().path.segments.at(-1).id;
  const profile = (peak) => [
    { segmentId: lastSegment, arcFraction: 0.5, height: 3.5 },
    { segmentId: lastSegment, arcFraction: 0.65, height: 3.5 },
    { segmentId: lastSegment, arcFraction: 0.8, height: peak },
    { segmentId: lastSegment, arcFraction: 0.95, height: 3.5 },
  ];
  const store = storeWith(baseRecord({ top: { style: 'flat', base: 3.5, profile: profile(5) } }));
  const beforePlan = plan(store);
  const beforeRecord = baseRecord({ top: { style: 'flat', base: 3.5, profile: profile(5) } });
  executeConstructionCommand(store, {
    type: 'set_top_profile',
    constructionId: 'construction-1',
    top: { style: 'flat', base: 3.5, profile: profile(6) },
  });
  const afterPlan = plan(store);
  const afterRecord = store.get('construction-1');

  const far = segmentIdsOf(afterRecord).slice(0, -1);
  const pairs = farPairs(beforePlan, afterPlan, far);
  assert.ok(pairs.length >= 4, `expected several far modules, got ${pairs.length}`);

  let compared = 0;
  for (const [b, a] of pairs) {
    assert.equal(a.contentHash, b.contentHash, `${b.id} hash moved with a distant raise`);
    assert.equal(
      moduleGeometryFingerprint(afterRecord, a),
      moduleGeometryFingerprint(beforeRecord, b),
      `${b.id} meshed geometry moved with a distant raise`,
    );
    // Style, shape and *weathering ratio* alike: byte-identical placements.
    assert.ok(
      samePlacements(a.placements, b.placements),
      `${b.id} placements drifted with a distant raise`,
    );
    compared += (a.placements ?? []).length;
  }
  assert.ok(compared > 100, `expected many far stones, got ${compared}`);

  // The raised end itself must still change, or the assertions above are vacuous.
  const endBefore = beforePlan.modules.at(-1);
  const endAfter = moduleMap(afterPlan).get(endBefore.id);
  assert.notEqual(endAfter.contentHash, endBefore.contentHash, 'the raised end must rebuild');
});

test('changing thickness preserves every stone identity and face geometry, changing only its depth', () => {
  const store = storeWith();
  const before = plan(store);
  executeConstructionCommand(store, {
    type: 'set_dimensions',
    constructionId: 'construction-1',
    dimensions: { thickness: 1.2 },
  });
  const after = plan(store);

  const beforeByKey = new Map();
  for (const module of before.modules) {
    for (const placement of module.placements ?? []) {
      beforeByKey.set(`${module.id}:${placement.stableIndex}`, placement);
    }
  }

  let compared = 0;
  let depthChanged = 0;
  for (const module of after.modules) {
    for (const placement of module.placements ?? []) {
      const original = beforeByKey.get(`${module.id}:${placement.stableIndex}`);
      if (!original) continue;
      compared += 1;
      // Identity and face geometry (arc position, course, cell, quad) survive a
      // thickness change; only the stone's depth into the wall moves.
      for (const key of ['stableIndex', 'cellIndex', 'courseIndex', 's', 'y', 'width', 'height', 'corners']) {
        assertSameGeometry(placement[key], original[key], 1e-9, `${module.id}.${key}`);
      }
      if (Math.abs(placement.depth - original.depth) > 1e-9) depthChanged += 1;
    }
  }
  assert.ok(compared > 100, `expected many matched stones, got ${compared}`);
  assert.ok(depthChanged > 0, 'thickness must change the stone depth');
});

// A distant path edit re-parameterises the wall's arc length, and the masonry
// grid is keyed on that absolute coordinate, so a far module's stones are
// re-rolled even though its own centreline never moved. The cache-key contract
// has to survive that: a module whose stones were re-gridded must carry a new
// hash, or the renderer keeps the stale stones and swaps them in the next
// rebuild. This is the phase-11 §9 question ("do length changes disturb
// unaffected stones?") answered — a length change may disturb them (the locality
// goal, `ConstructionPlanner.test.js`'s ideal), but it must never do so
// silently.
test('a distant endpoint move that re-grids a far module moves its hash with it', () => {
  const store = storeWith();
  const before = plan(store);
  const anchorId = store.get('construction-1').path.anchors[0].id;
  executeConstructionCommand(store, {
    type: 'move_anchor',
    constructionId: 'construction-1',
    anchorId,
    position: { x: 0, z: -3 },
  });
  const after = plan(store);

  const beforeMap = moduleMap(before);
  const afterMap = moduleMap(after);
  const distant = after.modules.filter((module) => module.segmentId.includes('segment-3'));
  assert.ok(distant.length > 0, 'fixture must have a distant segment-3 module');

  let reGridded = 0;
  for (const module of distant) {
    const original = beforeMap.get(module.id);
    if (!original) continue;
    if (placementsMatch(module.placements, original.placements)) {
      // Equal hash ⇒ equal geometry: a module that did not move is safe to reuse.
      assert.equal(
        module.contentHash,
        original.contentHash,
        `${module.id} kept its stones but moved its hash`,
      );
      continue;
    }
    reGridded += 1;
    // The soundness fix: the renderer's key moved with the stones.
    assert.notEqual(
      module.contentHash,
      original.contentHash,
      `${module.id} re-gridded without changing its hash`,
    );
    assert.notEqual(
      module.placements.length,
      original.placements.length,
      `${module.id} changed without changing its stone count`,
    );
  }
  assert.ok(reGridded > 0, 'the re-parameterisation must actually re-grid a far module');

  // The renderer rebuilds through the build key: both the revision and the (now
  // moved) content hash take part.
  const keyBefore = moduleBuildKey({
    constructionId: before.constructionId,
    revision: before.constructionRevision,
    moduleId: distant[0].id,
    contentHash: beforeMap.get(distant[0].id).contentHash,
    requestedBand: 'near',
  });
  const keyAfter = moduleBuildKey({
    constructionId: after.constructionId,
    revision: after.constructionRevision,
    moduleId: distant[0].id,
    contentHash: afterMap.get(distant[0].id).contentHash,
    requestedBand: 'near',
  });
  assert.notEqual(keyAfter, keyBefore, 'an edit must force a rebuild through the revision');
});

// ---------------------------------------------------------------------------
// 2. Hash soundness
// ---------------------------------------------------------------------------

test('equal contentHash implies byte-identical generated geometry across a representative sweep', () => {
  const lastSegment = baseRecord().path.segments.at(-1).id;
  const profile = (peak) => [
    { segmentId: lastSegment, arcFraction: 0.5, height: 3.5 },
    { segmentId: lastSegment, arcFraction: 0.65, height: 3.5 },
    { segmentId: lastSegment, arcFraction: 0.8, height: peak },
    { segmentId: lastSegment, arcFraction: 0.95, height: 3.5 },
  ];

  const variants = [
    baseRecord(),
    // Revision and material ids are metadata: geometry may not move.
    { ...baseRecord(), revision: 9 },
    { ...baseRecord(), style: { key: 'coursed-rubble', version: 1, materials: { stone: 'granite-masonry', mortar: null, roof: null } } },
    // Geometry-affecting inputs must move the hash.
    baseRecord({ seed: 12 }),
    baseRecord({ thickness: 1.1 }),
    baseRecord({ styleKey: 'rounded-fieldstone' }),
    baseRecord({ top: { style: 'flat', base: 3.5, profile: profile(5) } }),
    baseRecord({ top: { style: 'flat', base: 3.5, profile: profile(6) } }),
  ].map((record) => normalizeConstructionRecord(record));

  const byHash = new Map();
  let moduleCount = 0;
  for (const record of variants) {
    const planned = planConstruction(record, { maxModuleLength: 8 });
    for (const module of planned.modules) {
      moduleCount += 1;
      const entry = byHash.get(module.contentHash);
      if (entry) entry.push({ record, module });
      else byHash.set(module.contentHash, [{ record, module }]);
    }
  }

  assert.ok(moduleCount > 40, `sweep must cover many modules, got ${moduleCount}`);
  const shared = [...byHash.values()].filter((group) => group.length > 1);
  assert.ok(shared.length > 0, 'the sweep must actually share hashes to be non-vacuous');
  assert.notEqual(byHash.size, moduleCount, 'the sweep must also produce distinct hashes');

  let compared = 0;
  for (const group of shared) {
    const reference = moduleGeometryFingerprint(group[0].record, group[0].module);
    for (const { record, module } of group.slice(1)) {
      assert.equal(
        moduleGeometryFingerprint(record, module),
        reference,
        `${module.id} shares a hash but not its geometry`,
      );
      compared += 1;
    }
  }
  assert.ok(compared > 0, 'at least one shared hash must have been compared');
});

test('an upstream insert does not re-roll or re-hash distant module stones', () => {
  // The exact shape defect #2 had: the per-module seed used to be the module's
  // index in the flat module array, so splitting an early segment silently
  // re-rolled every later module while its hash stayed put.
  const source = baseRecord({ lastAnchorX: 40 });
  const splitSegment = source.path.segments[0].id;
  const options = { maxModuleLength: 5 };
  const before = planConstruction(source, options);
  const downstream = new Set(source.path.segments.slice(2).map(({ id }) => id));

  const store = storeWith(source);
  executeConstructionCommand(store, {
    type: 'insert_anchor',
    constructionId: 'construction-1',
    segmentId: splitSegment,
    t: 0.5,
  });
  const after = planConstruction(store.get('construction-1'), options);

  const beforeMap = moduleMap(before);
  const beforeGeometry = new Map(before.modules.map((m) => [m.id, m.placements]));
  let compared = 0;
  for (const module of after.modules) {
    if (!downstream.has(module.segmentId)) continue;
    const original = beforeMap.get(module.id);
    assert.ok(original, `${module.id} lost its stable id`);
    assert.equal(module.contentHash, original.contentHash, `${module.id} hash was re-rolled`);
    assertSameGeometry(module.placements, beforeGeometry.get(module.id), 1e-9, `${module.id}`);
    compared += 1;
  }
  assert.ok(compared >= 4, `expected several downstream modules, got ${compared}`);
});

// ---------------------------------------------------------------------------
// 3. LOD agreement
// ---------------------------------------------------------------------------

function doorwayRecord() {
  const path = createCubicBezierPathFromStroke(
    [[0, 0], [8, 0.01], [16, -0.01], [24, 0]],
    { simplifyTolerance: 0.001, anchorPrefix: ANCHOR_PREFIX, segmentPrefix: SEGMENT_PREFIX },
  );
  const segmentId = path.segments[1].id;
  return normalizeConstructionRecord({
    version: 1,
    id: 'construction-1',
    revision: 1,
    seed: 5,
    kind: 'wall',
    style: { key: 'coursed-rubble', version: 1, materials: {} },
    dimensions: { height: 3.5, thickness: 0.8 },
    top: { style: 'flat', base: 3.5, profile: [] },
    path,
    features: [{
      id: 'door-1',
      kind: 'door',
      segmentId,
      arcFraction: 0.5,
      width: 2.4,
      height: 2.6,
      sill: 0,
      profile: 'flat',
      dressed: true,
      group: null,
    }],
  });
}

/** Covered vertical spans of the masonry at arc `s`, joints up to `jt` closed. */
function coveredColumn(placements, s, jt) {
  const rings = [];
  for (const placement of placements) {
    const ring = placement.mortarCorners ?? placement.corners;
    if (ring) {
      rings.push(ring.map(([a, b]) => [placement.s + a, placement.y + b]));
      continue;
    }
    const halfWidth = (placement.packedWidth ?? placement.width ?? 0) / 2;
    const halfHeight = (placement.height ?? 0) / 2;
    if (halfWidth > 0 && halfHeight > 0) {
      rings.push([
        [placement.s - halfWidth, placement.y - halfHeight],
        [placement.s + halfWidth, placement.y - halfHeight],
        [placement.s + halfWidth, placement.y + halfHeight],
        [placement.s - halfWidth, placement.y + halfHeight],
      ]);
    }
  }
  const spans = [];
  for (const ring of rings) {
    const ys = [];
    for (let index = 0; index < ring.length; index += 1) {
      const [s0, y0] = ring[index];
      const [s1, y1] = ring[(index + 1) % ring.length];
      if (s < Math.min(s0, s1) - 1e-12 || s > Math.max(s0, s1) + 1e-12) continue;
      if (Math.abs(s1 - s0) < 1e-9) {
        ys.push(y0, y1);
        continue;
      }
      ys.push(y0 + (y1 - y0) * ((s - s0) / (s1 - s0)));
    }
    if (ys.length) spans.push([Math.min(...ys), Math.max(...ys)]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [bottom, top] of spans) {
    const last = merged.at(-1);
    if (last && bottom <= last[1] + jt) last[1] = Math.max(last[1], top);
    else merged.push([bottom, top]);
  }
  return merged;
}

function solidInMasonry(placements, s, y, jt = 0.02) {
  return coveredColumn(placements, s, jt).some(([bottom, top]) => y >= bottom && y <= top);
}

function openSpanFor(predicate, centre, y, reach = 3) {
  let low = null;
  let high = null;
  for (let s = centre - reach; s <= centre + reach; s += 0.005) {
    if (predicate(s, y)) {
      if (low == null) low = s;
      high = s;
    }
  }
  return low == null ? null : [low, high];
}

function openTopFor(predicate, centre, maxY = 3.4) {
  let top = null;
  for (let y = 0; y <= maxY; y += 0.005) if (predicate(centre, y)) top = y;
  return top;
}

test('near, coarse and shell agree about the opening silhouette', () => {
  const record = doorwayRecord();
  const planned = planConstruction(record, { maxModuleLength: 8 });
  const near = planned.modules.flatMap((module) => module.placements ?? []);
  const coarse = planned.modules.flatMap((module) => coarsePlacementsForModule({
    record,
    module,
    totalLength: planned.totalLength,
  }));
  assert.ok(near.length > 0 && coarse.length > 0, 'both LODs must emit masonry');

  const arcTable = createCurveArcTable(sampleCubicBezierPath(record.path));
  const s = arcTable.toArc(record.features[0].segmentId, record.features[0].arcFraction);

  // Shell LOD: the carved ribbon the view shows at distance.
  const geometry = buildWallGeometry(record, { getCanonicalHeight: () => 0 }, ORIGIN);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.updateMatrixWorld(true);
  const shellSolid = (arc, y) => {
    const frame = arcTable.frameAt(arc);
    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(frame.x - frame.normalX * 6, y, frame.z - frame.normalZ * 6),
      new THREE.Vector3(frame.normalX, 0, frame.normalZ),
    );
    return raycaster.intersectObject(mesh, false).length > 0;
  };

  try {
    const y = 0.6; // well inside the doorway, below the crown
    const nearSpan = openSpanFor((arc, yy) => !solidInMasonry(near, arc, yy), s, y);
    const coarseSpan = openSpanFor((arc, yy) => !solidInMasonry(coarse, arc, yy), s, y);
    const shellSpan = openSpanFor((arc, yy) => !shellSolid(arc, yy), s, y);
    assert.ok(nearSpan && coarseSpan && shellSpan, 'every LOD must show a passage');
    assert.ok(nearSpan[1] - nearSpan[0] > 2.0, `the near void is too narrow: ${nearSpan}`);

    // Near and coarse are the same contour packed two ways.
    assert.ok(Math.abs(nearSpan[0] - coarseSpan[0]) < 0.02, `near/coarse left edge ${nearSpan[0]} vs ${coarseSpan[0]}`);
    assert.ok(Math.abs(nearSpan[1] - coarseSpan[1]) < 0.02, `near/coarse right edge ${nearSpan[1]} vs ${coarseSpan[1]}`);
    // The shell follows the same authored contour within its trapezoid bands.
    assert.ok(Math.abs(nearSpan[0] - shellSpan[0]) < 0.06, `near/shell left edge ${nearSpan[0]} vs ${shellSpan[0]}`);
    assert.ok(Math.abs(nearSpan[1] - shellSpan[1]) < 0.06, `near/shell right edge ${nearSpan[1]} vs ${shellSpan[1]}`);
    assert.ok(Math.abs((nearSpan[0] + nearSpan[1]) / 2 - (shellSpan[0] + shellSpan[1]) / 2) < 0.02, 'the shell void is off the near void centre');

    // Same crown: the passage must not open higher at one band than another.
    const crownNear = openTopFor((arc, yy) => !solidInMasonry(near, arc, yy), s);
    const crownCoarse = openTopFor((arc, yy) => !solidInMasonry(coarse, arc, yy), s);
    const crownShell = openTopFor((arc, yy) => !shellSolid(arc, yy), s);
    assert.ok(crownNear && crownCoarse && crownShell, 'every LOD must show an open crown');
    assert.ok(Math.abs(crownNear - crownCoarse) < 0.02, `crown near/coarse ${crownNear} vs ${crownCoarse}`);
    assert.ok(Math.abs(crownNear - crownShell) < 0.05, `crown near/shell ${crownNear} vs ${crownShell}`);

    // Outside the opening, and above the crown, every band is solid wall.
    for (const arc of [s - 3, s + 3]) {
      assert.ok(solidInMasonry(near, arc, 1), `near has a hole at ${arc}`);
      assert.ok(solidInMasonry(coarse, arc, 1), `coarse has a hole at ${arc}`);
      assert.ok(shellSolid(arc, 1), `shell has a hole at ${arc}`);
    }
    for (const solid of [(arc, yy) => solidInMasonry(near, arc, yy), (arc, yy) => solidInMasonry(coarse, arc, yy), shellSolid]) {
      assert.ok(solid(s, 3.0), 'material above the crown must survive in every band');
    }

    // The coarse face-coverage gate (phase 10): reducing to coarse must not
    // uncover more of the wall face outside the opening than near does.
    const style = constructionStyle(record.style.key);
    const face = {
      length: planned.totalLength,
      bodyTop: record.top.base - style.coping.height,
      openings: wallOpenings(record),
    };
    const extra = uncoveredFaceShare(coarse, face) - uncoveredFaceShare(near, face);
    assert.ok(extra < 0.003, `coarse uncovers ${(extra * 100).toFixed(2)}% more than near`);

    // Near, coarse and shell are all reachable band selections: a distance
    // transition picks between these three plans, no more.
    assert.equal(selectConstructionLod({ pixels: 400 }), 'near');
    assert.equal(selectConstructionLod({ pixels: 60 }), 'coarse');
    assert.equal(selectConstructionLod({ pixels: 5 }), 'shell');
  } finally {
    mesh.material.dispose();
    geometry.dispose();
  }
});

// ---------------------------------------------------------------------------
// 4. Save/load and undo round-trip
// ---------------------------------------------------------------------------

test('a saved document survives load with identical authored state and identical plans', () => {
  const authored = baseRecord({
    features: [{
      id: 'door-1',
      kind: 'door',
      segmentId: `${SEGMENT_PREFIX}-2`,
      arcFraction: 0.5,
      width: 1.4,
      height: 2.2,
      sill: 0,
      profile: 'flat',
      dressed: true,
      group: null,
    }],
    top: { style: 'flat', base: 3.5, profile: [{ segmentId: `${SEGMENT_PREFIX}-4`, arcFraction: 0.5, height: 4.2 }] },
  });
  const store = storeWith(authored);
  const document = store.toDocument();
  assert.equal(document.length, 1);

  const reloaded = new ConstructionStore();
  reloaded.loadDocument(structuredClone(document));

  const original = store.get('construction-1');
  const loaded = reloaded.get('construction-1');
  // Authored state round-trips exactly (revision is allowed to move: the store
  // keeps it monotic across a world replacement).
  const authoredState = ({ revision, ...rest }) => rest;
  assert.deepEqual(authoredState(loaded), authoredState(original));

  const beforePlan = planConstruction(original, { maxModuleLength: 8 });
  const afterPlan = planConstruction(loaded, { maxModuleLength: 8 });
  assert.ok(beforePlan.modules.length > 0, 'the fixture must plan into modules');
  assert.deepEqual(afterPlan.modules, beforePlan.modules);
  assert.equal(afterPlan.contentHash, beforePlan.contentHash);
});

test('undo restores the previous authored state and plan, and redo re-applies them', () => {
  const store = storeWith();
  const originalPlan = plan(store);
  const anchorId = store.get('construction-1').path.anchors[1].id;

  const moved = executeConstructionCommand(store, {
    type: 'move_anchor',
    constructionId: 'construction-1',
    anchorId,
    position: { x: 8, z: 6 },
  });
  const movedPlan = plan(store);
  assert.notEqual(movedPlan.contentHash, originalPlan.contentHash, 'the edit must change the plan');

  const authoredState = ({ revision, ...rest }) => rest;

  store.applyChange(moved, 'undo');
  const undone = store.get('construction-1');
  assert.ok(undone.revision > moved.after.revision, 'undo must bump the monotonic watermark');
  assert.deepEqual(authoredState(undone), authoredState(moved.before));
  assert.deepEqual(plan(store).modules, originalPlan.modules);

  store.applyChange(moved, 'redo');
  const redone = store.get('construction-1');
  assert.ok(redone.revision > undone.revision, 'redo must stay monotonic');
  assert.deepEqual(authoredState(redone), authoredState(moved.after));
  assert.deepEqual(plan(store).modules, movedPlan.modules);
});

// ---------------------------------------------------------------------------
// 5. A save carries no generated masonry
// ---------------------------------------------------------------------------

test('a saved document carries only authored fields, never generated masonry', () => {
  const store = storeWith(baseRecord({
    features: [{
      id: 'door-1',
      kind: 'door',
      segmentId: `${SEGMENT_PREFIX}-2`,
      arcFraction: 0.5,
      width: 1.4,
      height: 2.2,
      sill: 0,
      profile: 'flat',
      dressed: true,
      group: null,
    }],
  }));
  // Make some masonry exists, so "the save has none" is not vacuous.
  assert.ok((plan(store).modules[0].placements ?? []).length > 0, 'the wall must generate masonry');

  const document = store.toDocument();
  assert.ok(document.length > 0, 'the document must contain the wall');

  const RECORD_KEYS = [
    'dimensions', 'features', 'id', 'kind', 'label', 'path', 'revision', 'seed', 'style', 'top', 'version',
  ];
  const PATH_KEYS = ['anchors', 'closed', 'features', 'segments', 'type', 'version'];
  const FEATURE_KEYS = ['arcFraction', 'dressed', 'group', 'height', 'id', 'kind', 'profile', 'segmentId', 'sill', 'width'];
  for (const record of document) {
    assert.deepEqual(Object.keys(record).sort(), RECORD_KEYS, 'a save record gained a derived key');
    assert.deepEqual(Object.keys(record.path).sort(), PATH_KEYS, 'a save path gained a derived key');
    assert.deepEqual(Object.keys(record.features[0]).sort(), FEATURE_KEYS, 'a save feature gained a derived key');
  }

  const serialized = JSON.stringify(document);
  for (const forbidden of [
    'placements', 'mortarCorners', 'corners', 'stableIndex', 'cellIndex', 'courseIndex',
    'contentHash', 'geometry', 'positions', 'indices', 'meshes', 'stones',
  ]) {
    assert.ok(
      !serialized.includes(`"${forbidden}"`),
      `a save must not persist generated field ${forbidden}`,
    );
  }
});
