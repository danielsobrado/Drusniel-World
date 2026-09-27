import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeConstructionRecord } from '../src/editor/construction/ConstructionSchema.js';
import {
  createCubicBezierPathFromStroke,
  sampleCubicBezierPath,
} from '../src/editor/construction/curve/CubicBezierPath.js';
import { createBedField, resolveCellCorners } from '../src/editor/construction/masonry/CourseLattice.js';
import { createCurveArcTable } from '../src/editor/construction/masonry/CurveArcTable.js';
import { constructionStyle } from '../src/editor/construction/masonry/ConstructionStyleCatalog.js';
import { packCurvedWall } from '../src/editor/construction/masonry/CurvedCoursePacker.js';
import {
  createWallCourseTable,
  footingCourseHeight,
} from '../src/editor/construction/masonry/WallCourseTable.js';
import { createWallTopProfile } from '../src/editor/construction/masonry/WallTopProfile.js';
import { coarsePlacements } from '../src/editor/construction/render/ConstructionLod.js';

const ROUNDED = constructionStyle('rounded-fieldstone');

function setup({ length = 24, height = 3.5, thickness = 0.8, top = 'flat', key = 'rounded-fieldstone' } = {}) {
  const record = normalizeConstructionRecord({
    version: 1,
    id: 'construction-1',
    revision: 1,
    seed: 3141,
    kind: 'wall',
    style: { key, version: 1 },
    dimensions: { height, thickness },
    top: { style: top },
    path: createCubicBezierPathFromStroke([
      [0, 0], [length / 3, 0], [(length * 2) / 3, 0], [length, 0],
    ], { simplifyTolerance: 0.01 }),
    features: [],
  });
  const style = constructionStyle(key);
  const arcTable = createCurveArcTable(sampleCubicBezierPath(record.path));
  const profile = createWallTopProfile(record, arcTable, { style });
  return { record, style, arcTable, profile };
}

function pack(context, { arcRange, seedOffset = 0 } = {}) {
  return packCurvedWall({
    arcTable: context.arcTable,
    arcRange: arcRange ?? [0, context.arcTable.totalLength],
    style: context.style,
    thickness: context.record.dimensions.thickness,
    seed: context.record.seed,
    seedOffset,
    wallRange: [0, context.arcTable.totalLength],
    courseHeight: context.style.courseHeight,
    heightReference: context.record.dimensions.height,
    topHeightAt: context.profile.heightAt,
    ruinFactorAt: context.profile.ruinFactorAt,
    slopeAt: context.profile.slopeAt,
    topStyle: context.record.top.style,
  });
}

test('without a footing the table is the uniform grid, to the bit', () => {
  const courseHeight = 0.56;
  const table = createWallCourseTable({ courseHeight, wallHeight: 3.5, bodyHeight: 3.34 });
  assert.equal(table.footingHeight, 0);
  assert.equal(table.baseAt, null);
  assert.equal(table.count, Math.max(1, Math.ceil(3.34 / courseHeight)));
  for (let course = 0; course < 8; course += 1) {
    assert.equal(table.centerAt(course), (course + 0.5) * courseHeight);
    assert.equal(table.heightOf(course), courseHeight);
  }
});

test('a footing course is taller, and every course above keeps its height', () => {
  const table = createWallCourseTable({
    courseHeight: 0.5,
    footing: ROUNDED.footing,
    wallHeight: 3.5,
    bodyHeight: 3.26,
  });
  assert.equal(table.footingHeight, 0.75);
  assert.equal(table.baseAt(0), 0);
  assert.equal(table.baseAt(1), 0.75);
  assert.ok(Math.abs(table.baseAt(3) - 1.75) < 1e-12);
  assert.equal(table.heightOf(0), 0.75);
  assert.equal(table.heightOf(4), 0.5);
  assert.ok(Math.abs(table.centerAt(0) - 0.375) < 1e-12);
  assert.equal(table.count, 1 + Math.ceil((3.26 - 0.75) / 0.5));
});

test('a low wall gets a shallower footing, never a shorter one than a course', () => {
  const footing = ROUNDED.footing;
  assert.equal(footingCourseHeight({ courseHeight: 0.5, footing, wallHeight: 1 }), 0.5);
  assert.ok(Math.abs(footingCourseHeight({ courseHeight: 0.5, footing, wallHeight: 1.6 }) - 0.64) < 1e-12);
  assert.equal(footingCourseHeight({ courseHeight: 0.5, footing, wallHeight: 6 }), 0.75);
  assert.equal(footingCourseHeight({ courseHeight: 0.5, footing: null, wallHeight: 6 }), 0);
});

