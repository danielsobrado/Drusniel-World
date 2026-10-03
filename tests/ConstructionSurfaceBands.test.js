import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeConstructionRecord } from '../src/editor/construction/ConstructionSchema.js';
import { createCubicBezierPathFromStroke } from '../src/editor/construction/curve/CubicBezierPath.js';
import { planConstruction } from '../src/editor/construction/planning/ConstructionPlanner.js';
import { constructionStyle, defineConstructionStyle } from '../src/editor/construction/masonry/ConstructionStyleCatalog.js';
import { createWallCourseTable, groupWallCourseBands } from '../src/editor/construction/masonry/WallCourseTable.js';
import { surfaceValueAt } from '../src/editor/construction/masonry/SurfaceValueField.js';
import { constructionStoneColorMultipliers } from '../src/editor/construction/compile/ConstructionStoneColorGrade.js';
import { layoutMerlon } from '../src/editor/construction/masonry/MerlonOrnament.js';
import { uncoveredFaceShare } from '../scripts/lib/constructionFaceCoverage.mjs';

function record({ seed = 3141, height = 3.2, curved = false, top = 'flat' } = {}) {
  return normalizeConstructionRecord({ version: 1, id: 'surface-qa', revision: 1, seed,
    style: { key: 'glade-sandstone' }, dimensions: { height, thickness: 0.8 }, top: { style: top },
    path: createCubicBezierPathFromStroke(curved ? [[-5, 3], [-5, 0], [-3, -3], [0, -4], [3, -3], [5, 0], [5, 3]]
      : [[0, 0], [24, 0]], { simplifyTolerance: 0.02 }), features: [] });
}

test('paired bands keep a footing and share their grid despite different local crowns', () => {
  const make = bodyHeight => {
    const table = createWallCourseTable({ courseHeight: 0.4, footing: { heightRatio: 1.2 }, wallHeight: 3.2, bodyHeight });
    assert.equal(groupWallCourseBands(table, { courseHeight: 0.4 }), table);
    return groupWallCourseBands(table, { courseHeight: 0.4, coursesPerBand: 2 });
  };
  const low = make(2.3); const high = make(3.2);
  assert.equal(low.heightOf(0), 0.48);
  assert.ok(low.count < high.count);
  for (let band = 0; band < low.count; band += 1) {
    assert.equal(low.baseAt(band), high.baseAt(band));
    assert.equal(low.heightOf(band), high.heightOf(band));
    assert.ok(Math.abs(low.baseAt(band) + low.heightOf(band) - low.baseAt(band + 1)) < 1e-12);
  }
  const style = constructionStyle('glade-sandstone');
  for (const value of [0, 1.5, 3]) assert.throws(() => defineConstructionStyle({ ...style, coursesPerBand: value }), /coursesPerBand/);
});

test('sandstone bands contain uprights and fitted inserts across seeds', () => {
  for (const seed of [1, 35, 3141, 8192]) {
    const plan = planConstruction(record({ seed }));
    const field = plan.modules.flatMap(module => module.placements).filter(stone => stone.category === 'field' && !stone.footing);
    assert.ok(field.some(stone => stone.height > 0.6), `seed ${seed} lacks an upright spanning ordinary rows`);
    assert.ok(field.some(stone => stone.height < 0.3), `seed ${seed} lacks fitted smaller inserts`);
    assert.ok(field.some(stone => stone.height > stone.width * 1.4));
    assert.ok(field.some(stone => stone.width > stone.height * 1.4));
    assert.deepEqual(planConstruction(record({ seed })), plan);
    const ids = field.map(stone => stone.stableIndex);
    assert.equal(new Set(ids).size, ids.length, 'subdivision keeps distinct shape identities');
  }
});

test('paired sandstone footprints cover short, standard and tall curved walls across modules', () => {
  for (const curved of [false, true]) for (const height of [0.8, 3.2, 5.5]) {
    const plan = planConstruction(record({ height, curved }));
    assert.ok(plan.modules.every(module => !module.masonryStats.overBudget));
    const share = uncoveredFaceShare(plan.modules.flatMap(module => module.placements), {
      length: plan.totalLength, bodyTop: height - constructionStyle('glade-sandstone').coping.height,
      step: 0.04, rise: 0.02, jointTolerance: 0.01,
    });
    assert.ok(share < 0.002, `height ${height}, curve ${curved}: ${(share * 100).toFixed(3)}% uncovered`);
  }
});

test('surface fields are bounded and continuous across seams and negative coordinates', () => {
  for (let s = -12; s <= 12; s += 1.4) {
    const a = surfaceValueAt(3141, s, 1.1, 1.4, 1.1, 0x4b7a90cd);
    const b = surfaceValueAt(3141, s + 1e-6, 1.1, 1.4, 1.1, 0x4b7a90cd);
    assert.ok(a >= 0 && a <= 1);
    assert.ok(Math.abs(a - b) < 1e-5);
    assert.equal(a, surfaceValueAt(3141, s, 1.1, 1.4, 1.1, 0x4b7a90cd));
  }
});

test('color patches preserve individual stone variation and respect authored materials', () => {
  const input = { styleKey: 'glade-sandstone', seed: 3141, category: 'field', surface: { s: 8, y: 1 } };
  const tones = Array.from({ length: 128 }, (_, stableIndex) => constructionStoneColorMultipliers({ ...input, stableIndex }));
  const red = tones.map(tone => tone[0]);
  assert.ok(Math.max(...red) - Math.min(...red) > 0.08, 'patch must retain darker and lighter stones');
  assert.ok(tones.some(tone => tone[0] > tone[1] && tone[1] > tone[2]), 'warm related tones survive');
  const a = constructionStoneColorMultipliers({ ...input, stableIndex: 100 });
  const b = constructionStoneColorMultipliers({ ...input, stableIndex: 100, surface: { s: 8 + 1e-6, y: 1 } });
  a.forEach((channel, i) => assert.ok(Math.abs(channel - b[i]) < 1e-5));
  assert.equal(constructionStoneColorMultipliers({ ...input, stableIndex: 100, hasCustomStoneMaterial: true }), null);
  assert.equal(constructionStoneColorMultipliers({ ...input, styleKey: 'ashlar', stableIndex: 100 }), null);
});

test('small crenellations use seated full-sized stones without spurious arrow slits', () => {
  const style = constructionStyle('glade-sandstone');
  for (let index = 0; index < 64; index += 1) {
    const merlon = { s: 12, width: 0.495, base: 3.2, height: style.merlonHeight };
    const result = layoutMerlon(merlon, { minWidth: style.minWidth, thickness: 0.8, seed: 3141,
      index: 28000 + index * 16, courseHeight: style.merlonCourseHeight });
    assert.equal(result.rows, 1);
    assert.equal(result.pierced, false);
    for (const unit of result.units) {
      assert.ok(unit.y - unit.height / 2 >= merlon.base - 1e-9);
      assert.ok(unit.y + unit.height / 2 <= merlon.base + merlon.height + 1e-9);
    }
    assert.ok(result.units.some(unit => Math.abs(unit.y - unit.height / 2 - merlon.base) < 1e-9));
  }
});
