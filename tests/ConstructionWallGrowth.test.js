import assert from 'node:assert/strict';
import test from 'node:test';
import { planWallGrowth } from '../src/editor/construction/masonry/WallGrowth.js';
import { createCubicBezierPathFromStroke, sampleCubicBezierPath } from '../src/editor/construction/curve/CubicBezierPath.js';
import { createCurveArcTable } from '../src/editor/construction/masonry/CurveArcTable.js';
import { normalizeConstructionRecord } from '../src/editor/construction/ConstructionSchema.js';
import { ConstructionStore } from '../src/editor/construction/ConstructionStore.js';
import { executeConstructionCommand } from '../src/editor/construction/ConstructionCommands.js';
import { survivingIntervalsOverBand } from '../src/editor/construction/masonry/OpeningLayout.js';
import { CONSTRUCTION_GROWTH_PROFILES } from '../src/editor/construction/config/ConstructionGrowthProfiles.generated.js';
import { createConstructionDraft, drawingLookFromRecord } from '../src/editor/construction/ConstructionDrawingLook.js';
import { constructionCollisionSource } from '../src/editor/collision/providers/ConstructionCollisionSource.js';
import { buildConstructionGrowth } from '../src/editor/construction/compile/ConstructionGrowthBuilder.js';
import { createConstructionMaterials, releaseConstructionMaterials } from '../src/editor/construction/render/ConstructionMaterials.js';
import { createGrowthSurfaceSampler } from '../src/editor/construction/compile/ConstructionGrowthSurface.js';
import { MasonryVertexWriter } from '../src/editor/construction/compile/MasonryVertexWriter.js';
import { writeIvyLeaf, writeIvyStem } from '../src/editor/construction/compile/ConstructionIvyMesher.js';

function fixture() {
  const path = createCubicBezierPathFromStroke([[0, 0], [40, 0]]);
  const record = normalizeConstructionRecord({ version: 1, id: 'growth-qa', revision: 1, seed: 3141,
    style: { key: 'glade-sandstone' }, dimensions: { height: 3.2, thickness: 0.8 },
    top: { style: 'flat' }, path, features: [] });
  return { record, arcTable: createCurveArcTable(sampleCubicBezierPath(path)) };
}

test('growth is deterministic, module-owned, bounded and independent of masonry randomness', () => {
  const { record, arcTable } = fixture();
  const all = planWallGrowth(record, arcTable, [0, 40]);
  assert.ok(all.length > 0);
  const left = planWallGrowth(record, arcTable, [0, 8]);
  const right = planWallGrowth(record, arcTable, [8, 16]);
  assert.deepEqual(planWallGrowth(record, arcTable, [0, 8]), left);
  assert.ok(!left.some(leaf => right.some(other => other.id === leaf.id)), 'a seam must not duplicate a patch');
  assert.ok(left.length <= CONSTRUCTION_GROWTH_PROFILES['glade-sandstone'].maxLeavesPerModule);
  const changed = { ...record, style: { ...record.style, materials: { stone: 'limestone' } } };
  assert.deepEqual(planWallGrowth(changed, arcTable, [0, 8]), left);
  assert.deepEqual(planWallGrowth({ ...record, style: { ...record.style, growth: 'none' } }, arcTable, [0, 8]), []);
});

test('growth respects the full leaf footprint around openings and keeps distant patches stable', () => {
  const { record, arcTable } = fixture();
  const opening = { id: 'door', kind: 'arch', segmentId: record.path.segments[0].id,
    arcFraction: 0.12, s: 4.8, width: 3, height: 2.5, sill: 0, profile: 'round', dressed: true };
  const changed = { ...record, features: [opening] };
  const leaves = planWallGrowth(changed, arcTable, [0, 12]);
  for (const leaf of leaves) {
    const { s, y, radius } = leaf;
    const allowed = survivingIntervalsOverBand([s - radius, s + radius], [opening],
      [Math.max(0, y - radius), y + radius], { clearance: 0.16 });
    assert.equal(allowed.length, 1);
    assert.ok(Math.abs(allowed[0][1] - allowed[0][0] - radius * 2) < 1e-7);
  }
  assert.deepEqual(planWallGrowth(changed, arcTable, [24, 36]), planWallGrowth(record, arcTable, [24, 36]));
});

test('growth edits persist, undo, and match without invalidating the collision revision', () => {
  const { record } = fixture();
  const store = new ConstructionStore();
  store.add(record);
  const collisionRevision = constructionCollisionSource.activeRevisions.get(record.id);
  const edit = executeConstructionCommand(store, { type: 'set_growth', constructionId: record.id, growth: 'none' });
  assert.equal(edit.decorationOnly, true);
  assert.equal(constructionCollisionSource.activeRevisions.get(record.id), collisionRevision);
  const loaded = new ConstructionStore();
  loaded.loadDocument(store.toDocument());
  assert.equal(loaded.get(record.id).style.growth, 'none');
  const draft = createConstructionDraft(record.path, 'growth-copy', {
    height: 3.2, thickness: 0.8, look: drawingLookFromRecord(store.get(record.id)),
  });
  assert.equal(draft.style.growth, 'none');
  store.applyChange(edit, 'undo');
  assert.notEqual(store.get(record.id).style.growth, 'none');
  store.applyChange(edit, 'redo');
  assert.equal(store.get(record.id).style.growth, 'none');
  assert.throws(() => executeConstructionCommand(store, { type: 'set_growth', constructionId: record.id, growth: 'lots' }), /growth/);
});