test('the lattice keeps its own arithmetic unless given a course table', () => {
  const bedOffset = createBedField(7, 0.5, { amplitude: 0.1 });
  const cell = { courseIndex: 2, s0: 1, s1: 2, v0: 0, v1: 1 };
  const uniform = resolveCellCorners(cell, { bedOffset, courseHeight: 0.5 });
  const viaTable = resolveCellCorners(cell, {
    bedOffset,
    courseHeight: 0.5,
    courseBaseAt: (course) => course * 0.5,
  });
  assert.deepEqual(viaTable, uniform);

  const footed = resolveCellCorners(cell, {
    bedOffset,
    courseHeight: 0.5,
    courseBaseAt: (course) => (course <= 0 ? 0 : 0.75 + (course - 1) * 0.5),
  });
  assert.ok(Math.abs((footed.anchorY - uniform.anchorY) - 0.25) < 1e-9);
});

test('rounded fieldstone packs a buried-footing course of big plinth stones', () => {
  const context = setup();
  const { stones } = pack(context);
  const footing = stones.filter((stone) => stone.footing);
  const field = stones.filter((stone) => stone.category === 'field' && !stone.footing);
  assert.ok(footing.length > 0);
  assert.ok(footing.every((stone) => stone.courseIndex === 0));
  assert.ok(field.every((stone) => stone.courseIndex > 0));
  assert.ok(footing.every((stone) => stone.support.role === 'foundation'));

  const meanWidth = (list) => list.reduce((sum, stone) => sum + stone.width, 0) / list.length;
  const meanHeight = (list) => list.reduce((sum, stone) => sum + stone.height, 0) / list.length;
  assert.ok(meanWidth(footing) > meanWidth(field) * 1.15);
  assert.ok(meanHeight(footing) > meanHeight(field) * 1.3);
  const thickness = context.record.dimensions.thickness;
  for (const stone of footing) {
    assert.ok(stone.depth > thickness * ROUNDED.depthScaleMin + ROUNDED.footing.plinth * 2 - 1e-9);
  }
});

test('the capstone course takes its size from the style', () => {
  const context = setup();
  const { stones } = pack(context);
  const coping = stones.filter((stone) => stone.category === 'coping');
  assert.ok(coping.length > 0);
  for (const stone of coping) {
    assert.equal(stone.height, ROUNDED.coping.height);
    assert.ok(Math.abs(stone.depth - context.record.dimensions.thickness * ROUNDED.coping.oversail) < 1e-12);
    assert.ok(Math.abs(stone.y - (3.5 - ROUNDED.coping.height / 2)) < 1e-9);
  }
});

test('modules either side of a seam lay the same footing course', () => {
  const context = setup();
  const total = context.arcTable.totalLength;
  const left = pack(context, { arcRange: [0, total / 2], seedOffset: 0 }).stones;
  const right = pack(context, { arcRange: [total / 2, total], seedOffset: 1 }).stones;
  const band = (stones) => {
    const footing = stones.filter((stone) => stone.footing);
    return {
      top: Math.max(...footing.map((stone) => stone.support.top)),
      bottom: Math.min(...footing.map((stone) => stone.support.bottom)),
    };
  };
  const budget = ROUNDED.bedAmplitude * ROUNDED.courseHeight * 2;
  const a = band(left);
  const b = band(right);
  assert.ok(Math.abs(a.top - b.top) <= budget, `${a.top} vs ${b.top}`);
  assert.ok(a.bottom >= 0 && b.bottom >= 0);
});

test('coarse LOD keeps footing stones whole and out of course pairing', () => {
  const context = setup();
  const { stones } = pack(context);
  const coarse = coarsePlacements(stones, { styleKey: 'rounded-fieldstone' });
  const nearFooting = stones.filter((stone) => stone.footing);
  const coarseFooting = coarse.filter((stone) => stone.footing);
  assert.deepEqual(
    coarseFooting.map((stone) => stone.stableIndex).sort((a, b) => a - b),
    nearFooting.map((stone) => stone.stableIndex).sort((a, b) => a - b),
  );
  for (const stone of coarseFooting) {
    const near = nearFooting.find((candidate) => candidate.stableIndex === stone.stableIndex);
    assert.equal(stone.height, near.height);
    assert.equal(stone.y, near.y);
  }
});
