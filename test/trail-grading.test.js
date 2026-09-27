import assert from 'node:assert/strict';
import test from 'node:test';

import { createRouteData } from '../src/editor/import/AzgaarRoutes.js';
import {
  DEFAULT_TRAIL_GRADING,
  TrailGrading,
  resolveTrailGrading,
  smoothRoute,
} from '../src/editor/world/TrailGrading.js';

// 100×100 atlas over 10 000 × 10 000 cells of 2 m.
const BASE = {
  atlas: { width: 100, height: 100 },
  bounds: { minCellX: 0, minCellZ: 0, widthCells: 10000, heightCells: 10000 },
  physical: { widthMeters: 20000, heightMeters: 20000 },
};
const ROW_Z = 5000;
/** A 30 m ridge across the route's path, far steeper than a trail may climb. */
const ground = (x, z) => 30 * Math.exp(-(((x - 5000) / 25) ** 2)) + 0 * z;

function grading(routes, overrides = {}) {
  return new TrailGrading({
    source: { ...BASE, routes },
    sampleTerrainHeight: ground,
    grading: { ...DEFAULT_TRAIL_GRADING, ...overrides },
  });
}

const trail = { id: 1, group: 'trails', points: [[20, 50], [50, 50], [80, 50]] };

test('only land routes are imported, in atlas coordinates', () => {
  const routes = createRouteData({
    info: { width: 200, height: 100 },
    pack: {
      routes: [
        { i: 0, group: 'trails', points: [[10, 10, 5], [30, 20, 6]] },
        { i: 1, group: 'searoutes', points: [[0, 0], [5, 5]] },
        { i: 2, group: 'roads', points: [[0, 0]] },
      ],
    },
  }, 100, 50);
  assert.equal(routes.length, 1);
  assert.deepEqual(routes[0].points, [[5, 5], [15, 10]]);
});

test('a smoothed route still passes through its points', () => {
  const points = [{ x: 0, z: 0 }, { x: 100, z: 40 }, { x: 200, z: 0 }, { x: 300, z: 60 }];
  const smooth = smoothRoute(points);
  for (const point of points) {
    assert.ok(smooth.some((p) => Math.hypot(p.x - point.x, p.z - point.z) < 1e-9));
  }
  assert.ok(smooth.length > points.length * 4);
});

test('the path over a ridge climbs no steeper than the grade allows, within its cut', () => {
  const trails = grading([trail]);
  let steepest = 0;
  let deepestCut = 0;
  let previous = trails.grade(4700, ROW_Z, ground(4700, ROW_Z));
  for (let x = 4701; x <= 5300; x += 1) {
    const height = trails.grade(x, ROW_Z, ground(x, ROW_Z));
    steepest = Math.max(steepest, Math.abs(height - previous) / 2);
    deepestCut = Math.max(deepestCut, ground(x, ROW_Z) - height);
    previous = height;
  }
  // The raw ridge climbs at up to ~0.5. With 10 m of cut the path still has to
  // rise 20 m over it, so it is steeper than 0.14 near the crest, never steeper
  // than the ground.
  assert.ok(steepest <= 0.52, `steepest ${steepest}`);
  // Between 8 m samples the curved ground can stand a little above the interpolated path.
  assert.ok(deepestCut > 5 && deepestCut <= DEFAULT_TRAIL_GRADING.maxCutMeters + 1, `cut ${deepestCut}`);
  const unlimited = grading([trail], { maxCutMeters: 30, maxFillMeters: 30 });
  let steepestUnlimited = 0;
  previous = unlimited.grade(4700, ROW_Z, ground(4700, ROW_Z));
  for (let x = 4701; x <= 5300; x += 1) {
    const height = unlimited.grade(x, ROW_Z, ground(x, ROW_Z));
    steepestUnlimited = Math.max(steepestUnlimited, Math.abs(height - previous) / 2);
    previous = height;
  }
  assert.ok(steepestUnlimited <= DEFAULT_TRAIL_GRADING.maxGrade * 1.05, `unlimited ${steepestUnlimited}`);
});

