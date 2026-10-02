import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeConstructionRecord } from '../src/editor/construction/ConstructionSchema.js';
import { createArcGroundTable, createStoneDrape } from '../src/editor/construction/compile/ConstructionArcGround.js';
import { buildModuleMasonry } from '../src/editor/construction/compile/ConstructionMasonryBuilder.js';
import { footingBurial } from '../src/editor/construction/compile/ConstructionRoundedMasonryBuilder.js';
import {
  createCubicBezierPathFromStroke,
  sampleCubicBezierPath,
} from '../src/editor/construction/curve/CubicBezierPath.js';
import { createCurveArcTable } from '../src/editor/construction/masonry/CurveArcTable.js';
import { constructionStyle } from '../src/editor/construction/masonry/ConstructionStyleCatalog.js';
import { packCurvedWall } from '../src/editor/construction/masonry/CurvedCoursePacker.js';
import { createWallTopProfile } from '../src/editor/construction/masonry/WallTopProfile.js';
import { CONSTRUCTION_MATERIAL_SLOT } from '../src/editor/construction/render/ConstructionMaterialSlots.js';
import {
  createConstructionMaterials,
  disposeConstructionMaterials,
} from '../src/editor/construction/render/ConstructionMaterials.js';
import { coarsePlacements } from '../src/editor/construction/render/ConstructionLod.js';
import { mortarConfigForStyle } from '../src/editor/construction/render/ConstructionMortarConfig.js';

const ROUNDED = constructionStyle('rounded-fieldstone');

function wall({ key = 'rounded-fieldstone', length = 12, top = 'flat' } = {}) {
  const record = normalizeConstructionRecord({
    version: 1,
    id: 'construction-1',
    revision: 1,
    seed: 3141,
    kind: 'wall',
    style: { key, version: 1 },
    dimensions: { height: 3.5, thickness: 0.8 },
    top: { style: top },
    path: createCubicBezierPathFromStroke([
      [0, 0], [length / 3, 0], [(length * 2) / 3, 0], [length, 0],
    ], { simplifyTolerance: 0.01 }),
    features: [],
  });
  const style = constructionStyle(key);
  const arcTable = createCurveArcTable(sampleCubicBezierPath(record.path));
  const profile = createWallTopProfile(record, arcTable, { style });
  const { stones } = packCurvedWall({
    arcTable,
    arcRange: [0, arcTable.totalLength],
    style,
    thickness: record.dimensions.thickness,
    seed: record.seed,
    heightReference: record.dimensions.height,
    topHeightAt: profile.heightAt,
    ruinFactorAt: profile.ruinFactorAt,
    slopeAt: profile.slopeAt,
    topStyle: record.top.style,
  });
  return { record, arcTable, placements: stones, materials: createConstructionMaterials(record) };
}

function build(context, { groundHeightAt = () => 0, lodBand = 'near', placements } = {}) {
  return buildModuleMasonry(placements ?? context.placements, {
    record: context.record,
    materials: context.materials,
    arcTable: context.arcTable,
    moduleOrigin: { x: 0, z: 0 },
    groundHeightAt,
    lodBand,
  });
}

function dispose(built) {
  for (const mesh of built.meshes) mesh.geometry.dispose();
}

test.afterEach(() => {
  disposeConstructionMaterials();
});

test('a rounded module keeps the mortar-then-stone contract', () => {
  const context = wall();
  const built = build(context);
  assert.equal(built.meshes.length, 2);
  const [mortar, stone] = built.meshes;
  assert.equal(mortar.userData.constructionMaterialSlot, CONSTRUCTION_MATERIAL_SLOT.MORTAR);
  assert.equal(stone.userData.constructionMaterialSlot, CONSTRUCTION_MATERIAL_SLOT.STONE);
  assert.equal(mortar.material, context.materials.mortar);
  assert.equal(stone.material, context.materials.stone);
  assert.equal(stone.userData.constructionGeometryTier, 'rounded-near');
  assert.equal(stone.userData.constructionStyleKey, 'rounded-fieldstone');
  assert.equal(stone.castShadow, true);
  assert.equal(mortar.castShadow, false);
  dispose(built);
});

