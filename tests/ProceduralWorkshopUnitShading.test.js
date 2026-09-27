import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { beveledBox } from '../src/editor/workshop/ProceduralWorkshopGeometry.js';
import {
  STONE_PALETTES,
  applyUnitShading,
  stoneUnitAlbedo,
} from '../src/editor/workshop/ProceduralWorkshopMaterials.js';
import { stoneSurfaceProfile } from '../src/editor/workshop/ProceduralWorkshopStoneSurfaceConfig.js';

function recipe(style) {
  return Object.freeze({
    seed: 3141,
    irregularity: 0.36,
    detail: 2,
    style,
    topStyle: 'slate',
    weathering: 0.5,
    albedo: null,
  });
}

function shade(style, options = {}) {
  const geometry = beveledBox({
    width: 0.8,
    height: 0.45,
    depth: 0.7,
    detail: 1,
  });
  applyUnitShading(geometry, recipe(style), {
    stableIndex: 17,
    heightRatio: options.heightRatio ?? 0.2,
    protrusion: options.protrusion ?? 0,
    depth: 0.7,
    neutral: options.neutral ?? false,
  });
  return geometry;
}

function colorStats(geometry) {
  const colors = geometry.getAttribute('color').array;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (let index = 0; index < colors.length; index += 1) {
    const value = colors[index];
    assert.ok(Number.isFinite(value));
    assert.ok(value >= 0 && value <= 1);
    min = Math.min(min, value);
    max = Math.max(max, value);
    sum += value;
  }
  return { min, max, mean: sum / colors.length, range: max - min };
}

test('soft-limestone unit shading is narrower than legacy limestone', () => {
  const soft = shade('soft-limestone');
  const legacy = shade('limestone');
  const softStats = colorStats(soft);
  const legacyStats = colorStats(legacy);
  assert.ok(softStats.range < legacyStats.range);
  soft.dispose();
  legacy.dispose();
});

test('crevice and recess shading remain darker', () => {
  const proud = shade('soft-limestone', { protrusion: 0.05, heightRatio: 0.8 });
  const recessed = shade('soft-limestone', { protrusion: -0.2, heightRatio: 0.8 });
  assert.ok(colorStats(recessed).mean < colorStats(proud).mean);
  proud.dispose();
  recessed.dispose();
});

test('soft-limestone weathers less at the base than legacy limestone', () => {
  const softLow = shade('soft-limestone', { heightRatio: 0 });
  const legacyLow = shade('limestone', { heightRatio: 0 });
  const softHigh = shade('soft-limestone', { heightRatio: 1 });
  const legacyHigh = shade('limestone', { heightRatio: 1 });
  const softWeather = colorStats(softHigh).mean - colorStats(softLow).mean;
  const legacyWeather = colorStats(legacyHigh).mean - colorStats(legacyLow).mean;
  assert.ok(softWeather < legacyWeather);
  softLow.dispose();
  legacyLow.dispose();
  softHigh.dispose();
  legacyHigh.dispose();
});

test('neutral imported-albedo mode carries no palette hue', () => {
  const geometry = shade('soft-limestone', { neutral: true });
  const colors = geometry.getAttribute('color').array;
  // Occlusion only: R=G=B for every vertex.
  for (let vertex = 0; vertex < colors.length; vertex += 3) {
    assert.equal(colors[vertex], colors[vertex + 1]);
    assert.equal(colors[vertex], colors[vertex + 2]);
  }
  geometry.dispose();
});

test('stoneUnitAlbedo picks a stable colour inside the palette and brightness range', () => {
  const unitRecipe = recipe('warm-fieldstone');
  const palette = STONE_PALETTES['warm-fieldstone'];
  const { brightnessMin, brightnessMax } = stoneSurfaceProfile('warm-fieldstone').unitShading;
  const stops = [...palette.ramp, palette.outlier];
  for (let stableIndex = 0; stableIndex < 64; stableIndex += 1) {
    const colour = stoneUnitAlbedo(unitRecipe, stableIndex);
    assert.ok(colour instanceof Float32Array);
    assert.deepEqual([...colour], [...stoneUnitAlbedo(unitRecipe, stableIndex)]);
    for (let channel = 0; channel < 3; channel += 1) {
      const low = Math.min(...stops.map((stop) => stop[channel])) / 255 * brightnessMin;
      const high = Math.max(...stops.map((stop) => stop[channel])) / 255 * brightnessMax;
      assert.ok(colour[channel] >= low - 1e-6 && colour[channel] <= high + 1e-6);
    }
  }
});
