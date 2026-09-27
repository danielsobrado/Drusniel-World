import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createLakeCellOverrides,
  createLakeData,
} from '../src/editor/import/AzgaarLakes.js';
import {
  WATER_BODY_ID_LAKE_BASE,
  WATER_KIND_LAKE,
  WATER_KIND_NONE,
  WATER_KIND_RIVER,
} from '../src/editor/water/WaterConstants.js';
import { resolveWaterDomainConfig } from '../src/editor/water/WaterConfig.js';
import { LakeBodies } from '../src/editor/water/LakeBodies.js';
import { WaterTerrainModel } from '../src/editor/water/WaterTerrainModel.js';

// One atlas unit is ten cells of ten metres: the lake square spans 400 m.
const config = resolveWaterDomainConfig({
  cellSizeMeters: 10,
  lake: { shorelineNoiseMeters: 0 },
});
const LEVEL = 40;
const lake = Object.freeze({
  id: 25,
  name: 'Neury',
  height: 27.3,
  outline: Object.freeze([[40, 40], [80, 40], [80, 80], [40, 80]]),
});
const source = Object.freeze({
  atlas: Object.freeze({ width: 100, height: 100 }),
  bounds: Object.freeze({ minCellX: 0, minCellZ: 0, widthCells: 100, heightCells: 100 }),
  lakes: Object.freeze([lake]),
});

function createModel(overrides = {}) {
  return new WaterTerrainModel({
    source,
    seed: 3,
    seaLevel: 0,
    config,
    sampleBaseHeight: () => 38,
    sampleBaseTile: () => 4,
    resolveLakeLevel: () => LEVEL,
    ...overrides,
  });
}

test('lake water sits at the lake level, not at sea level', () => {
  const model = createModel();
  const water = model.sampleWater(60, 60);
  assert.equal(water.kind, WATER_KIND_LAKE);
  assert.equal(water.bodyId, WATER_BODY_ID_LAKE_BASE);
  assert.equal(water.surfaceHeight, LEVEL);
  assert.ok(water.depth > config.lake.minimumDepth);
  assert.ok(water.depth <= config.lake.maximumDepth + 1e-9);
  assert.equal(model.sampleWater(20, 20).kind, WATER_KIND_NONE);
});

test('the lake bed deepens away from the shore', () => {
  const model = createModel();
  const nearShore = LEVEL - model.sampleHeight(41, 60);
  const centre = LEVEL - model.sampleHeight(60, 60);
  assert.ok(nearShore >= 0);
  assert.ok(centre > nearShore);
  // 200 m from every shore, short of shoreDepthMeters: deep, but not yet the maximum.
  assert.ok(centre > config.lake.minimumDepth && centre < config.lake.maximumDepth);
});

test('a bank keeps low ground outside the shore above the water', () => {
  const model = createModel();
  const bankCells = config.lake.bankWidthMeters / config.cellSizeMeters;
  const onBank = model.sampleHeight(80 + bankCells, 60);
  assert.ok(Math.abs(onBank - (LEVEL + config.lake.bankHeight)) < 1e-9);
  assert.ok(model.sampleHeight(81, 60) > LEVEL);
  // Far from the lake the base terrain is untouched.
  assert.equal(model.sampleHeight(5, 5), 38);
});

test('high ground within the shore slope is left as it is', () => {
  const model = createModel({ sampleBaseHeight: () => 70 });
  // 150 m out the slope allows 40 + 1.5 + 45 m; the 70 m ground is below that.
  assert.equal(model.sampleHeight(80 + 15, 60), 70);
  assert.equal(model.sampleWater(60, 60).surfaceHeight, LEVEL);
});

test('lake cells report the water tile so tile-driven water shows them', () => {
  const model = createModel();
  assert.equal(model.isLakeCell(60, 60), true);
  assert.equal(model.isLakeCell(20, 60), false);
  assert.equal(model.isOceanCell(60, 60), false);
});