test('the stone mesh carries exactly four vertex streams, all fully populated', () => {
  const context = wall();
  const built = build(context);
  const geometry = built.meshes[1].geometry;
  assert.deepEqual(Object.keys(geometry.attributes).sort(), ['color', 'normal', 'position', 'uv']);
  const count = geometry.getAttribute('position').count;
  assert.equal(geometry.getAttribute('color').count, count);
  assert.equal(geometry.getAttribute('normal').count, count);
  assert.equal(geometry.getAttribute('uv').count, count);
  assert.ok(geometry.index);
  assert.ok(geometry.boundingSphere);
  dispose(built);
});

test('every stone is rounded, footing stones are counted, stats add up', () => {
  const context = wall();
  const built = build(context);
  const { stats } = built;
  assert.equal(stats.stones, context.placements.length);
  assert.equal(stats.roundedStones + stats.roundedFallbacks, stats.stones);
  assert.equal(stats.roundedFallbacks, 0);
  assert.ok(stats.footingStones > 0);
  assert.equal(stats.roundedTriangles, stats.stoneTriangles);
  assert.equal(stats.totalTriangles, stats.stoneTriangles + stats.mortarTriangles);
  assert.ok(stats.stoneTriangles / stats.stones <= 280);
  dispose(built);
});

test('the coarse band is the same stones at a quarter of the triangles', () => {
  const context = wall();
  const near = build(context);
  const coarse = build(context, {
    lodBand: 'coarse',
    placements: coarsePlacements(context.placements, { styleKey: 'rounded-fieldstone' }),
  });
  assert.equal(coarse.meshes[1].userData.constructionGeometryTier, 'rounded-coarse');
  assert.ok(coarse.stats.stoneTriangles / coarse.stats.stones <= 72);
  assert.ok(coarse.stats.stoneTriangles < near.stats.stoneTriangles * 0.3);
  dispose(near);
  dispose(coarse);
});

test('sandstone distance geometry preserves its cells with one third of the stone triangles', () => {
  const context = wall({ key: 'glade-sandstone' });
  const near = build(context);
  const placements = coarsePlacements(context.placements, { styleKey: context.record.style.key });
  const coarse = build(context, { lodBand: 'coarse', placements });
  assert.equal(placements, context.placements);
  assert.equal(coarse.stats.stones, near.stats.stones);
  assert.equal(coarse.stats.roundedFallbacks, 0);
  assert.equal(coarse.stats.stoneTriangles * 3, near.stats.stoneTriangles);
  assert.equal(coarse.stats.mortarTriangles, near.stats.mortarTriangles);
  assert.equal(coarse.meshes.length, 2, 'detail stays batched');
  dispose(near);
  dispose(coarse);
});

test('mortar sits deep behind the rounded faces', () => {
  const context = wall();
  const built = build(context);
  const mortar = built.meshes[0].geometry.boundingBox;
  const stone = built.meshes[1].geometry.boundingBox;
  const recess = mortarConfigForStyle('rounded-fieldstone').faceRecess;
  assert.ok(recess > mortarConfigForStyle('coursed-rubble').faceRecess);
  assert.ok(mortar.max.z < stone.max.z - recess);
  assert.ok(mortar.min.z > stone.min.z + recess);
  dispose(built);
});

test('draping carries the wall up a slope instead of stepping each stone', () => {
  const context = wall({ length: 12 });
  const slope = 0.12;
  const built = build(context, { groundHeightAt: (x) => slope * x });
  const box = built.meshes[1].geometry.boundingBox;
  assert.ok(box.max.y > 3.5 + slope * 12 - 0.1, `top ${box.max.y}`);
  assert.ok(box.min.y < 0.1, `bottom ${box.min.y}`);
  dispose(built);
});

