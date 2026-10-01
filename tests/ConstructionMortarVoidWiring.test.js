import { geometrySpansAt as mortarSpansAt } from './helpers/constructionGeometrySlices.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  openingVerticalSpan,
  openingVoidInterval,
} from '../src/editor/construction/masonry/OpeningLayout.js';
import { packCurvedWall } from '../src/editor/construction/masonry/CurvedCoursePacker.js';
import { createCurveArcTable } from '../src/editor/construction/masonry/CurveArcTable.js';
import { createWallTopProfile } from '../src/editor/construction/masonry/WallTopProfile.js';
import { constructionStyle } from '../src/editor/construction/masonry/ConstructionStyleCatalog.js';
import { normalizeConstructionRecord } from '../src/editor/construction/ConstructionSchema.js';
import { buildModuleMasonry } from '../src/editor/construction/compile/ConstructionMasonryBuilder.js';
import { CONSTRUCTION_MATERIAL_SLOT } from '../src/editor/construction/render/ConstructionMaterialSlots.js';
import {
  createConstructionMaterials,
  disposeConstructionMaterials,
} from '../src/editor/construction/render/ConstructionMaterials.js';
import {
  createCubicBezierPathFromStroke,
  sampleCubicBezierPath,
} from '../src/editor/construction/curve/CubicBezierPath.js';

/**
 * The openings clip inside `buildMortarCoreGeometry` is inert until a caller
 * passes `openings`, so these tests drive the real masonry entry point
 * (`buildModuleMasonry`, rounded path), not the core builder in isolation. A
 * wall with a doorway must leave its mortar core out of the void — and the same
 * masonry built from a record without the opening must fill it, which is what
 * proves the clip is wired at the call site rather than merely dormant.
 *
 * The wall is authored straight along +X, so a built prism's world `x` is its
 * arc coordinate and the mortar spans are directly comparable to the shared
 * contour.
 */

const STYLE = constructionStyle('rounded-fieldstone');
const ORIGIN = { x: 0, z: 0 };
const WALL_LENGTH = 24;
const WALL_HEIGHT = 3.5;
// A door with a raised threshold: the sill falls inside the tall footing
// course, so the core is solid below it and voided above; the crown leaves
// masonry over the arch.
const DOOR = { s: 12, width: 2.4, height: 2.6, sill: 0.4, profile: 'round' };

function straightPath(length = WALL_LENGTH) {
  return createCubicBezierPathFromStroke([
    [0, 0], [length / 3, 0], [(2 * length) / 3, 0], [length, 0],
  ], { simplifyTolerance: 0.001 });
}

function wallRecord(dressed) {
  const seed = normalizeConstructionRecord({
    version: 1,
    id: 'construction-mortar-void',
    revision: 1,
    seed: 5,
    kind: 'wall',
    style: { key: STYLE.key, version: 1 },
    dimensions: { height: WALL_HEIGHT, thickness: 0.8 },
    path: straightPath(),
    features: [],
  });
  const segment = seed.path.segments[0];
  const seedArc = createCurveArcTable(sampleCubicBezierPath(seed.path));
  const [from, to] = seedArc.segmentRange(segment.id);
  return normalizeConstructionRecord({
    ...seed,
    features: [{
      id: 'door-1',
      kind: 'door',
      segmentId: segment.id,
      arcFraction: (DOOR.s - from) / (to - from),
      width: DOOR.width,
      height: DOOR.height,
      sill: DOOR.sill,
      profile: DOOR.profile,
      dressed,
    }],
  });
}

/** A doorway wall packed through the packer, openings in the wall's arc domain. */
function doorwayWall(dressed) {
  const wall = wallRecord(dressed);
  const arcTable = createCurveArcTable(sampleCubicBezierPath(wall.path));
  const profile = createWallTopProfile(wall, arcTable, { style: STYLE });
  const openings = wall.features.map((entry) => ({
    ...entry,
    s: arcTable.toArc(entry.segmentId, entry.arcFraction),
  }));
  const packed = packCurvedWall({
    arcTable,
    arcRange: [0, arcTable.totalLength],
    style: STYLE,
    thickness: wall.dimensions.thickness,
    seed: wall.seed,
    seedOffset: 0,
    topHeightAt: profile.heightAt,
    ruinFactorAt: profile.ruinFactorAt,
    openings,
    budget: 4000,
  });
  return { wall, arcTable, opening: openings[0], placements: packed.stones };
}

/**
 * Build a module through the public entry point. `recordOpenings: false` drops
 * the record's features, so the builder derives an empty opening list and the
 * clip stays dormant — the counterfactual for the wiring.
 */
