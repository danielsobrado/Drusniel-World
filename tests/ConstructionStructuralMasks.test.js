import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import {
  OPENING_CLEARANCE,
  createOpeningExclusionMask,
  openingExclusionZones,
  openingHalfWidthAt,
  openingVerticalSpan,
  openingVoidInterval,
  survivingIntervals,
  survivingIntervalsOverBand,
} from '../src/editor/construction/masonry/OpeningLayout.js';
import { packCurvedWall } from '../src/editor/construction/masonry/CurvedCoursePacker.js';
import { createCurveArcTable } from '../src/editor/construction/masonry/CurveArcTable.js';
import { createWallTopProfile } from '../src/editor/construction/masonry/WallTopProfile.js';
import { constructionStyle } from '../src/editor/construction/masonry/ConstructionStyleCatalog.js';
import { normalizeConstructionRecord } from '../src/editor/construction/ConstructionSchema.js';
import { createMortarDescriptor } from '../src/editor/construction/compile/ConstructionStoneShape.js';
import { buildMortarCoreGeometry } from '../src/editor/construction/compile/ConstructionMortarCoreBuilder.js';
import { buildWallGeometry } from '../src/editor/construction/render/ConstructionShell.js';
import {
  createCubicBezierPathFromStroke,
  sampleCubicBezierPath,
} from '../src/editor/construction/curve/CubicBezierPath.js';

/**
 * One opening, consumed everywhere.
 *
 * Phase 11 §7.3 asks for a single opening contour in the wall's surface domain,
 * read by near masonry, coarse masonry, the shell, the mortar core and the
 * decoration mask. These tests hold the shared definition (`OpeningLayout`) and
 * the mortar consumer to it: the same arc span at a height, no mortar left in
 * the void at any height, and a mask a decoration system can query.
 *
 * The wall is authored **straight along +X**, so a sample's world `x` *is* its
 * arc coordinate and the masonry, shell and mortar spans are directly
 * comparable without an arc-table round trip.
 */

const STYLE = constructionStyle('coursed-rubble');
const ORIGIN = { x: 0, z: 0 };
const WALL_LENGTH = 24;
const WALL_HEIGHT = 3.5;

/** Collinear anchors simplify to a single straight segment from x=0 to x=L. */
function straightPath(length = WALL_LENGTH) {
  return createCubicBezierPathFromStroke([
    [0, 0], [length / 3, 0], [(2 * length) / 3, 0], [length, 0],
  ], { simplifyTolerance: 0.001 });
}

/**
 * A straight wall carrying one authored opening. The opening is returned both
 * as the record feature and in arc coordinates, the form the packer and the
 * contour helpers take.
 */
function wallWith(spec) {
  const seedRecord = normalizeConstructionRecord({
    version: 1,
    id: 'construction-masks',
    revision: 1,
    seed: 5,
    kind: 'wall',
    style: { key: STYLE.key, version: 1 },
    dimensions: { height: WALL_HEIGHT, thickness: 0.8 },
    path: straightPath(),
    features: [],
  });
  const segment = seedRecord.path.segments[0];
  const seedArc = createCurveArcTable(sampleCubicBezierPath(seedRecord.path));
  const [from, to] = seedArc.segmentRange(segment.id);
  const feature = {
    id: spec.id ?? 'opening-a',
    kind: spec.kind ?? 'door',
    segmentId: segment.id,
    arcFraction: (spec.s - from) / (to - from),
    width: spec.width,
    height: spec.height,
    sill: spec.sill,
    profile: spec.profile,
    dressed: true,
  };
  const record = normalizeConstructionRecord({ ...seedRecord, features: [feature] });
  const arcTable = createCurveArcTable(sampleCubicBezierPath(record.path));
  const profile = createWallTopProfile(record, arcTable, { style: STYLE });
  const opening = { ...record.features[0], s: arcTable.toArc(segment.id, feature.arcFraction) };
  return { record, arcTable, profile, opening };
}

function pack(wall, openings, overrides = {}) {
  return packCurvedWall({
    arcTable: wall.arcTable,
    arcRange: [0, wall.arcTable.totalLength],
    style: STYLE,
    thickness: wall.record.dimensions.thickness,
    seed: wall.record.seed,
    topHeightAt: wall.profile.heightAt,
    ruinFactorAt: wall.profile.ruinFactorAt,
    slopeAt: wall.profile.slopeAt,
    crenellationsOver: wall.profile.crenellationsOver,
    topStyle: wall.record.top.style,
    openings,
    budget: 4000,
    ...overrides,
  });
}

/**
 * Mortar descriptors in the shape the rounded builder hands the core writer:
 * each carries its stone's arc position in `drapeFrame` and its grade-relative
 * height in `position[1]`, which is what lets the core clip to the contour.
 */