test('two stones sharing a joint read the same ground there', () => {
  const context = wall({ length: 12 });
  const ground = createArcGroundTable({
    arcTable: context.arcTable,
    groundHeightAt: (x, z) => 0.3 * Math.sin(x) + 0.05 * z,
    from: 0,
    to: 12,
  });
  const frameA = context.arcTable.frameAt(3);
  const frameB = context.arcTable.frameAt(4);
  const drapeA = createStoneDrape(ground, {
    s: 3, centerX: frameA.x, centerZ: frameA.z, tangentX: frameA.tangentX, tangentZ: frameA.tangentZ,
  });
  const drapeB = createStoneDrape(ground, {
    s: 4, centerX: frameB.x, centerZ: frameB.z, tangentX: frameB.tangentX, tangentZ: frameB.tangentZ,
  });
  const joint = context.arcTable.frameAt(3.5);
  const a = drapeA.sample(joint.x, joint.z + 0.3, [0, 0]);
  const b = drapeB.sample(joint.x, joint.z + 0.3, [0, 0]);
  assert.ok(Math.abs(a[0] - b[0]) < 1e-9);
  assert.ok(Math.abs(a[1] - b[1]) < 1e-9);
});

test('footing stones reach below the ground falling away under the plinth', () => {
  const frame = { x: 0, z: 0, normalX: 0, normalZ: 1 };
  const placement = { footing: true, offsetNormal: 0 };
  const flat = footingBurial({
    footing: ROUNDED.footing, frame, placement, depth: 0.9, groundHeightAt: () => 0,
  });
  assert.equal(flat, ROUNDED.footing.burialMargin);
  const crossSlope = footingBurial({
    footing: ROUNDED.footing, frame, placement, depth: 0.9, groundHeightAt: (x, z) => 0.4 * z,
  });
  assert.ok(Math.abs(crossSlope - (0.4 * 0.45 + ROUNDED.footing.burialMargin)) < 1e-9);
  const cliff = footingBurial({
    footing: ROUNDED.footing, frame, placement, depth: 0.9, groundHeightAt: (x, z) => 5 * z,
  });
  assert.equal(cliff, ROUNDED.footing.burialMax);
  assert.equal(footingBurial({
    footing: ROUNDED.footing, frame, placement: { footing: false, offsetNormal: 0 }, depth: 0.9, groundHeightAt: () => 0,
  }), 0);
});

test('on a cross slope the footing meets the lower ground', () => {
  const context = wall();
  const built = build(context, { groundHeightAt: (x, z) => 0.4 * z });
  const lowestGroundUnderPlinth = -0.4 * 0.45;
  assert.ok(built.meshes[1].geometry.boundingBox.min.y < lowestGroundUnderPlinth);
  dispose(built);
});

test('a quad the pillow mesher cannot round falls back to a shaded prism', () => {
  const context = wall();
  const field = context.placements.find((placement) => placement.corners && !placement.footing);
  const broken = {
    ...field,
    corners: [[-0.4, -0.2], [0.4, -0.2], [0.4, -0.2], [-0.4, 0.2]],
  };
  const built = build(context, { placements: [broken] });
  assert.equal(built.stats.roundedFallbacks, 1);
  assert.equal(built.stats.roundedStones, 0);
  const geometry = built.meshes.at(-1).geometry;
  assert.equal(geometry.getAttribute('color').count, geometry.getAttribute('position').count);
  dispose(built);
});

test('soft styles still build through the soft path', () => {
  const context = wall({ key: 'coursed-rubble', top: 'irregular' });
  const built = build(context);
  assert.ok(!String(built.meshes[1].userData.constructionGeometryTier).startsWith('rounded'));
  assert.equal(built.stats.roundedStones, undefined);
  dispose(built);
});