function buildModule(wall, arcTable, placements, { recordOpenings = true } = {}) {
  const record = recordOpenings ? wall : { ...wall, features: [] };
  return buildModuleMasonry(placements, {
    record,
    materials: createConstructionMaterials(record),
    arcTable,
    moduleOrigin: ORIGIN,
    groundHeightAt: () => 0,
  });
}

function mortarGeometry(built) {
  const mesh = built.meshes.find((candidate) => (
    candidate.userData.constructionMaterialSlot === CONSTRUCTION_MATERIAL_SLOT.MORTAR
  ));
  assert.ok(mesh, 'expected a mortar core mesh');
  return mesh.geometry;
}

/**
 * Occupied arc intervals of the mortar at height `y`, read back off the built
 * geometry so the test sees what renders, not what the builder intended. The
 * wall is straight, so a prism's world `x` is its arc coordinate.
 */

/** Merge touching spans so the same coverage reads identically either way. */
function mergedSpans(spans) {
  const merged = [];
  for (const [from, to] of spans) {
    const previous = merged.at(-1);
    if (previous && from <= previous[1] + 1e-6) {
      previous[1] = Math.max(previous[1], to);
    } else {
      merged.push([from, to]);
    }
  }
  return merged;
}

function assertSameCoverage(clipped, unclipped, y) {
  const left = mergedSpans(mortarSpansAt(clipped, y));
  const right = mergedSpans(mortarSpansAt(unclipped, y));
  assert.equal(left.length, right.length, `coverage length changed at y=${y}`);
  for (let index = 0; index < left.length; index += 1) {
    assert.ok(Math.abs(left[index][0] - right[index][0]) < 1e-6, `span start moved at y=${y}`);
    assert.ok(Math.abs(left[index][1] - right[index][1]) < 1e-6, `span end moved at y=${y}`);
  }
}

function disposeBuilt(built) {
  for (const mesh of built.meshes) mesh.geometry.dispose();
}

test.afterEach(() => {
  disposeConstructionMaterials();
});

test('the doorway core never fills the void, packed through the real builder', () => {
  const { wall, arcTable, opening, placements } = doorwayWall(true);
  const geometry = mortarGeometry(buildModule(wall, arcTable, placements));
  const { sill, crown } = openingVerticalSpan(opening);
  assert.equal(sill, 0.4);
  assert.equal(crown, 3.0);

  // The contour is bounded: nothing is reserved just below the sill or just
  // above the arch crown, so those levels are on the solid side of the void.
  assert.equal(openingVoidInterval(opening, sill - 0.05), null);
  assert.equal(openingVoidInterval(opening, crown + 0.05), null);

  // Sweep the whole contour. A core filling the opening spans jamb to jamb and
  // crosses the opening's centre; no prism may.
  let probes = 0;
  for (let step = 0; step <= 80; step += 1) {
    const y = sill - 0.4 + step * 0.04;
    if (y <= 0.05 || y >= WALL_HEIGHT) continue;
    if (Math.abs(y - sill) < 1e-9 || Math.abs(y - crown) < 1e-9) continue;
    if (!openingVoidInterval(opening, y)) continue;
    probes += 1;
    for (const [from, to] of mortarSpansAt(geometry, y)) {
      assert.ok(
        to <= opening.s + 1e-6 || from >= opening.s - 1e-6,
        `mortar ${from}..${to} crosses the void at y=${y}`,
      );
    }
  }
  assert.ok(probes > 50, `expected a dense void sweep, got ${probes}`);

  // The core is solid on both sides of the void: below the sill, and above the
  // crown.
  const nearCentre = (y) => mortarSpansAt(geometry, y)
    .some(([from, to]) => from < opening.s + 0.5 && to > opening.s - 0.5);
  assert.ok(
    mortarSpansAt(geometry, sill - 0.05).some(([from, to]) => from < opening.s && to > opening.s),
    'expected solid core across the doorway just below the sill',
  );
  assert.ok(nearCentre(crown + 0.05), 'expected solid core just above the crown');
});

/**
 * A field stone planted across the doorway, as a packer defect would leave it.
 * The packer now keeps every course clear of the void (handoff §4C), so the
 * clip's liveness is proven on a stone that needs clipping rather than on one
 * the packer happens to produce.
 */
function withStraddlingStone(placements, opening) {
  const template = placements.find((placement) => placement.category === 'field' && placement.corners);
  const { sill, crown } = openingVerticalSpan(opening);
  const half = 0.6;
  const height = Math.min(0.5, (crown - sill) * 0.4);
  const ring = [[-half, -height / 2], [half, -height / 2], [half, height / 2], [-half, height / 2]];
  return [...placements, {
    ...template,
    s: opening.s,
    y: sill + (crown - sill) * 0.5,
    corners: ring,
    mortarCorners: ring,
    width: half * 2,
    packedWidth: half * 2,
    height,
    stableIndex: 999999,
  }];
}