test('banks blend back to the ground, and nothing moves away from a path', () => {
  const trails = grading([trail]);
  const onPath = trails.grade(5000, ROW_Z, ground(5000, ROW_Z));
  const bank = trails.grade(5000, ROW_Z + 4, ground(5000, ROW_Z + 4));
  const far = trails.grade(5000, ROW_Z + 40, ground(5000, ROW_Z + 40));
  assert.ok(onPath < ground(5000, ROW_Z) - 5, 'cut through the crest');
  assert.ok(bank > onPath && bank < ground(5000, ROW_Z + 4), 'the bank rises back');
  assert.equal(far, ground(5000, ROW_Z + 40));
  assert.equal(trails.grade(100, 100, 7), 7, 'no path, no change');
  assert.ok(trails.pathCover(5000, ROW_Z) > 0.9 && trails.pathCover(5000, ROW_Z + 40) === 0);
});

test('a path along a steep hillside blends back without a step where the shaping stops', () => {
  // Ground climbing across the route at 1 m per metre: at the edge of the
  // shaping the ground stands far further from the path than cut or fill allow.
  const hillside = (x, z) => (z - ROW_Z) * 2;
  const trails = new TrailGrading({
    source: { ...BASE, routes: [trail] },
    sampleTerrainHeight: hillside,
    grading: DEFAULT_TRAIL_GRADING,
  });
  let previous = trails.grade(5000, ROW_Z, hillside(5000, ROW_Z));
  let lastShaped = null;
  for (let z = ROW_Z + 1; z <= ROW_Z + 20; z += 1) {
    const height = trails.grade(5000, z, hillside(5000, z));
    // The cut bank stands steeper than the hillside, but never as a cliff.
    assert.ok(Math.abs(height - previous) <= 4, `step of ${height - previous} m at cell ${z - ROW_Z}`);
    if (height !== hillside(5000, z)) lastShaped = z;
    previous = height;
  }
  assert.equal(previous, hillside(5000, ROW_Z + 20), 'the ground is untouched past the bank');
  // Where the shaping stops, the bank has already met the ground.
  const edge = trails.grade(5000, lastShaped, hillside(5000, lastShaped));
  assert.ok(Math.abs(edge - hillside(5000, lastShaped)) < 0.25, `bank ${edge} short of ground at the edge`);
});

test('a route with no length grades nothing instead of producing NaN', () => {
  const stuck = grading([{ id: 9, group: 'roads', points: [[50, 50], [50, 50]] }]);
  assert.equal(stuck.grade(5000, 5000, 12), 12);
  assert.equal(stuck.pathCover(5000, 5000), 0);
});

test('arcs meet exactly and do not depend on the order they are traced in', () => {
  const forward = grading([trail], { arcMeters: 64, stepMeters: 8 });
  const backward = grading([trail], { arcMeters: 64, stepMeters: 8 });
  const xs = Array.from({ length: 400 }, (_, i) => 4800 + i);
  const a = xs.map((x) => forward.grade(x, ROW_Z, ground(x, ROW_Z)));
  const b = [...xs].reverse().map((x) => backward.grade(x, ROW_Z, ground(x, ROW_Z))).reverse();
  assert.deepEqual(a, b);
  // No step between neighbouring cells is steeper than the ground's own.
  for (let i = 1; i < a.length; i += 1) {
    const groundStep = Math.abs(ground(xs[i], ROW_Z) - ground(xs[i - 1], ROW_Z));
    assert.ok(Math.abs(a[i] - a[i - 1]) <= Math.max(groundStep, 1.1) + 0.05, `step at ${xs[i]}`);
  }
});

test('grading settings validate', () => {
  assert.equal(resolveTrailGrading(undefined), null);
  assert.equal(resolveTrailGrading({ maxGrade: 0.1 }).maxGrade, 0.1);
  assert.throws(() => resolveTrailGrading({ arcMeters: 4 }), /arc/);
  assert.throws(() => resolveTrailGrading({ maxCutMeters: -1 }), /non-negative/);
});

