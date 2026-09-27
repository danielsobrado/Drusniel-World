import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';

import {
  SNOWFALL_POPULATIONS,
  createSnowfallField,
  createSnowfallGeometry,
  gustFactor,
  snowfallFlakeCount,
} from '../src/editor/weather/snowfall/SnowfallField.js';
import { REGIONAL_SNOW_INTENSITY, SnowWeatherSystem } from '../src/editor/weather/snow_system.js';

test('every population thins alike as intensity drops', () => {
  const geometry = createSnowfallGeometry(SNOWFALL_POPULATIONS, () => 0.5);
  const seeds = geometry.attributes.snowSeed;
  const shapes = geometry.attributes.snowShape;
  assert.equal(seeds.count, snowfallFlakeCount() * 4);
  let start = 0;
  for (const population of SNOWFALL_POPULATIONS) {
    const ranks = Array.from({ length: population.count }, (_, i) => seeds.getW((start + i) * 4));
    assert.ok(ranks[0] < 1 / population.count + 1e-9 && ranks.at(-1) > 1 - 1 / population.count - 1e-9);
    assert.equal(Math.sign(shapes.getZ(start * 4)), Math.sign(population.radius), 'bokeh flakes keep a negative radius');
    start += population.count;
  }
});

test('the drift integrates the wind, so a gust never jumps the field', () => {
  const field = createSnowfallField();
  field.setWind(1, 0);
  field.setTime(0);
  let previous = 0;
  for (let frame = 1; frame <= 600; frame += 1) {
    field.setTime(frame / 60);
    const drift = field.uniforms.drift.value.x;
    assert.ok(drift - previous >= 0 && drift - previous < 0.05, `frame ${frame} moved ${drift - previous}`);
    previous = drift;
  }
  assert.ok(Math.abs(previous - 10) < 3, `about ten seconds of a 1 m/s wind (${previous})`);
  assert.equal(field.uniforms.drift.value.y, 0);
  assert.ok(gustFactor(3) > 0);
  field.dispose();
});

test('snow country snows lightly with the weather off, and weather snow only adds', () => {
  const scene = new THREE.Scene();
  const snow = new SnowWeatherSystem({ scene, isWebGpu: true });
  snow.applySettings({ enabled: false, intensity: 0.7, windX: 0, windZ: 0 });
  assert.equal(snow.group.visible, false);
  snow.setRegionalSnow(1);
  assert.equal(snow.group.visible, true);
  assert.equal(snow.snowMaterial.uniforms.intensity.value, REGIONAL_SNOW_INTENSITY);
  snow.applySettings({ enabled: true, intensity: 1.2, windX: 0, windZ: 0 });
  assert.equal(snow.snowMaterial.uniforms.intensity.value, 1.2);
  snow.applySettings({ enabled: false, intensity: 1.2, windX: 0, windZ: 0 });
  snow.setRegionalSnow(0);
  assert.equal(snow.group.visible, false);
  assert.equal(snow.getStats().flakes, 0);
  snow.dispose();
});
