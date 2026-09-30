import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeConstructionRecord } from '../src/editor/construction/ConstructionSchema.js';
import {
  createCubicBezierPathFromStroke,
  sampleCubicBezierPath,
} from '../src/editor/construction/curve/CubicBezierPath.js';
import { createCurveArcTable } from '../src/editor/construction/masonry/CurveArcTable.js';
import { CONSTRUCTION_STYLE_KEYS } from '../src/editor/construction/masonry/ConstructionStyleCatalog.js';
import { planConstruction } from '../src/editor/construction/planning/ConstructionPlanner.js';
import { reachesIntoVoid, stoneCellPolygons } from './helpers/openingVoidOverlap.js';

/** The clearance an opening keeps between its void and the nearest stone. */
const JOINT_CLEARANCE = 0.018;

/**
 * The QA wall: a curve, a door and a window. The window's 1.1 m sill sits inside
 * a course in most styles and both arch crowns inside another, which is what
 * let stones reach up into the window and run across the arches while openings
 * were cut at each course's centre height.
 */
function qaWall(styleKey, { doorProfile = 'round', windowProfile = 'round' } = {}) {
  const path = createCubicBezierPathFromStroke([
    [0, 0], [6, 0], [12, 0], [14, 1], [18, 4], [21, 7], [24, 8],
  ], { simplifyTolerance: 0.02 });
  return normalizeConstructionRecord({
    version: 1,
    id: `clearance-${styleKey}`,
    revision: 1,
    seed: 3141,
    kind: 'wall',
    style: { key: styleKey, version: 1 },
    dimensions: { height: 3.5, thickness: 0.8 },
    top: { style: 'flat' },
    path,
    features: [
      {
        id: 'door-1',
        kind: 'door',
        segmentId: path.segments[0].id,
        arcFraction: 0.55,
        width: 2.2,
        height: 2.6,
        sill: 0,
        profile: doorProfile,
        dressed: true,
        group: null,
      },
      {
        id: 'window-1',
        kind: 'window',
        segmentId: path.segments[Math.min(2, path.segments.length - 1)].id,
        arcFraction: 0.4,
        width: 1.2,
        height: 1.4,
        sill: 1.1,
        profile: windowProfile,
        dressed: true,
        group: null,
      },
    ],
  });
}

function openingsInArc(record) {
  const arcTable = createCurveArcTable(sampleCubicBezierPath(record.path));
  return record.features.map((feature) => ({
    ...feature,
    s: arcTable.toArc(feature.segmentId, feature.arcFraction),
  }));
}

const PROFILE_PAIRS = [
  { doorProfile: 'round', windowProfile: 'round' },
  { doorProfile: 'pointed', windowProfile: 'flat' },
  { doorProfile: 'segmental', windowProfile: 'pointed' },
  { doorProfile: 'flat', windowProfile: 'segmental' },
];

test('no near field stone reaches into an opening void, in any style or profile', () => {
  for (const styleKey of CONSTRUCTION_STYLE_KEYS) {
    for (const profiles of PROFILE_PAIRS) {
      const record = qaWall(styleKey, profiles);
      const openings = openingsInArc(record);
      const field = planConstruction(record).modules
        .flatMap((module) => module.placements ?? [])
        .filter(({ category }) => category === 'field');
      assert.ok(field.length > 100, `${styleKey} should lay a real wall`);
      for (const stone of field) {
        for (const opening of openings) {
          assert.ok(
            stoneCellPolygons(stone).every((polygon) => (
              !reachesIntoVoid(polygon, opening, JOINT_CLEARANCE)
            )),
            `${styleKey} ${opening.profile} ${opening.id}: course ${stone.courseIndex} `
              + `stone at s=${stone.s.toFixed(3)} y=${stone.y.toFixed(3)} reaches into the void`,
          );
        }
      }
    }
  }
});

test('the void check itself catches a stone in the window', () => {
  const window = { s: 10, width: 1.2, height: 1.4, sill: 1.1, profile: 'round' };
  // A course band 0.75–1.25 under the window: 15 cm into it.
  const intoSill = [[[9.5, 0.75], [10.5, 0.75], [10.5, 1.25], [9.5, 1.25]]];
  assert.ok(reachesIntoVoid(intoSill, window, JOINT_CLEARANCE));
  // Across the arch below the 2.5 m crown.
  const acrossCrown = [[[9, 2.24], [11, 2.24], [11, 2.77], [9, 2.77]]];
  assert.ok(reachesIntoVoid(acrossCrown, window, JOINT_CLEARANCE));
  // Beside the jamb, clear of it.
  const beside = [[[10.62, 1.0], [11.2, 1.0], [11.2, 1.8], [10.62, 1.8]]];
  assert.ok(!reachesIntoVoid(beside, window, JOINT_CLEARANCE));
  // Spanning the window but cut to its contour: the hole is the void itself.
  const hole = [[9.38, 1.08], [10.62, 1.08], [10.62, 2.1], [9.38, 2.1]];
  const fitted = [[[9, 0.75], [11, 0.75], [11, 2.1], [9, 2.1]], hole];
  assert.ok(!reachesIntoVoid(fitted, window, JOINT_CLEARANCE));
});
