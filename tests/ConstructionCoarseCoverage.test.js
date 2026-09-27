import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeConstructionRecord } from '../src/editor/construction/ConstructionSchema.js';
import { createCubicBezierPathFromStroke } from '../src/editor/construction/curve/CubicBezierPath.js';
import { constructionStyle } from '../src/editor/construction/masonry/ConstructionStyleCatalog.js';
import { planConstruction } from '../src/editor/construction/planning/ConstructionPlanner.js';
import {
  coarsePlacements,
  coarsePlacementsForModule,
} from '../src/editor/construction/render/ConstructionLod.js';
import { uncoveredFaceShare, wallOpenings } from '../scripts/lib/constructionFaceCoverage.mjs';

function wallRecord({ key, top = 'flat', height = 4, length = 48, openings = false }) {
  const path = createCubicBezierPathFromStroke([
    [0, 0], [length / 3, 0], [(length * 2) / 3, 0], [length, 0],
  ], { simplifyTolerance: 0.01 });
  const segmentId = (index) => path.segments[Math.min(index, path.segments.length - 1)].id;
  return normalizeConstructionRecord({
    version: 1,
    id: 'construction-coarse',
    revision: 1,
    seed: 8106,
    kind: 'wall',
    style: { key, version: 1 },
    dimensions: { height, thickness: 0.9 },
    top: { style: top },
    path,
    // Arched openings whose crowns stop part-way up a course, so the course
    // over each crown is one the coarse band drops.
    features: openings ? [
      {
        id: 'door-1', kind: 'door', segmentId: segmentId(0), arcFraction: 0.55,
        width: 2.2, height: 2.6, sill: 0, profile: 'round', dressed: true, group: null,
      },
      {
        id: 'window-1', kind: 'window', segmentId: segmentId(1), arcFraction: 0.4,
        width: 1.2, height: 1.4, sill: 1.1, profile: 'round', dressed: true, group: null,
      },
    ] : [],
  });
}

function coarseHoleShare(record, reduce) {
  const plan = planConstruction(record);
  assert.ok(plan.modules.length >= 3, 'the wall must span several modules');
  const face = {
    length: plan.totalLength,
    bodyTop: record.top.base - constructionStyle(record.style.key).coping.height,
    openings: wallOpenings(record),
  };
  const near = plan.modules.flatMap((module) => module.placements);
  const coarse = plan.modules.flatMap((module) => reduce(module, plan));
  return {
    near: uncoveredFaceShare(near, face),
    coarse: uncoveredFaceShare(coarse, face),
  };
}

test('a merged split cell reports the span of every leaf it absorbed', () => {
  const leaf = (s0, s1, stableIndex) => ({
    category: 'field',
    s: (s0 + s1) / 2,
    y: 0.25,
    width: s1 - s0,
    height: 0.5,
    courseIndex: 0,
    cellIndex: 7,
    stableIndex,
    corners: [[-(s1 - s0) / 2, -0.25], [(s1 - s0) / 2, -0.25], [(s1 - s0) / 2, 0.25], [-(s1 - s0) / 2, 0.25]],
    support: Object.freeze({ role: 'field', span: Object.freeze([s0, s1]), courseIndex: 0 }),
  });
  const [merged] = coarsePlacements([leaf(0, 0.7, 1), leaf(0.7, 1, 2)]);
  assert.deepEqual([...merged.support.span], [0, 1]);
  assert.equal(merged.support.role, 'field');
});

test('coarse walls cover their face as well as the near band does', () => {
  for (const key of ['rounded-fieldstone', 'coursed-rubble', 'soft-limestone-rubble']) {
    const record = wallRecord({ key });
    const strict = coarseHoleShare(record, (module) => coarsePlacements(module.placements, {
      styleKey: key,
    }));
    const aware = coarseHoleShare(record, (module, plan) => coarsePlacementsForModule({
      record,
      module,
      totalLength: plan.totalLength,
    }));
    const extra = aware.coarse - aware.near;
    assert.ok(extra < 0.003, `${key}: coarse uncovers ${(extra * 100).toFixed(2)}% more of the face than near`);
    assert.ok(aware.coarse < strict.coarse, `${key}: seams should cost the strict reduction coverage`);
  }
});

test('coarse walls stay covered over arches and beside jambs', () => {
  for (const key of ['rounded-fieldstone', 'coursed-rubble']) {
    const record = wallRecord({ key, openings: true });
    const aware = coarseHoleShare(record, (module, plan) => coarsePlacementsForModule({
      record,
      module,
      totalLength: plan.totalLength,
    }));
    const extra = aware.coarse - aware.near;
    assert.ok(extra < 0.003, `${key}: coarse uncovers ${(extra * 100).toFixed(2)}% more of the face than near`);
  }
});

test('near placements are untouched by the coarse reduction', () => {
  const record = wallRecord({ key: 'rounded-fieldstone' });
  const plan = planConstruction(record);
  const module = plan.modules[1];
  const before = JSON.stringify(module.placements);
  coarsePlacementsForModule({ record, module, totalLength: plan.totalLength });
  assert.equal(JSON.stringify(module.placements), before);
});

test('ruined walls keep the strict coverage rule at seams', () => {
  const record = wallRecord({ key: 'rounded-fieldstone', top: 'ruined' });
  const plan = planConstruction(record);
  for (const module of plan.modules) {
    const strict = coarsePlacements(module.placements, { styleKey: record.style.key });
    const aware = coarsePlacementsForModule({ record, module, totalLength: plan.totalLength });
    assert.deepEqual(aware, strict);
  }
});
