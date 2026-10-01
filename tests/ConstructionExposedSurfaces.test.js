import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { normalizeConstructionRecord } from '../src/editor/construction/ConstructionSchema.js';
import { createCubicBezierPathFromStroke, sampleCubicBezierPath } from '../src/editor/construction/curve/CubicBezierPath.js';
import { createCurveArcTable } from '../src/editor/construction/masonry/CurveArcTable.js';
import { planConstruction } from '../src/editor/construction/planning/ConstructionPlanner.js';
import { buildModuleMasonry } from '../src/editor/construction/compile/ConstructionMasonryBuilder.js';
import { coarsePlacementsForModule } from '../src/editor/construction/render/ConstructionCoarsePlacements.js';
import { createConstructionMaterials, disposeConstructionMaterials } from '../src/editor/construction/render/ConstructionMaterials.js';
import { constructionStoneExposure, recessExposedMortar } from '../src/editor/construction/compile/ConstructionStoneExposure.js';

function fixture({ height = 3.2, seed = 3141, lodBand = 'near', reverse = false, style = 'rounded-fieldstone', top = 'flat', openings = false } = {}) {
  const path = createCubicBezierPathFromStroke(reverse ? [[14, 0], [0, 0]] : [[0, 0], [14, 0]]);
  const record = normalizeConstructionRecord({
    version: 1, id: 'exposed-wall', revision: 1, seed, kind: 'wall',
    style: { key: style, version: 1 },
    dimensions: { height, thickness: 0.8 }, top: { style: top },
    path,
    features: openings ? [0.12, 0.37, 0.63, 0.88].map((arcFraction, i) => ({
      id: `arch-${i}`, kind: 'arch', segmentId: path.segments[0].id, arcFraction,
      width: 2.4, height: 4.4, sill: 0, profile: ['round', 'segmental', 'pointed', 'flat'][i], dressed: true,
    })) : [],
  });
  const plan = planConstruction(record);
  const arcTable = createCurveArcTable(sampleCubicBezierPath(record.path));
  const materials = createConstructionMaterials(record);
  const placements = [];
  const meshes = plan.modules.flatMap(module => {
    const units = lodBand === 'near' ? module.placements
      : coarsePlacementsForModule({ record, module, totalLength: plan.totalLength });
    placements.push(...units);
    return buildModuleMasonry(units, {
      record, materials, arcTable, moduleOrigin: { x: 0, z: 0 }, groundHeightAt: () => 0, lodBand,
    }).meshes;
  });
  meshes.forEach(mesh => mesh.updateMatrixWorld(true));
  return {
    placements, arcTable,
    first(origin, direction) {
      const ray = new THREE.Raycaster(new THREE.Vector3(...origin), new THREE.Vector3(...direction));
      return ray.intersectObjects(meshes, false)[0]?.object.userData.constructionMaterialSlot;
    },
    dispose() { meshes.forEach(mesh => mesh.geometry.dispose()); },
  };
}

test.afterEach(() => disposeConstructionMaterials());

test('merged split stones retain exposed wall ends beside an arcade', () => {
  for (const lodBand of ['near', 'coarse']) {
    const wall = fixture({ height: 5.5, style: 'glade-sandstone', lodBand, openings: true });
    try {
      let checked = 0;
      for (const stone of wall.placements.filter(unit => unit.category === 'field' && unit.mortarCorners)) {
        const xs = stone.mortarCorners.map(([x]) => stone.s + x);
        const side = Math.min(...xs) <= 1e-6 ? -1 : Math.max(...xs) >= 14 - 1e-6 ? 1 : 0;
        if (!side) continue;
        for (const depth of [-0.28, 0, 0.28]) {
          assert.equal(wall.first([side < 0 ? -3 : 17, stone.y, depth], [-side, 0, 0]),
            'stone', `${lodBand}: exposed end at y=${stone.y} is coated in mortar`);
        }
        checked += 1;
      }
      assert.ok(checked >= 10);
      for (const center of [0.12, 0.37, 0.63, 0.88]) for (const side of [-1, 1]) {
        for (const y of [1.2, 1.4, 1.6, 1.7]) for (const depth of [-0.28, 0, 0.28]) {
          assert.equal(wall.first([center * 14, y, depth], [side, 0, 0]), 'stone',
            `${lodBand}: backing covers a jamb at s=${center * 14}, y=${y}`);
        }
      }
    } finally { wall.dispose(); }
  }
});

test('capstones and terminal courses cover their backing in both detail bands and path directions', () => {
  for (const lodBand of ['near', 'coarse']) {
    for (const reverse of [false, true]) {
      const wall = fixture({ lodBand, reverse });
      try {
        for (const stone of wall.placements) {
          const frame = wall.arcTable.frameAt(stone.s);
          if (stone.category === 'coping') {
            assert.equal(wall.first([frame.x, 6, frame.z], [0, -1, 0]), 'stone',
              `${lodBand}: mortar covers cap ${stone.stableIndex}`);
          }
          if (stone.category !== 'field') continue;
          const halfWidth = (stone.packedWidth ?? stone.width) / 2;
          const side = stone.s - halfWidth < 1e-6 ? -1 : stone.s + halfWidth > 14 - 1e-6 ? 1 : 0;
          if (!side) continue;
          const end = wall.arcTable.frameAt(side < 0 ? 0 : 14);
          assert.equal(wall.first(
            [end.x + end.tangentX * side * 3, stone.y, end.z + end.tangentZ * side * 3],
            [-end.tangentX * side, 0, -end.tangentZ * side],
          ), 'stone', `${lodBand}: mortar covers terminal stone ${stone.stableIndex}`);
        }
      } finally { wall.dispose(); }
    }
  }
});