function mortarDescriptors(placements, arcTable) {
  const descriptors = [];
  for (const placement of placements) {
    if (placement.category !== 'field' || !placement.mortarCorners) continue;
    const frame = arcTable.frameAt(placement.s);
    const position = [
      frame.x + frame.normalX * placement.offsetNormal - ORIGIN.x,
      placement.y,
      frame.z + frame.normalZ * placement.offsetNormal - ORIGIN.z,
    ];
    const rotation = [0, frame.yaw, placement.roll ?? 0];
    const descriptor = createMortarDescriptor({
      placement,
      stoneShape: {
        category: placement.category,
        corners: placement.corners,
        depth: placement.depth,
        position,
        rotation,
      },
      nominalPosition: position,
      nominalRotation: rotation,
    });
    if (descriptor) {
      descriptors.push({
        ...descriptor,
        drapeFrame: {
          s: placement.s,
          x: position[0],
          z: position[2],
          tangentX: frame.tangentX,
          tangentZ: frame.tangentZ,
        },
      });
    }
  }
  return descriptors;
}

/**
 * Occupied arc intervals of the mortar at height `y`, read back off the built
 * geometry so the test sees what renders, not what the builder intended. The
 * wall is straight, so a prism's world `x` is its arc coordinate.
 */
function mortarSpansAt(geometry, y) {
  const position = geometry.getAttribute('position');
  const count = geometry.userData.mortarPrisms;
  const spans = [];
  for (let prism = 0; prism < count; prism += 1) {
    const base = prism * 24;
    const xs = [];
    const ys = [];
    for (let corner = 0; corner < 4; corner += 1) {
      xs.push(position.getX(base + corner));
      ys.push(position.getY(base + corner));
    }
    if (y < Math.min(...ys) - 1e-9 || y > Math.max(...ys) + 1e-9) continue;
    spans.push([Math.min(...xs), Math.max(...xs)]);
  }
  return spans.sort((left, right) => left[0] - right[0]);
}

/** The solid gap that contains `centre`, from a sorted list of solid intervals. */
function voidGap(spans, centre) {
  let left = -Infinity;
  let right = Infinity;
  for (const [from, to] of spans) {
    if (to <= centre) left = Math.max(left, to);
    if (from >= centre) right = Math.min(right, from);
  }
  return [left, right];
}

function shellMesh(record) {
  const geometry = buildWallGeometry(record, { getCanonicalHeight: () => 0 }, ORIGIN);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  mesh.updateMatrixWorld(true);
  return { mesh, geometry };
}

/** Cast straight through the wall at `(arc, y)` across the path's normal. */
function shellHits(mesh, arcTable, arc, y) {
  const frame = arcTable.frameAt(arc);
  const raycaster = new THREE.Raycaster(
    new THREE.Vector3(frame.x - frame.normalX * 6, y, frame.z - frame.normalZ * 6),
    new THREE.Vector3(frame.normalX, 0, frame.normalZ),
  );
  return raycaster.intersectObject(mesh, false);
}

/** Clear arc interval either side of `centre` at height `y`, shell LOD. */
function shellVoidGap(mesh, arcTable, centre, y, reach = 2) {
  const step = 0.005;
  let left = centre;
  let right = centre;
  for (let offset = step; offset <= reach; offset += step) {
    if (shellHits(mesh, arcTable, centre - offset, y).length > 0) break;
    left = centre - offset;
  }
  for (let offset = step; offset <= reach; offset += step) {
    if (shellHits(mesh, arcTable, centre + offset, y).length > 0) break;
    right = centre + offset;
  }
  return [left, right];
}

test('masonry, mortar and shell agree about one opening within a tight tolerance', () => {
  const wall = wallWith({ id: 'door-a', kind: 'door', s: 12, width: 2.4, height: 2.2, sill: 0, profile: 'round' });
  const opening = wall.opening;
  // A course whose centre is well inside the void and below the springing, so
  // the whole course carries the full-width void and nothing is a sampling
  // artefact of the course grid.
  const y = 0.84;

  const masonryGap = voidGap(survivingIntervals([0, WALL_LENGTH], [opening], y), opening.s);

  const packed = pack(wall, [opening]);
  const geometry = buildMortarCoreGeometry(
    mortarDescriptors(packed.stones, wall.arcTable),
    { openings: [opening] },
  );
  const mortarGap = voidGap(mortarSpansAt(geometry, y), opening.s);

  const { mesh, geometry: shellGeometry } = shellMesh(wall.record);
  assert.equal(shellHits(mesh, wall.arcTable, opening.s, y).length, 0, 'the shell blocked its own void');
  const shellGap = shellVoidGap(mesh, wall.arcTable, opening.s, y);

  // The authored void, half-width 1.2 at this height, plus the shared clearance.
  assert.ok(Math.abs((masonryGap[1] - masonryGap[0]) - (opening.width + OPENING_CLEARANCE * 2)) < 1e-6);
  for (const [label, gap] of [['mortar', mortarGap], ['shell', shellGap]]) {
    assert.ok(
      Math.abs(gap[0] - masonryGap[0]) < 0.02,
      `${label} left edge ${gap[0]} disagrees with masonry ${masonryGap[0]}`,
    );
    assert.ok(
      Math.abs(gap[1] - masonryGap[1]) < 0.02,
      `${label} right edge ${gap[1]} disagrees with masonry ${masonryGap[1]}`,
    );
  }

  geometry.dispose();
  shellGeometry.dispose();
  mesh.material.dispose();
});

