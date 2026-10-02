import assert from 'node:assert/strict';
import test from 'node:test';
import { createCubicBezierPathFromStroke } from '../src/editor/construction/curve/CubicBezierPath.js';
import { planConstruction } from '../src/editor/construction/planning/ConstructionPlanner.js';
import { coarsePlacementsForModule } from '../src/editor/construction/render/ConstructionLod.js';

test('sandstone LOD keeps every solved stone, opening and ruin void through module seams', () => {
  for (const top of ['flat', 'irregular', 'crenellated', 'ruined']) {
    for (const height of [0.72, 3.5]) {
      const path = createCubicBezierPathFromStroke([[0, 0], [6, 0], [10, 3], [14, 6]],
        { simplifyTolerance: 0.01 });
      const record = { version: 1, id: 'lod-wall', revision: 1, seed: 3141, kind: 'wall',
        style: { key: 'glade-sandstone', version: 1 }, dimensions: { height, thickness: 0.8 },
        top: { style: top, base: height, profile: [] }, path,
        features: height < 1 ? [] : [{ id: 'arch', kind: 'arch', segmentId: path.segments[1].id,
          arcFraction: 0.5, width: 1.8, height: 2.2, sillHeight: 0 }] };
      const plan = planConstruction(record, { maxModuleLength: 4 });
      assert.ok(plan.modules.length > 2);
      assert.ok(plan.modules.some(module => module.placements.length > 0));
      const snapshot = structuredClone(plan.modules);
      for (const module of plan.modules) {
        const coarse = coarsePlacementsForModule({ record, module, totalLength: plan.totalLength });
        assert.equal(coarse, module.placements, `${top}/${height}/${module.id} keeps its authoritative cells`);
        assert.equal(coarsePlacementsForModule({ record, module: { ...module, placements: coarse },
          totalLength: plan.totalLength }), coarse);
      }
      assert.deepEqual(plan.modules, snapshot, 'distance selection does not mutate the plan');
    }
  }
});
