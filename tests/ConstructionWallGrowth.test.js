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
  const leaves = planWallGrowth(record, arcTable, pathInterval);
  const materials = createConstructionMaterials(record);
  const groundHeightAt = (x, z) => x * 0.1 + z * 0.5;
  const mesh = buildConstructionGrowth({ record, materials, arcTable, pathInterval,
    moduleOrigin: { x: 32, z: -16 }, groundHeightAt });
  try {
    const p = mesh.geometry.attributes.position;
    let index = 0;
    let roots = 0;
    for (const leaf of leaves) {
      if (leaf.stem) {
        if (leaf.stem.rooted) for (const offset of [0, 3]) {
          const x = p.getX(index + offset) + 32;
          const z = p.getZ(index + offset) - 16;
          assert.ok(Math.abs(p.getY(index + offset) - groundHeightAt(x, z) - 0.005) < 0.00001);
          roots += 1;
        }
        index += 4;
      }
      index += 5;
    }
    assert.ok(roots >= 4, 'inspect several rooted stems');
  } finally { mesh.geometry.dispose(); releaseConstructionMaterials(materials); }
});