test('mortar never occupies an opening void, including a course straddling the crown', () => {
  // A window whose flat crown (2.3) falls below a course centre (2.52), so that
  // course is packed whole at its centre and its core used to span the void.
  const wall = wallWith({ id: 'window-a', kind: 'window', s: 12, width: 1.0, height: 1.1, sill: 1.2, profile: 'flat' });
  const opening = wall.opening;
  const { sill, crown } = openingVerticalSpan(opening);
  assert.equal(crown, 2.3);

  const packed = pack(wall, [opening]);
  const descriptors = mortarDescriptors(packed.stones, wall.arcTable);

  // The defect this test guards: unclipped, the straddling course fills the void.
  const straddlingY = 2.26;
  assert.ok(openingHalfWidthAt(opening, straddlingY) > 0, 'fixture has no void at the straddling height');
  const unclipped = buildMortarCoreGeometry(descriptors);
  assert.ok(
    mortarSpansAt(unclipped, straddlingY).some(([from, to]) => from < opening.s && to > opening.s),
    'expected the unclipped core to span the void',
  );
  unclipped.dispose();

  // Clipped, no core sits in the void at any height of the contour, and the
  // band boundaries are respected: nothing is cut below the sill or above the
  // crown.
  const clipped = buildMortarCoreGeometry(descriptors, { openings: [opening] });
  const swept = [sill + 0.02, 1.4, 1.75, crown - 0.06, straddlingY];
  for (const y of swept) {
    const half = openingHalfWidthAt(opening, y);
    assert.ok(half > 0, `fixture has no void at y=${y}`);
    for (const [from, to] of mortarSpansAt(clipped, y)) {
      assert.ok(
        to <= opening.s - half + 1e-6 || from >= opening.s + half - 1e-6,
        `mortar ${from}..${to} crosses the ${half} half-width void at y=${y}`,
      );
    }
  }
  // Outside the sill and crown the contour reserves nothing.
  assert.equal(openingVoidInterval(opening, sill - 0.05), null);
  assert.equal(openingVoidInterval(opening, crown + 0.05), null);

  // A core whose band straddles the contour is cut *between* the sill and the
  // crown only: a synthetic prism spanning 1.0..2.6 m keeps its core at 1.1 and
  // 2.4 and loses it across the void at 1.75.
  const synthetic = buildMortarCoreGeometry([{
    corners: [[-1, -0.8], [1, -0.8], [1, 0.8], [-1, 0.8]],
    depth: 0.6,
    position: [opening.s, 1.8, 0],
    rotation: [0, 0, 0],
    drapeFrame: { s: opening.s, x: opening.s, z: 0, tangentX: 1, tangentZ: 0 },
  }], { openings: [opening] });
  const coversCentre = (y) => mortarSpansAt(synthetic, y)
    .some(([from, to]) => from < opening.s && to > opening.s);
  assert.equal(coversCentre(sill - 0.1), true, 'core cut below the sill');
  assert.equal(coversCentre((sill + crown) / 2), false, 'core left inside the void');
  assert.equal(coversCentre(crown + 0.1), true, 'core cut above the crown');

  synthetic.dispose();
  clipped.dispose();
});

