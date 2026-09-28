import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import * as THREE from 'three/webgpu';
import { vec4 } from 'three/tsl';

import { resolveAmbientEffectsConfig } from '../src/editor/stylized/ambient/ambientEffectsConfig.js';
import { AmbientEffectsSystem } from '../src/editor/stylized/ambient/AmbientEffectsSystem.js';
import { heatShimmerUniforms } from '../src/editor/stylized/ambient/HeatShimmer.js';
import { jungleMistUniforms } from '../src/editor/stylized/ambient/JungleMist.js';
import { applyJungleMist } from '../src/editor/stylized/ambient/jungleMistOutput.js';

const SETTINGS = resolveAmbientEffectsConfig(
  yaml.load(readFileSync(new URL('../config/ambient-effects.yaml', import.meta.url), 'utf8')).ambientEffects,
);

function systemOn(tile, ground) {
  return new AmbientEffectsSystem({
    scene: new THREE.Scene(),
    settings: SETTINGS,
    getTile: () => tile,
    getTileSize: () => 2,
    getWater: () => ({ kind: 0, surfaceHeight: 0 }),
    getGroundHeight: () => ground,
  });
}

function stateAt(ground, presetName = 'sunny') {
  return {
    focus: { x: 0, y: ground + 1.7, z: 0 },
    origin: { x: 0, z: 0 },
    presetName,
    wind: { x: 1, z: 0, strength: SETTINGS.windReference },
    snowCountry: 0,
    seaLevel: 0,
  };
}

test('the mist blends over a material\'s lit output, and only when configured', () => {
  const plain = new THREE.MeshLambertNodeMaterial();
  assert.equal(applyJungleMist(plain, null), false, 'no ambient block, no mist');
  assert.equal(plain.outputNode, null);
  assert.equal(applyJungleMist(plain, { enabled: false }), false, 'a disabled layer builds nothing');

  const misted = new THREE.MeshLambertNodeMaterial();
  assert.equal(applyJungleMist(misted, SETTINGS), true);
  assert.ok(misted.outputNode, 'the blend owns the output node');

  const owned = new THREE.MeshLambertNodeMaterial();
  const before = vec4(1);
  owned.outputNode = before;
  assert.equal(applyJungleMist(owned, SETTINGS), false, 'an existing output node is left alone');
  assert.equal(owned.outputNode, before);
});

test('the jungle raises the mist and lays it on the ground under the view', () => {
  const system = systemOn(7, 42);
  system.update(0.05, stateAt(42));
  assert.ok(jungleMistUniforms.weight.value > 0.5, 'rainforest all round');
  assert.equal(jungleMistUniforms.ground.value, 42, 'the first step snaps to the ground');
  assert.equal(heatShimmerUniforms.hot.value, 0, 'no shimmer in the jungle');
  system.dispose();
  assert.equal(jungleMistUniforms.weight.value, 0, 'a disposed world leaves the mist off');
});

test('hot desert shimmers under a sunny preset, not by moonlight', () => {
  const system = systemOn(1, 20);
  system.update(0.05, stateAt(20, 'sunny'));
  assert.ok(heatShimmerUniforms.hot.value > 0.5, 'open hot desert');
  assert.equal(jungleMistUniforms.weight.value, 0);
  const night = stateAt(20, 'moonlight');
  for (let frame = 0; frame < 300; frame += 1) system.update(0.05, night);
  assert.equal(heatShimmerUniforms.hot.value, 0, 'the preset default is zero');
  system.dispose();
});
