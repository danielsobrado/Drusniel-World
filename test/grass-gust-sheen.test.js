import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import * as THREE from 'three/webgpu';

import { resolveAmbientEffectsConfig } from '../src/editor/stylized/ambient/ambientEffectsConfig.js';
import { AmbientEffectsSystem } from '../src/editor/stylized/ambient/AmbientEffectsSystem.js';
import { grassGustSheenUniforms } from '../src/editor/stylized/ambient/GrassGustSheen.js';

const SETTINGS = resolveAmbientEffectsConfig(
  yaml.load(readFileSync(new URL('../config/ambient-effects.yaml', import.meta.url), 'utf8')).ambientEffects,
);

test('an open meadow drives the gust sheen, and a disposed world clears it', () => {
  const system = new AmbientEffectsSystem({
    scene: new THREE.Scene(),
    settings: SETTINGS,
    getTile: () => 4,
    getTileSize: () => 2,
    getWater: () => ({ kind: 0, surfaceHeight: 0 }),
    getGroundHeight: () => 40,
  });
  system.update(0.05, {
    focus: { x: 0, y: 41.7, z: 0 },
    origin: { x: 0, z: 0 },
    presetName: 'sunny',
    wind: { x: 1, z: 0, strength: SETTINGS.windReference },
    snowCountry: 0,
    seaLevel: 0,
  });
  assert.ok(grassGustSheenUniforms.weight.value > 0.2, 'grassland all round');
  assert.equal(system.getState().surface.grassGustSheen, Number(grassGustSheenUniforms.weight.value.toFixed(3)));
  system.dispose();
  assert.equal(grassGustSheenUniforms.weight.value, 0);
});