test('an opening whose crown sits below the top course is respected', () => {
  const wall = wallWith({ id: 'door-short', kind: 'door', s: 12, width: 1.4, height: 1.5, sill: 0, profile: 'round' });
  const opening = wall.opening;
  const { sill, crown } = openingVerticalSpan(opening);
  assert.ok(crown < WALL_HEIGHT, 'the opening must sit under the wall top');
  assert.equal(crown, sill + opening.height, 'the contour crown must be the authored height');

  const packed = pack(wall, [opening]);
  const field = packed.stones.filter(({ category }) => category === 'field');
  const above = field.filter((stone) => stone.y - stone.height / 2 > crown);
  assert.ok(above.length > 10, 'the masonry above the crown is missing');
  assert.ok(
    above.some((stone) => Math.abs(stone.s - opening.s) < 1),
    'no masonry directly over the crown',
  );

  const clipped = buildMortarCoreGeometry(
    mortarDescriptors(packed.stones, wall.arcTable),
    { openings: [opening] },
  );
  // The contour stops at the crown, so nothing above it is reserved.
  assert.equal(openingVoidInterval(opening, crown + 0.001), null);
  assert.ok(
    mortarSpansAt(clipped, crown + 0.4).some(([from, to]) => from < opening.s && to > opening.s),
    'core above the crown is missing',
  );
  for (const y of [sill + 0.05, (sill + crown) / 2, crown - 0.05]) {
    const half = openingHalfWidthAt(opening, y);
    for (const [from, to] of mortarSpansAt(clipped, y)) {
      assert.ok(
        to <= opening.s - half + 1e-6 || from >= opening.s + half - 1e-6,
        `mortar ${from}..${to} crosses the void at y=${y}`,
      );
    }
  }
  clipped.dispose();
});

test('the decoration exclusion mask covers the opening plus its clearance', () => {
  const wall = wallWith({ id: 'door-a', kind: 'door', s: 12, width: 2.4, height: 2.2, sill: 0, profile: 'round' });
  const opening = wall.opening;
  const { sill, crown } = openingVerticalSpan(opening);
  const half = opening.width / 2;

  const mask = createOpeningExclusionMask([opening]);
  assert.equal(mask.clearance, OPENING_CLEARANCE);
  assert.equal(mask.zones.length, 1);

  const [zone] = mask.zones;
  assert.ok(Math.abs(zone.low - (opening.s - half - OPENING_CLEARANCE)) < 1e-9);
  assert.ok(Math.abs(zone.high - (opening.s + half + OPENING_CLEARANCE)) < 1e-9);
  assert.ok(Math.abs(zone.bottom - (sill - OPENING_CLEARANCE)) < 1e-9);
  assert.ok(Math.abs(zone.top - (crown + OPENING_CLEARANCE)) < 1e-9);

  // A scatter point at the passage centre is rejected; one clear of the mask is
  // not. The mask must not read the contour's own clearance as "outside".
  assert.equal(mask.blocks(opening.s, (sill + crown) / 2), true);
  assert.equal(mask.blocks(opening.s - half + OPENING_CLEARANCE / 2, sill), true);
  assert.equal(mask.blocks(opening.s - half - OPENING_CLEARANCE - 0.05, sill), false);
  assert.equal(mask.blocks(opening.s, crown + OPENING_CLEARANCE + 0.05), false);
  assert.equal(mask.blocks(opening.s + 8, (sill + crown) / 2), false);

  // `openingExclusionZones` is the same data the mask is built from.
  assert.deepEqual(openingExclusionZones([opening]), mask.zones);
});

test('adding a second opening does not shift the first opening contour', () => {
  const wall = wallWith({ id: 'door-a', kind: 'door', s: 12, width: 2.4, height: 2.2, sill: 0, profile: 'round' });
  const first = wall.opening;
  const second = { ...first, id: 'door-b', s: 20, width: 1.2 };
  const y = 0.84;

  const aloneGap = voidGap(survivingIntervals([0, WALL_LENGTH], [first], y), first.s);
  const withSecondGap = voidGap(survivingIntervals([0, WALL_LENGTH], [first, second], y), first.s);
  assert.deepEqual(withSecondGap, aloneGap);

  const bandAlone = survivingIntervalsOverBand([first.s - 3, first.s + 3], [first], [0.5, 1.1]);
  const bandWithSecond = survivingIntervalsOverBand([first.s - 3, first.s + 3], [first, second], [0.5, 1.1]);
  assert.deepEqual(bandWithSecond, bandAlone);

  const maskAlone = createOpeningExclusionMask([first]);
  const maskWithSecond = createOpeningExclusionMask([first, second]);
  assert.deepEqual(maskWithSecond.zones[0], maskAlone.zones[0]);

  // And the built core around the first opening is unmoved.
  const descriptorsAlone = mortarDescriptors(pack(wall, [first]).stones, wall.arcTable);
  const descriptorsBoth = mortarDescriptors(pack(wall, [first, second]).stones, wall.arcTable);
  const aloneCore = buildMortarCoreGeometry(descriptorsAlone, { openings: [first] });
  const bothCore = buildMortarCoreGeometry(descriptorsBoth, { openings: [first, second] });
  // And the void the built core leaves at the first opening is unmoved. Stones
  // elsewhere may re-stagger, but the contour at the first opening may not.
  const coreGap = (geometry) => voidGap(mortarSpansAt(geometry, y), first.s);
  assert.deepEqual(coreGap(bothCore), coreGap(aloneCore));
  aloneCore.dispose();
  bothCore.dispose();
});