test('the doorway clip is live at the call site, not merely implemented', () => {
  const doorway = doorwayWall(true);
  const { wall, arcTable, opening } = doorway;
  const placements = withStraddlingStone(doorway.placements, opening);
  const clipped = buildModule(wall, arcTable, placements, { recordOpenings: true });
  const unclipped = buildModule(wall, arcTable, placements, { recordOpenings: false });
  const clippedGeometry = mortarGeometry(clipped);
  const unclippedGeometry = mortarGeometry(unclipped);

  const { sill, crown } = openingVerticalSpan(opening);
  let filled = 0;
  let probes = 0;
  for (let step = 0; step <= 160; step += 1) {
    const y = sill - 0.4 + step * 0.02;
    if (y <= 0.05 || y >= WALL_HEIGHT) continue;
    if (Math.abs(y - sill) < 1e-9 || Math.abs(y - crown) < 1e-9) continue;
    if (!openingVoidInterval(opening, y)) {
      // Outside the contour the clip is a no-op: coverage is unchanged.
      assertSameCoverage(clippedGeometry, unclippedGeometry, y);
      continue;
    }
    probes += 1;
    // Same masonry, same mortar descriptors — only the opening list differs.
    // Unclipped, a course straddling the contour fills the void; clipped it
    // must not cross the void centre.
    if (mortarSpansAt(unclippedGeometry, y).some(([from, to]) => from < opening.s && to > opening.s)) {
      filled += 1;
    }
    for (const [from, to] of mortarSpansAt(clippedGeometry, y)) {
      assert.ok(
        to <= opening.s + 1e-6 || from >= opening.s - 1e-6,
        `clipped mortar ${from}..${to} crosses the void at y=${y}`,
      );
    }
  }
  assert.ok(probes > 100);
  assert.ok(filled > 5, `the unclipped core filled the void at only ${filled} levels`);
});

test('an undressed doorway leaves no mortar geometry inside the void', () => {
  const { wall, arcTable, opening, placements } = doorwayWall(false);
  const geometry = mortarGeometry(buildModule(wall, arcTable, placements));
  const { sill, crown } = openingVerticalSpan(opening);

  // Without dressing stones the only mortar near the opening is the field core,
  // so the whole reserved interval — not just its centre — must be empty.
  let probes = 0;
  for (let step = 0; step <= 200; step += 1) {
    const y = sill + 0.01 + step * 0.02;
    if (y >= crown) break;
    const interval = openingVoidInterval(opening, y);
    if (!interval) continue;
    probes += 1;
    for (const [from, to] of mortarSpansAt(geometry, y)) {
      assert.ok(
        to <= interval.low + 1e-6 || from >= interval.high - 1e-6,
        `mortar ${from}..${to} intrudes on the void at y=${y}`,
      );
    }
  }
  assert.ok(probes > 100);
});

test('a wall without openings keeps its full mortar core, unchanged', () => {
  const wall = normalizeConstructionRecord({
    version: 1,
    id: 'construction-mortar-no-opening',
    revision: 1,
    seed: 5,
    kind: 'wall',
    style: { key: STYLE.key, version: 1 },
    dimensions: { height: WALL_HEIGHT, thickness: 0.8 },
    path: straightPath(),
    features: [],
  });
  const arcTable = createCurveArcTable(sampleCubicBezierPath(wall.path));
  const profile = createWallTopProfile(wall, arcTable, { style: STYLE });
  const packed = packCurvedWall({
    arcTable,
    arcRange: [0, arcTable.totalLength],
    style: STYLE,
    thickness: wall.dimensions.thickness,
    seed: wall.seed,
    seedOffset: 0,
    topHeightAt: profile.heightAt,
    ruinFactorAt: profile.ruinFactorAt,
  });

  const first = buildModule(wall, arcTable, packed.stones);
  // Every descriptor is emitted whole: an empty opening list never clips, which
  // is the guarantee that walls without openings render exactly as before.
  const geometry = mortarGeometry(first);
  assert.ok(geometry.userData.mortarPrisms > 0);
  assert.equal(geometry.userData.mortarPrisms, first.stats.mortarPrisms);

  // No spurious void where the doorway would have been.
  assert.ok(
    mortarSpansAt(geometry, 1.5).some(([from, to]) => from < 12 && to > 12),
    'expected continuous core across the wall',
  );

  const fingerprint = Array.from(geometry.getAttribute('position').array);
  disposeBuilt(first);

  // Byte-identical rebuild: output is a pure function of the inputs.
  const second = buildModule(wall, arcTable, packed.stones);
  assert.deepEqual(
    Array.from(mortarGeometry(second).getAttribute('position').array),
    fingerprint,
  );
  disposeBuilt(second);
});
