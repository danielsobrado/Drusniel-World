import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { normalizeConstructionRecord } from '../src/editor/construction/ConstructionSchema.js';
import { createCubicBezierPathFromStroke, sampleCubicBezierPath } from '../src/editor/construction/curve/CubicBezierPath.js';
import { createCurveArcTable } from '../src/editor/construction/masonry/CurveArcTable.js';
import { planWallGroundDetail, GROUND_DETAIL_RADIUS } from '../src/editor/construction/masonry/WallGroundDetail.js';
import { survivingIntervalsOverBand } from '../src/editor/construction/masonry/OpeningLayout.js';
import { MasonryVertexWriter } from '../src/editor/construction/compile/MasonryVertexWriter.js';
import { writeGroundDetail } from '../src/editor/construction/compile/ConstructionGroundDetailMesher.js';

function fixture() {
  const path = createCubicBezierPathFromStroke([[0, 0], [40, 0]]);
  const record = normalizeConstructionRecord({ version: 1, id: 'ground-qa', revision: 1, seed: 3141,
    style: { key: 'glade-sandstone' }, dimensions: { height: 3.2, thickness: 0.8 },
    top: { style: 'flat' }, path, features: [] });
  return { record, arcTable: createCurveArcTable(sampleCubicBezierPath(path)) };
}

test('ground dressing retains cell identity across module splits and decoration changes', () => {
  const { record, arcTable } = fixture();
  const all = planWallGroundDetail(record, arcTable, [0, 16]);
  const left = planWallGroundDetail(record, arcTable, [0, 8]);
  const right = planWallGroundDetail(record, arcTable, [8, 16]);
  assert.ok(left.length && right.length);
  assert.deepEqual([...left, ...right].sort((a, b) => a.id.localeCompare(b.id)),
    [...all].sort((a, b) => a.id.localeCompare(b.id)));
  assert.equal(new Set(all.map(detail => detail.id)).size, all.length);
  assert.deepEqual(planWallGroundDetail(record, arcTable, [0, 8]), left);
  assert.deepEqual(planWallGroundDetail({ ...record, style: { ...record.style, growth: 'none' } }, arcTable, [0, 8]), []);
  const changed = { ...record, style: { ...record.style, materials: { stone: 'limestone' } } };
  assert.deepEqual(planWallGroundDetail(changed, arcTable, [0, 8]), left);
  assert.equal(new Set(all.map(detail => detail.side)).size, 2);
  assert.ok(all.every(detail => detail.offset > record.dimensions.thickness / 2));
});

test('an opening excludes the complete ground footprint without rerolling distant cells', () => {
  const { record, arcTable } = fixture();
  const opening = { id: 'passage', kind: 'arch', segmentId: record.path.segments[0].id,
    arcFraction: 0.12, s: 4.8, width: 3, height: 2.5, sill: 0, profile: 'round', dressed: true };
  const changed = { ...record, features: [opening] };
  const original = planWallGroundDetail(record, arcTable, [0, 12]);
  const filtered = planWallGroundDetail(changed, arcTable, [0, 12]);
  assert.ok(filtered.length < original.length);
  for (const detail of filtered) {
    const range = [detail.s - GROUND_DETAIL_RADIUS, detail.s + GROUND_DETAIL_RADIUS];
    const spans = survivingIntervalsOverBand(range, [opening], [0, 0.3], { clearance: 0.16 });
    assert.deepEqual(spans, [range]);
    assert.deepEqual(detail, original.find(candidate => candidate.id === detail.id));
  }
  assert.deepEqual(planWallGroundDetail(changed, arcTable, [24, 32]), planWallGroundDetail(record, arcTable, [24, 32]));
});

test('all ground decorations follow sloped terrain inside their exclusion footprint', () => {
  const { record, arcTable } = fixture();
  const origin = { x: 32, z: -16 };
  const groundHeightAt = (x, z) => x * 0.1 + z * 0.5;
  for (const planned of planWallGroundDetail(record, arcTable, [0, 8])) {
    const detail = { ...planned, flower: true, pebble: true, moss: true };
    const writer = new MasonryVertexWriter();
    writeGroundDetail(writer, detail, { arcTable, moduleOrigin: origin, groundHeightAt, color: new THREE.Color() });
    const arrays = writer.toArrays();
    assert.equal(arrays.triangleCount, 24);
    const frame = arcTable.frameAt(detail.s);
    const rootX = frame.x + frame.normalX * detail.side * detail.offset;
    const rootZ = frame.z + frame.normalZ * detail.side * detail.offset;
    for (let i = 0; i < arrays.vertexCount; i += 1) {
      const x = arrays.positions[i * 3] + origin.x;
      const y = arrays.positions[i * 3 + 1];
      const z = arrays.positions[i * 3 + 2] + origin.z;
      assert.ok(Math.hypot(x - rootX, z - rootZ) <= GROUND_DETAIL_RADIUS);
      const relativeHeight = y - groundHeightAt(x, z);
      assert.ok(relativeHeight >= 0.0029 && relativeHeight <= 0.3);
      assert.ok(Math.abs(Math.hypot(...arrays.normals.subarray(i * 3, i * 3 + 3)) - 1) < 1e-6);
    }
    for (const values of [arrays.positions, arrays.normals, arrays.colors, arrays.uvs]) assert.ok(values.every(Number.isFinite));
  }
});