test('short walls have stone immediately below every capstone', () => {
  for (const height of [0.8, 1.4]) {
    const wall = fixture({ height });
    try {
      const field = wall.placements.filter(stone => stone.category === 'field');
      for (const cap of wall.placements.filter(stone => stone.category === 'coping')) {
        const below = field.filter(stone => Math.abs(stone.s - cap.s) <= stone.packedWidth / 2);
        const top = Math.max(...below.map(stone => stone.y + stone.height / 2));
        assert.ok(cap.y - cap.height / 2 - top < 0.03, `${height} m: bare band below cap at ${cap.s}`);
      }
    } finally { wall.dispose(); }
  }
});

test('exposed surfaces remain stone across seeds and both masonry builders', () => {
  for (const style of ['rounded-fieldstone', 'coursed-rubble']) {
    for (const seed of [1, 7, 42, 999]) {
      const wall = fixture({ style, seed });
      try {
        for (const stone of wall.placements) {
          const frame = wall.arcTable.frameAt(stone.s);
          if (stone.category === 'coping') {
            assert.equal(wall.first([frame.x, 6, frame.z], [0, -1, 0]), 'stone',
              `${style}, seed ${seed}: cap ${stone.stableIndex}`);
          }
          if (stone.category !== 'field') continue;
          const edge = constructionStoneExposure(stone, { totalLength: 14 });
          if (!edge.start && !edge.end) continue;
          assert.equal(wall.first([edge.start ? -3 : 17, stone.y, 0], [edge.start ? 1 : -1, 0, 0]),
            'stone', `${style}, seed ${seed}: end ${stone.stableIndex}`);
        }
      } finally { wall.dispose(); }
    }
  }
});

test('interior module joints and the closure seam retain the full backing footprint', () => {
  const corners = [[-0.5, -0.2], [0.5, -0.2], [0.5, 0.2], [-0.5, 0.2]];
  for (const [closed, s] of [[false, 7], [true, 0.5], [true, 13.5]]) {
    const exposure = constructionStoneExposure({ category: 'field', s, packedWidth: 1 }, {
      totalLength: 14, closed,
    });
    assert.equal(recessExposedMortar(corners, exposure, 0.07), corners);
  }
});

test('mortar stays behind displaced stone faces on both sides of the wall', () => {
  for (const style of ['rounded-fieldstone', 'coursed-rubble']) {
    for (const reverse of [false, true]) {
      const wall = fixture({ style, reverse });
      try {
        for (const stone of wall.placements.filter(unit => unit.category === 'field')) {
          const frame = wall.arcTable.frameAt(stone.s);
          for (const sign of [-1, 1]) {
            assert.equal(wall.first(
              [frame.x + sign * frame.normalX * 4, stone.y, frame.z + sign * frame.normalZ * 4],
              [-sign * frame.normalX, 0, -sign * frame.normalZ],
            ), 'stone', `${style}, direction ${sign}: backing covers face ${stone.stableIndex}`);
          }
        }
      } finally { wall.dispose(); }
    }
  }
});

test('battlement tops and the wall between them expose stone in both detail bands', () => {
  for (const style of ['glade-sandstone', 'rounded-fieldstone']) {
    for (const lodBand of ['near', 'coarse']) {
      for (const height of [1.4, 3.2, 3.5]) {
        const wall = fixture({ height, style, lodBand, top: 'crenellated' });
        try {
          const field = wall.placements.filter(stone => stone.category === 'field');
          const crown = wall.placements.filter(stone => stone.category === 'merlon');
          assert.ok(crown.length > 0);
          const openBody = field.filter(unit => unit.exposure?.top && !crown.some(tooth => (
            Math.abs(tooth.s - unit.s) < tooth.packedWidth / 2
          )));
          const caps = crown.filter(unit => unit.exposure?.top);
          assert.ok(caps.length > 0 && openBody.length > 0);
          for (const stone of [...openBody, ...caps]) {
            const frame = wall.arcTable.frameAt(stone.s);
            assert.equal(wall.first([frame.x, 6, frame.z], [0, -1, 0]), 'stone',
              `${style}, ${lodBand}, ${height}: brown crown at ${stone.s}`);
          }
          for (const stone of crown.filter(unit => unit.support.bottom < height + 0.03)) {
            assert.ok(stone.support.span[0] >= -1e-6 && stone.support.span[1] <= 14 + 1e-6,
              'a terminal battlement overhangs the wall end');
            const below = field.filter(unit => Math.abs(unit.s - stone.s) < unit.packedWidth / 2);
            const top = Math.max(...below.map(unit => unit.support.top));
            assert.ok(stone.support.bottom - top < 0.03,
              `${style}, ${height}: merlon floats ${stone.support.bottom - top} m above the wall`);
          }
          assert.ok(field.some(unit => unit.exposure?.top), 'the body crown has exposed stones');
        } finally { wall.dispose(); }
      }
    }
  }
});