test('a world imported with trails grades them into its ground; the worker copy keeps them', async () => {
  const { AZGAAR_STANDARD_BIOMES } = await import('../src/editor/AzgaarBiomeCatalog.js');
  const { encodeMacroField } = await import('../src/editor/import/MacroAtlasCodec.js');
  const { AzgaarMacroWorldGenerator } = await import('../src/editor/world/AzgaarMacroWorldGenerator.js');
  const elevation = new Uint8Array(16).fill(70);
  const source = (trails) => ({
    kind: 'azgaar-macro-v2',
    version: 2,
    atlas: {
      width: 4,
      height: 4,
      fields: {
        elevation: encodeMacroField(elevation, 'u8'),
        biomeId: encodeMacroField(new Uint8Array(16).fill(4), 'u8'),
        moisture: encodeMacroField(new Uint8Array(16).fill(128), 'u8', { scale: 1 / 255 }),
      },
    },
    physical: { widthMeters: 8192, heightMeters: 8192 },
    bounds: { minCellX: 0, minCellZ: 0, widthCells: 4096, heightCells: 4096 },
    oceanTransitionCells: 1,
    terrain: {
      minHeight: -16, maxHeight: 48, seaLevel: -1.5, verticalExaggeration: 40, reliefExponent: 1.5,
      ...(trails ? { trails } : {}),
    },
    biomes: AZGAAR_STANDARD_BIOMES,
    rivers: [],
    routes: [{ id: 3, group: 'roads', points: [[0.5, 2], [3.5, 2]] }],
  });
  const metadata = { seed: 42, version: 1, heightScale: 12, seaLevel: -1.5 };
  const graded = new AzgaarMacroWorldGenerator(source(DEFAULT_TRAIL_GRADING), metadata);
  const plain = new AzgaarMacroWorldGenerator(source(null), metadata);
  let moved = 0;
  for (let x = 900; x < 3000; x += 37) {
    moved = Math.max(moved, Math.abs(graded.sampleHeight(x, 2048) - plain.sampleHeight(x, 2048)));
    assert.equal(graded.sampleHeight(x, 2300), plain.sampleHeight(x, 2300), 'away from the road nothing moves');
  }
  assert.ok(moved > 0.05, `the road is graded (${moved} m)`);
  assert.equal(graded.sampleTerrainHeight(1000, 2048), plain.sampleHeight(1000, 2048));

  const { createTerrainWorkerBaseTerrain } = await import('../src/editor/world/TerrainWorkerBaseTerrain.js');
  const full = source(DEFAULT_TRAIL_GRADING);
  for (const name of ['mountainness', 'ruggedness', 'valleyness']) {
    full.atlas.fields[name] = encodeMacroField(new Uint8Array(16).fill(128), 'u8', { scale: 1 / 255 });
  }
  const workerCopy = createTerrainWorkerBaseTerrain(full);
  assert.deepEqual(workerCopy.routes, full.routes);
  assert.deepEqual(workerCopy.terrain.trails, DEFAULT_TRAIL_GRADING);
});

test('a graded route draws as road cells, only along the route', async () => {
  const { AZGAAR_STANDARD_BIOMES } = await import('../src/editor/AzgaarBiomeCatalog.js');
  const { encodeMacroField } = await import('../src/editor/import/MacroAtlasCodec.js');
  const { AzgaarMacroWorldGenerator } = await import('../src/editor/world/AzgaarMacroWorldGenerator.js');
  const { TILE_BY_KEY } = await import('../src/editor/tileCatalog.js');
  const generator = new AzgaarMacroWorldGenerator({
    kind: 'azgaar-macro-v2',
    version: 2,
    atlas: {
      width: 4,
      height: 4,
      fields: {
        elevation: encodeMacroField(new Uint8Array(16).fill(60), 'u8'),
        biomeId: encodeMacroField(new Uint8Array(16).fill(4), 'u8'),
        moisture: encodeMacroField(new Uint8Array(16).fill(128), 'u8', { scale: 1 / 255 }),
      },
    },
    physical: { widthMeters: 8192, heightMeters: 8192 },
    bounds: { minCellX: 0, minCellZ: 0, widthCells: 4096, heightCells: 4096 },
    oceanTransitionCells: 1,
    terrain: { minHeight: -16, maxHeight: 48, seaLevel: -1.5, trails: DEFAULT_TRAIL_GRADING },
    biomes: AZGAAR_STANDARD_BIOMES,
    rivers: [],
    routes: [{ id: 3, group: 'roads', points: [[0.5, 2], [3.5, 2]] }],
  }, { seed: 42, version: 1, heightScale: 12, seaLevel: -1.5 });
  const road = TILE_BY_KEY.get('road').id;
  assert.equal(generator.sampleTile(1500, 2047), road);
  assert.notEqual(generator.sampleTile(1500, 2060), road);
});