test('ivy stems touch the terrain on both faces of a wall across a slope', () => {
  const { record, arcTable } = fixture();
  const pathInterval = [0, 12];
  const materials = createConstructionMaterials(record);
  const groundHeightAt = (x, z) => x * 0.1 + z * 0.5;
  const mesh = buildConstructionGrowth({ record, materials, arcTable, pathInterval,
    moduleOrigin: { x: 32, z: -16 }, groundHeightAt });
  try {
    const p = mesh.geometry.attributes.position;
    let roots = 0;
    const sides = new Set();
    for (let index = 0; index < p.count; index += 1) {
      const x = p.getX(index) + 32; const z = p.getZ(index) - 16;
      if (Math.abs(p.getY(index) - groundHeightAt(x, z) - 0.005) < 0.00001) {
        roots += 1; sides.add(Math.sign(z));
      }
    }
    assert.ok(roots >= 4, 'inspect several rooted stems');
    assert.equal(sides.size, 2, 'both wall faces have grounded roots');
  } finally { mesh.geometry.dispose(); releaseConstructionMaterials(materials); }
});

test('growth attachment follows a proud stone on both faces without moving distant attachment', () => {
  const { record, arcTable } = fixture();
  const stone = { s: 3, y: 1, width: 0.6, height: 0.4, depth: 0.8,
    offsetNormal: 0, roll: 0, stableIndex: 4, category: 'field' };
  const sampler = createGrowthSurfaceSampler({ record, arcTable, placements: [stone] });
  const moved = createGrowthSurfaceSampler({ record, arcTable, placements: [{ ...stone, offsetNormal: 0.12 }] });
  assert.ok(Math.abs(moved(3, 1, 0.1, 1) - sampler(3, 1, 0.1, 1) - 0.12) < 1e-9);
  assert.ok(Math.abs(moved(3, 1, 0.1, -1) - sampler(3, 1, 0.1, -1) + 0.12) < 1e-9);
  assert.equal(moved(20, 1, 0.1, 1), sampler(20, 1, 0.1, 1));
  assert.ok(sampler(3, 1, 0.1, 1) > 0.35 && sampler(3, 1, 0.1, 1) < 0.45);
});

test('folded ivy has bounded leaf footprints, outward facets and finite complete streams', () => {
  for (const shape of ['heart', 'lobed']) for (const side of [-1, 1]) {
    const writer = new MasonryVertexWriter();
    const leaf = { s: 2, y: 1, side, radius: 0.18, angle: 1.3, shape, outward: 0.03, fold: 0.015, tilt: -0.08 };
    writeIvyLeaf(writer, leaf, (s, y, outward) => [s, y, side * (0.4 + outward)], { r: 0.4, g: 0.5, b: 0.2 });
    const arrays = writer.toArrays();
    assert.ok(arrays.triangleCount > 4, 'a shaped leaf has more than the former diamond outline');
    for (let i = 0; i < arrays.vertexCount; i += 1) {
      const x = arrays.positions[i * 3]; const y = arrays.positions[i * 3 + 1];
      assert.ok(Math.hypot(x - leaf.s, y - leaf.y) <= leaf.radius + 1e-6, 'opening masks bound every leaf vertex');
      const n = arrays.normals.subarray(i * 3, i * 3 + 3);
      assert.ok(Math.abs(Math.hypot(...n) - 1) < 1e-6);
      assert.ok(n[2] * side > 0, 'both leaf faces have outward winding');
    }
    for (const values of [arrays.positions, arrays.normals, arrays.colors, arrays.uvs]) {
      assert.ok(values.every(Number.isFinite));
    }
    // Cross-section winding is also outward when the wall face is mirrored.
    const stemWriter = new MasonryVertexWriter();
    writeIvyStem(stemWriter, { from: [2, 0.2], to: [2, 1] },
      (s, y, outward) => [s, y, side * (0.4 + outward)], { r: 0.4, g: 0.5, b: 0.2 });
    const stem = stemWriter.toArrays();
    for (let i = 0; i < stem.vertexCount; i += 1) {
      const p = stem.positions.subarray(i * 3, i * 3 + 3);
      const n = stem.normals.subarray(i * 3, i * 3 + 3);
      assert.ok(n[0] * (p[0] - 2) + n[2] * (p[2] - side * 0.414) > 0);
    }
  }
});

test('short walls reduce growth density and branches remain outside opening clearance', () => {
  const { record, arcTable } = fixture();
  const tall = planWallGrowth(record, arcTable, [0, 12]);
  const short = planWallGrowth({ ...record, dimensions: { ...record.dimensions, height: 0.8 },
    top: { ...record.top, base: 0.8 } }, arcTable, [0, 12]);
  assert.ok(short.length > 0 && short.length < tall.length / 2);
  const opening = { id: 'growth-passage', kind: 'arch', segmentId: record.path.segments[0].id,
    arcFraction: 0.12, s: 4.8, width: 3, height: 2.5, sill: 0, profile: 'round', dressed: true };
  for (const leaf of planWallGrowth({ ...record, features: [opening] }, arcTable, [0, 12])) {
    for (const branch of [leaf.stem, leaf.petiole].filter(Boolean)) {
      const range = [Math.min(branch.from[0], branch.to[0]) - 0.012, Math.max(branch.from[0], branch.to[0]) + 0.012];
      const band = [Math.min(branch.from[1], branch.to[1]) - 0.012, Math.max(branch.from[1], branch.to[1]) + 0.012];
      const spans = survivingIntervalsOverBand(range, [opening], band, { clearance: 0.15 });
      assert.equal(spans.length, 1);
      assert.ok(Math.abs(spans[0][1] - spans[0][0] - range[1] + range[0]) < 1e-7);
    }
  }
});
