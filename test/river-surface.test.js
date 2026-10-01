import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RIVER_DETAIL_PATTERN_PERIOD_METERS,
  createWaterDetailTexture,
} from '../src/editor/stylized/RiverSurfaceShading.js';
import { createWaterPatternOrigins } from '../src/editor/stylized/WaterPatternOrigins.js';

const WATER = Object.freeze({
  noiseScale: 0.87,
  scale: 0.23,
  refraction: { coarseScale: 0.045, fineScale: 0.16 },
  caustics: { scale: 0.45 },
});
import { validateRiverSurfaceConfig } from '../src/editor/water/RiverSurfaceConfig.js';

const CONFIG = Object.freeze({
  enabled: true,
  normalStrength: 1,
  cycleSeconds: 3,
  stillDrift: 0.07,
  currentDrift: 1.2,
  fullCurrentSpeed: 3,
  bankFoamWidth: 1.15,
});

test('the water pattern origins carry the river detail frame, wrapped exactly', () => {
  const origins = createWaterPatternOrigins(WATER);
  const period = RIVER_DETAIL_PATTERN_PERIOD_METERS;
  assert.deepEqual(origins.frame('riverDetail'), { scale: 1, period });
  origins.update(4_194_336.5, -2_097_120);
  const { x, y } = origins.uniforms.riverDetail.value;
  assert.ok(x >= 0 && x < period);
  assert.ok(y >= 0 && y < period);
  assert.equal(x, 4_194_336.5 - Math.floor(4_194_336.5 / period) * period);
});

test('the wrap period is a whole number of every detail tile', () => {
  // Detail 0.25/m, micro ×4, streaks ×1.5 (RiverSurfaceShading).
  for (const tilesPerMetre of [0.25, 1, 0.375]) {
    const tiles = RIVER_DETAIL_PATTERN_PERIOD_METERS * tilesPerMetre;
    assert.ok(Math.abs(tiles - Math.round(tiles)) < 1e-9, `${tilesPerMetre}/m`);
  }
});

test('the donor detail texture is a tileable 256² slope and noise field', () => {
  const texture = createWaterDetailTexture();
  const { data, width, height } = texture.image;
  assert.equal(width, 256);
  assert.equal(height, 256);
  // RG slopes centre on 0.5, B foam noise spans a useful range.
  let sumR = 0, minB = 255, maxB = 0;
  for (let index = 0; index < data.length; index += 4) {
    sumR += data[index];
    minB = Math.min(minB, data[index + 2]);
    maxB = Math.max(maxB, data[index + 2]);
  }
  assert.ok(Math.abs(sumR / (width * height) - 127.5) < 6);
  assert.ok(maxB - minB > 100);
  texture.dispose();
});

test('riverSurface config is validated', () => {
  assert.equal(validateRiverSurfaceConfig({ ...CONFIG }).enabled, true);
  // Absent is off, so water configs from before the river surface still load.
  assert.equal(validateRiverSurfaceConfig(null), null);
  assert.equal(validateRiverSurfaceConfig(undefined), null);
  assert.throws(() => validateRiverSurfaceConfig([]), /must be an object/);
  assert.throws(() => validateRiverSurfaceConfig({ ...CONFIG, foamStrength: -1 }), /foamStrength/);
  assert.throws(() => validateRiverSurfaceConfig({ ...CONFIG, enabled: 'yes' }), /boolean/);
  assert.throws(() => validateRiverSurfaceConfig({ ...CONFIG, cycleSeconds: 0 }), /cycleSeconds/);
  assert.throws(() => validateRiverSurfaceConfig({ ...CONFIG, bankFoamWidth: 0.05 }), /bankFoamWidth/);
});
