import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import * as THREE from 'three/webgpu';

import { presetWeight, resolveAmbientEffectsConfig, windFactor } from '../src/editor/stylized/ambient/ambientEffectsConfig.js';
import { ambientPresetName } from '../src/editor/stylized/ambient/ambientPresets.js';
import { ambientRegionWeights, regionWeight } from '../src/editor/stylized/ambient/ambientRegions.js';
import { AmbientEffectsSystem } from '../src/editor/stylized/ambient/AmbientEffectsSystem.js';

const SETTINGS = resolveAmbientEffectsConfig(
  yaml.load(readFileSync(new URL('../config/ambient-effects.yaml', import.meta.url), 'utf8')).ambientEffects,
);

test('the shipped config resolves, in metres', () => {
  assert.equal(SETTINGS.enabled, true);
  const names = SETTINGS.fields.map((field) => field.name);
  for (const name of ['diamondDust', 'spindrift', 'blowingSand', 'surfSpray', 'pollen', 'fireflies', 'midges', 'lakeMist']) {
    assert.ok(names.includes(name), name);
  }
  const spindrift = SETTINGS.fields.find((field) => field.name === 'spindrift');
  assert.ok(spindrift.area > 15 && spindrift.area < 25, 'a 20 m field, not grass-test\'s 56 units');
  assert.equal(SETTINGS.fields.find((field) => field.name === 'lakeMist').base, 'lake');
  assert.throws(() => resolveAmbientEffectsConfig({ fields: { bad: { count: 5, area: 4, shape: 'cube' } } }), /shape/);
  assert.equal(presetWeight({ presets: { windy: 0.2 }, presetDefault: 1 }, 'windy'), 0.2);
  assert.equal(windFactor(4, 1), 2, 'wind scaling is capped');
});

test('times of day and weather map onto grass-test presets', () => {
  assert.equal(ambientPresetName({ skyPreset: 'emberfall', weatherMode: 'off' }), 'goldenHour');
  assert.equal(ambientPresetName({ skyPreset: 'emberfall', weatherMode: 'rain' }), 'rainy');
  assert.equal(ambientPresetName({ skyPreset: 'configured', weatherMode: 'off', night: true }), 'moonlight');
  assert.equal(ambientPresetName({ skyPreset: 'unknown', weatherMode: 'meadow' }), 'sunny');
});

test('regions come from the ground and water around the focus', () => {
  const inland = ambientRegionWeights({ tiles: Array(41).fill(4), water: Array(41).fill(0), heightAboveSea: 80, snow: 0 });
  assert.ok(inland.meadow > 0.9 && inland.sand === 0 && inland.surf === 0);
  const beachWater = Array(41).fill(0).map((_, index) => (index > 24 ? 1 : 0));
  const beach = ambientRegionWeights({ tiles: Array(41).fill(4), water: beachWater, heightAboveSea: 1, snow: 0 });
  assert.ok(beach.surf > 0.5 && beach.sand > 0.5 && beach.meadow < inland.meadow);
  const summit = ambientRegionWeights({ tiles: Array(41).fill(11), water: Array(41).fill(0), heightAboveSea: 900, snow: 1 });
  assert.equal(summit.snow, 1);
  assert.equal(summit.meadow, 0);
  const lake = ambientRegionWeights({ tiles: Array(41).fill(4), water: [2, 2, 2, 2, 2, 2, 2, 2, 2, ...Array(32).fill(0)], heightAboveSea: 30, snow: 0 });
  assert.ok(lake.lake > 0.9 && lake.water > 0.5);
  assert.equal(regionWeight({ snow: 0.3, sand: 0.7 }, ['snow', 'sand']), 0.7);
});

test('the controller weights fields by region, preset and wind, and eases them', () => {
  const scene = new THREE.Scene();
  const system = new AmbientEffectsSystem({
    scene,
    settings: SETTINGS,
    getTile: () => 11,
    getTileSize: () => 2,
    getWater: () => ({ kind: 0, surfaceHeight: 0 }),
    getGroundHeight: () => 900,
  });
  const state = {
    focus: { x: 0, y: 901.7, z: 0 },
    origin: { x: 0, z: 0 },
    presetName: 'windy',
    wind: { x: 1, z: 0, strength: SETTINGS.windReference },
    snowCountry: 1,
    seaLevel: 0,
  };
  system.update(0.05, state);
  const fields = system.getState().fields;
  assert.ok(fields.spindrift.intensity > 0.9, 'a teleport-sized first step snaps');
  assert.equal(fields.pollen.intensity, 0, 'no pollen on a glacier');
  assert.ok(fields.diamondDust.target > 0 && fields.diamondDust.target < 1, 'windy dims the diamond dust');
  state.presetName = 'rainy';
  system.update(0.05, state);
  assert.ok(system.getState().fields.diamondDust.intensity > 0, 'eased, not cut');
  for (let frame = 0; frame < 200; frame += 1) system.update(0.05, state);
  assert.equal(system.getState().fields.diamondDust.intensity, 0);
  system.dispose();
  assert.equal(scene.children.length, 0);
});

test('crests are found above the snow line, apart, highest first', async () => {
  const { findCrestAnchors } = await import('../src/editor/stylized/ambient/RidgePlumes.js');
  // Two summits (900 m and 800 m) 500 m apart on a 600 m plateau.
  const peak = (x, z, cx, cz, h) => h * Math.exp(-(((x - cx) ** 2 + (z - cz) ** 2) / (2 * 80 ** 2)));
  const height = (x, z) => 600 + peak(x, z, 0, 0, 300) + peak(x, z, 500, 0, 200);
  const anchors = findCrestAnchors(height, { minX: -600, maxX: 1100, minZ: -600, maxZ: 600 }, {
    minHeight: 700, step: 30, prominenceRadius: 150, minProminence: 15, spacing: 250, count: 5,
  });
  assert.equal(anchors.length, 2);
  assert.ok(Math.abs(anchors[0].x) <= 30 && anchors[0].y > anchors[1].y);
  assert.ok(Math.abs(anchors[1].x - 500) <= 30);
  assert.equal(findCrestAnchors(height, { minX: -600, maxX: 1100, minZ: -600, maxZ: 600 }, {
    minHeight: 1000, step: 30, prominenceRadius: 150, minProminence: 15, spacing: 250, count: 5,
  }).length, 0, 'nothing stands above a higher snow line');
});

test('breath shows only in the cold, from a visible hero', async () => {
  const { BreathPuffs } = await import('../src/editor/stylized/ambient/BreathPuffs.js');
  const light = { sun: new THREE.Color(1, 1, 1), sky: new THREE.Color(1, 1, 1) };
  const breath = new BreathPuffs({
    settings: SETTINGS.breath,
    light: { sun: (await import('three/tsl')).uniform(light.sun), sky: (await import('three/tsl')).uniform(light.sky) },
    sun: (await import('three/tsl')).vec3(0, 1, 0),
    puffTexture: new THREE.DataTexture(new Uint8Array(4), 1, 1),
  });
  const model = new THREE.Group();
  const player = { breathSource: () => ({ model, height: 1.8, facing: 0, running: false }) };
  for (let frame = 0; frame < 120; frame += 1) {
    breath.update(1 / 30, { weights: { snow: 1 }, presetName: 'sunny', player });
  }
  assert.equal(breath.mesh.visible, true);
  for (let frame = 0; frame < 150; frame += 1) {
    breath.update(1 / 30, { weights: { snow: 0 }, presetName: 'sunny', player });
  }
  assert.equal(breath.mesh.visible, false, 'no breath below the snow line');
  breath.dispose();
});