test('a river flowing into a lake runs at the lake level inside it', () => {
  const model = createModel({
    source: Object.freeze({
      ...source,
      rivers: Object.freeze([Object.freeze({ id: 4, widthAtlas: 2, points: [[5, 60], [60, 60]] })]),
    }),
    sampleBaseHeight: (x) => 60 - x * 0.2,
  });
  const [segment] = model.riverChannel.segments;
  // At the lake's level where it enters, then only its minimum gradient below it.
  assert.ok(segment.endSurface <= LEVEL && segment.endSurface > LEVEL - 0.1);
  assert.equal(model.sampleWater(60, 60).kind, WATER_KIND_LAKE);
  assert.equal(model.sampleWater(20, 60).kind, WATER_KIND_RIVER);
});

test('shoreline noise moves the shore without breaking determinism', () => {
  const noisy = resolveWaterDomainConfig({ cellSizeMeters: 10 });
  const create = () => new LakeBodies({ source, resolveLevel: () => LEVEL, config: noisy });
  const first = create();
  const second = create();
  let moved = 0;
  for (let z = 40; z <= 80; z += 2) {
    const a = first.locate(80, z).distanceMeters;
    assert.equal(a, second.locate(80, z).distanceMeters);
    if (Math.abs(a) > 1) moved += 1;
  }
  assert.ok(moved > 0);
});

test('import rasterizes lake cells as land at the lake level in the surrounding biome', () => {
  const document = {
    info: { width: 100, height: 100 },
    pack: {
      features: [0, { i: 1, type: 'island' }, {
        i: 2, type: 'lake', name: 'Neury', height: 27.3, vertices: [0, 1, 2],
      }],
      cells: [
        { i: 0, f: 2, h: 17, biome: 0, c: [1, 2, 3] },
        { i: 1, f: 1, h: 30, biome: 6, c: [0] },
        { i: 2, f: 1, h: 31, biome: 6, c: [0] },
        { i: 3, f: 1, h: 22, biome: 8, c: [0] },
      ],
      vertices: [{ p: [10, 20] }, { p: [50, 20] }, { p: [30, 60] }],
    },
  };
  assert.deepEqual([...createLakeCellOverrides(document)], [[2, { elevation: 28, biome: 6 }]]);
  assert.deepEqual(createLakeData(document, 50, 50), [{
    id: 2,
    name: 'Neury',
    height: 27.3,
    outline: [[5, 10], [25, 10], [15, 30]],
  }]);
});

test('hills at the water are held to the shore slope and handed back at the reach', () => {
  const model = createModel({ sampleBaseHeight: () => 400 });
  const lakeConfig = config.lake;
  const at = (meters) => model.sampleHeight(80 + meters / config.cellSizeMeters, 60);
  assert.ok(Math.abs(at(200) - (LEVEL + lakeConfig.bankHeight + lakeConfig.shoreSlope * 200)) < 1e-9);
  assert.equal(at(lakeConfig.shoreReachMeters + 10), 400);
  let previous = at(0);
  for (let meters = 10; meters <= lakeConfig.shoreReachMeters; meters += 10) {
    const height = at(meters);
    assert.ok(height >= previous - 1e-9, `the shore climbs monotonically at ${meters} m`);
    previous = height;
  }
});

test('a river falling into a lake keeps its own water until it reaches the lake level', () => {
  const model = createModel({
    source: Object.freeze({
      ...source,
      rivers: Object.freeze([Object.freeze({ id: 4, widthAtlas: 2, points: [[5, 60], [60, 60]] })]),
    }),
    // High ground right up to the shore, so the river drops into the lake there;
    // the lake cells themselves sit just above its level, as the import rasterizes them.
    sampleBaseHeight: (x) => (x < 40 ? 70 : 41),
  });
  const kinds = [];
  for (let x = 30; x <= 60; x += 0.5) {
    const water = model.sampleWater(x, 60);
    kinds.push(water.kind);
    if (water.kind === WATER_KIND_RIVER) assert.ok(water.surfaceHeight >= LEVEL);
  }
  const firstLake = kinds.indexOf(WATER_KIND_LAKE);
  assert.ok(firstLake > 0, 'the lake takes over downstream of the fall');
  assert.ok(kinds.slice(firstLake).every((kind) => kind === WATER_KIND_LAKE));
});
