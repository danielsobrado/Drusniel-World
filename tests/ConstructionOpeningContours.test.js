import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { normalizeConstructionRecord } from '../src/editor/construction/ConstructionSchema.js';
import { createCubicBezierPathFromStroke, sampleCubicBezierPath } from '../src/editor/construction/curve/CubicBezierPath.js';
import { createCurveArcTable } from '../src/editor/construction/masonry/CurveArcTable.js';
import { openingHalfWidthAt, openingTopOverSpan } from '../src/editor/construction/masonry/OpeningLayout.js';
import { planConstruction } from '../src/editor/construction/planning/ConstructionPlanner.js';
import { buildModuleMasonry } from '../src/editor/construction/compile/ConstructionMasonryBuilder.js';
import { coarsePlacementsForModule } from '../src/editor/construction/render/ConstructionLod.js';
import { createConstructionMaterials, disposeConstructionMaterials } from '../src/editor/construction/render/ConstructionMaterials.js';
import { courseSpans } from '../src/editor/construction/masonry/CurvedCoursePacker.js';

function fixture(style, profile, curved, dressed) {
  const path = createCubicBezierPathFromStroke(curved ? [[0, 0], [5, -1], [10, 0]] : [[0, 0], [10, 0]],
    { simplifyTolerance: 0.01 });
  const record = normalizeConstructionRecord({ version: 1, id: 'arch-qa', revision: 1, seed: 35,
    style: { key: style }, dimensions: { height: 4, thickness: 0.8 }, top: { style: 'flat' }, path,
    features: [{ id: 'door', kind: 'arch', segmentId: path.segments[0].id, arcFraction: 0.55,
      width: 2.4, height: 2.8, sill: 0.2, profile, dressed }] });
  const arcTable = createCurveArcTable(sampleCubicBezierPath(path));
  const opening = { ...record.features[0], s: arcTable.toArc(path.segments[0].id, 0.55) };
  return { record, arcTable, opening };
}

test.afterEach(() => disposeConstructionMaterials());

for (const style of ['glade-sandstone', 'rounded-fieldstone', 'coursed-rubble']) {
  test(`${style}: fitted arches stay open and their reveals are stone in both detail tiers`, () => {
    for (const profile of ['round', 'segmental', 'pointed', 'flat']) for (const lodBand of ['near', 'coarse']) {
      const { record, arcTable, opening } = fixture(style, profile, profile === 'pointed', true);
      const plan = planConstruction(record);
      const materials = createConstructionMaterials(record);
      const meshes = [];
      for (const module of plan.modules) {
        const placements = lodBand === 'coarse' ? coarsePlacementsForModule({ record, module, totalLength: plan.totalLength }) : module.placements;
        const built = buildModuleMasonry(placements, { record, materials, arcTable, moduleOrigin: { x: 0, z: 0 }, groundHeightAt: () => 0, lodBand });
        assert.ok(built.meshes.length <= 2, 'fitted stones must stay in the stone/mortar batches');
        for (const mesh of built.meshes) {
          mesh.updateMatrixWorld(true);
          for (const attribute of Object.values(mesh.geometry.attributes)) {
            assert.ok(attribute.array.every(Number.isFinite), 'geometry must be finite');
          }
        }
        meshes.push(...built.meshes);
      }
      for (let step = 1; step < 28; step += 1) {
        const y = opening.sill + opening.height * step / 28;
        const half = openingHalfWidthAt(opening, y);
        for (const fraction of [-0.9, 0, 0.9]) {
          const frame = arcTable.frameAt(opening.s + half * fraction);
          const ray = new THREE.Raycaster(new THREE.Vector3(frame.x + frame.normalX * 3, y, frame.z + frame.normalZ * 3),
            new THREE.Vector3(-frame.normalX, 0, -frame.normalZ), 0, 6);
          assert.equal(ray.intersectObjects(meshes).length, 0, `${profile}/${lodBand}: material blocks the opening at y=${y}`);
        }
      }
      if (profile !== 'flat') for (const fraction of [-0.7, -0.3, 0.35, 0.75]) {
        const s = opening.s + opening.width / 2 * fraction;
        const y = openingTopOverSpan(opening, s, s);
        const frame = arcTable.frameAt(s);
        for (const across of [-0.28, 0, 0.28]) {
          const ray = new THREE.Raycaster(new THREE.Vector3(frame.x + frame.normalX * across, y - 0.1, frame.z + frame.normalZ * across),
            new THREE.Vector3(0, 1, 0), 0, 0.6);
          const hit = ray.intersectObjects(meshes)[0];
          assert.ok(hit, `${profile}/${lodBand}: reveal must continue through the wall`);
          assert.equal(hit.object.userData.constructionMaterialSlot, 'stone', 'mortar must not coat the reveal');
        }
      }
      meshes.forEach(mesh => mesh.geometry.dispose());
    }
  });
}

test('undressed arch shoulders fit the contour without relying on trim to hide a gap', () => {
  const { record, arcTable, opening } = fixture('glade-sandstone', 'round', false, false);
  const plan = planConstruction(record);
  const fitted = plan.modules.flatMap(module => module.placements).filter(stone => stone.contourPolygons);
  assert.ok(fitted.length > 0);
  assert.ok(fitted.some(stone => stone.contourPolygons.some(polygon => polygon[0].length > 4)));
  for (const stone of fitted) for (const [x, y] of stone.contourPolygons.flat(2)) {
    assert.ok(Math.abs(stone.s + x - opening.s) >= openingHalfWidthAt(opening, stone.y + y) - 0.002);
  }
  assert.deepEqual(planConstruction(record), plan);
});

test('three overlapping openings resolve one column regardless of input order', () => {
  const openings = [4, 7, 5.5].map((s, i) => ({ id: `window-${i}`, s, sill: 0.2, height: 2.1,
    width: 2, profile: 'round' }));
  const spans = courseSpans({ range: [0, 12], openings, band: [1.8, 2.5] });
  const floors = spans.filter(span => span.floorOpenings);
  assert.equal(floors.length, 1);
  assert.deepEqual(courseSpans({ range: [0, 12], openings: openings.slice().reverse(), band: [1.8, 2.5] }), spans);
});
