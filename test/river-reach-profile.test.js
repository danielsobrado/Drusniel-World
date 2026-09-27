import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveWaterDomainConfig } from '../src/editor/water/WaterConfig.js';
import {
  createReachProfile,
  reachFallAt,
  reachFalls,
  reachPlungeAt,
  reachSurfaceAt,
} from '../src/editor/water/RiverReachProfile.js';
import { WaterTerrainModel } from '../src/editor/water/WaterTerrainModel.js';

const { falls: config } = resolveWaterDomainConfig();

test('a gentle trace is a plain ramp with no falls', () => {
  const profile = createReachProfile([10, 9, 8, 7], 300, config);
  assert.equal(reachFalls(profile).length, 0);
  assert.equal(reachSurfaceAt(profile, 0), 10);
  assert.equal(reachSurfaceAt(profile, 0.5), 8.5);
  assert.equal(reachSurfaceAt(profile, 1), 7);
  assert.equal(reachFallAt(profile, 0.5), 0);
});

test('a steep step becomes a fall with a level pool above it and a plunge below', () => {
  const profile = createReachProfile([50, 50, 38, 38], 300, config);
  const [fall] = reachFalls(profile);
  assert.equal(reachFalls(profile).length, 1);
  assert.equal(fall.drop, 12);
  assert.ok(fall.lip > 1 / 3 && fall.foot < 2 / 3);
  // The face spans drop / faceSlope metres.
  assert.ok(Math.abs((fall.foot - fall.lip) * 300 - 12 / config.faceSlope) < 1e-6);
  assert.equal(reachSurfaceAt(profile, fall.lip - 0.01), 50);
  assert.equal(reachSurfaceAt(profile, fall.foot + 0.01), 38);
  assert.ok(reachFallAt(profile, (fall.lip + fall.foot) / 2) > 0.99);
  assert.ok(reachPlungeAt(profile, fall.foot + 0.005) > 0.5);
  assert.equal(reachPlungeAt(profile, fall.lip - 0.01), 0);
});

test('a drop taller than maximumHeight becomes a cascade', () => {
  const profile = createReachProfile([200, 110], 100, config);
  const falls = reachFalls(profile);
  assert.equal(falls.length, Math.ceil(90 / config.maximumHeight));
  for (const fall of falls) assert.ok(fall.drop <= config.maximumHeight);
  let previous = Infinity;
  for (let t = 0; t <= 1; t += 0.01) {
    const level = reachSurfaceAt(profile, t);
    assert.ok(level <= previous + 1e-9, 'the water never rises downstream');
    previous = level;
  }
});

test('falls can be switched off', () => {
  const profile = createReachProfile([50, 38], 100, { ...config, enabled: false });
  assert.equal(reachFalls(profile).length, 0);
  assert.equal(reachSurfaceAt(profile, 0.5), 44);
});

test('a traced river never floats over a valley between its far-apart points', () => {
  const waterDomain = resolveWaterDomainConfig({ cellSizeMeters: 10 });
  // A valley 60 m deep halfway between two points 5 km apart.
  const ground = (x) => 100 - 60 * Math.exp(-(((x - 250) / 60) ** 2));
  const model = new WaterTerrainModel({
    source: {
      atlas: { width: 500, height: 100 },
      bounds: { minCellX: 0, minCellZ: 0, widthCells: 500, heightCells: 100 },
      rivers: [{ id: 3, widthAtlas: 2, points: [[0, 50], [500, 50]] }],
    },
    seed: 1,
    seaLevel: 0,
    config: waterDomain,
    sampleBaseHeight: (x) => ground(x),
    sampleBaseTile: () => 4,
  });
  for (let x = 5; x < 500; x += 5) {
    const water = model.sampleWater(x, 50);
    assert.ok(water.surfaceHeight <= ground(x) + 0.5, `no floating water at x=${x}`);
  }
  // Downstream of the valley the ground rises again; the river cuts through it.
  const across = model.sampleWater(400, 50);
  assert.ok(across.surfaceHeight < 45 && across.depth > 0);
});

test('a river cutting through a ridge opens a sloped valley, not a slot', () => {
  const waterDomain = resolveWaterDomainConfig({ cellSizeMeters: 2 });
  // Flat ground at 20 m with a 200 m ridge across the river's path at x = 500.
  const ground = (x) => 20 + 200 * Math.exp(-(((x - 500) / 150) ** 2));
  const model = new WaterTerrainModel({
    source: {
      atlas: { width: 1000, height: 1000 },
      bounds: { minCellX: 0, minCellZ: 0, widthCells: 1000, heightCells: 1000 },
      rivers: [{ id: 5, widthAtlas: 10, points: [[0, 500], [1000, 500]] }],
    },
    seed: 1,
    seaLevel: 0,
    config: waterDomain,
    sampleBaseHeight: (x) => ground(x),
    sampleBaseTile: () => 4,
  });
  const river = model.riverChannel.segments[0];
  const water = model.sampleWater(500, 500);
  assert.ok(water.surfaceHeight < 25, 'the river keeps its level through the ridge');
  // Walk out from the channel edge across the ridge crest: never steeper than the valley slope.
  const { valleySlope, leveeHeight } = waterDomain.river;
  const radius = river.radiusCells;
  let previous = model.sampleHeight(500, 500 + radius + 1);
  assert.ok(previous <= water.surfaceHeight + leveeHeight + valleySlope * 2 + 1e-6);
  for (let offset = radius + 2; offset < radius + 100; offset += 1) {
    const height = model.sampleHeight(500, 500 + offset);
    assert.ok(height - previous <= valleySlope * waterDomain.cellSizeMeters + 1e-6, `slope at ${offset}`);
    previous = height;
  }
  // Well outside the valley reach, the ridge is untouched.
  assert.equal(model.sampleHeight(500, 500 + radius + 300), ground(500));
});

test('a levee keeps low ground beside a river above its water', () => {
  const waterDomain = resolveWaterDomainConfig({ cellSizeMeters: 2 });
  // The river runs along a side slope: the ground falls away to one side.
  const model = new WaterTerrainModel({
    source: {
      atlas: { width: 1000, height: 1000 },
      bounds: { minCellX: 0, minCellZ: 0, widthCells: 1000, heightCells: 1000 },
      rivers: [{ id: 6, widthAtlas: 10, points: [[0, 500], [1000, 500]] }],
    },
    seed: 1,
    seaLevel: 0,
    config: waterDomain,
    sampleBaseHeight: (x, z) => 50 - x * 0.001 - (z - 500) * 0.2,
    sampleBaseTile: () => 4,
  });
  const water = model.sampleWater(500, 500);
  const radius = model.riverChannel.segments[0].radiusCells;
  const beside = model.sampleHeight(500, 500 + radius + 6);
  assert.ok(beside >= water.surfaceHeight + waterDomain.river.leveeHeight - 1e-6);
});
