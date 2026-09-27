import test from 'node:test';
import assert from 'node:assert/strict';

import { SurfaceWetness } from '../src/editor/weather/surfaceWetness.js';
import {
  DEFAULT_SURFACE_WETNESS,
  resolveSurfaceWetnessConfig,
} from '../src/editor/weather/surfaceWetnessConfig.js';

function run(wetness, seconds, rain) {
  for (let t = 0; t < seconds; t += 0.5) wetness.update(0.5, rain);
  return wetness.value;
}

test('rain soaks the ground quickly and it dries slowly', () => {
  const target = { value: 0 };
  const wetness = new SurfaceWetness(DEFAULT_SURFACE_WETNESS, target);
  assert.ok(Math.abs(run(wetness, 20, 1) - 0.5) < 1e-9, 'half soaked after half of wetSeconds');
  assert.equal(run(wetness, 40, 1), 1);
  assert.equal(target.value, 1, 'the shader uniform follows');
  // Drizzle holds the ground at its own level rather than soaking it.
  assert.ok(Math.abs(run(wetness, 120, 0.3) - 0.5) < 1e-9);
  assert.equal(run(wetness, 600, 0.3), 0.3);
  assert.ok(Math.abs(run(wetness, 60, 0) - 0.05) < 1e-9, 'drying takes drySeconds for a full soak');
  assert.equal(run(wetness, 60, 0), 0);
  assert.equal(wetness.update(0, 1), 0, 'no time, no change');
});

test('wetness settings default and reject nonsense', () => {
  assert.deepEqual(resolveSurfaceWetnessConfig(undefined), DEFAULT_SURFACE_WETNESS);
  assert.equal(resolveSurfaceWetnessConfig({ drySeconds: 30 }).drySeconds, 30);
  assert.throws(() => resolveSurfaceWetnessConfig({ wetSeconds: 0 }), /wetSeconds/);
  assert.throws(() => resolveSurfaceWetnessConfig({ darkening: 1.5 }), /darkening/);
  assert.throws(() => resolveSurfaceWetnessConfig({ canopyShelter: -1 }), /canopyShelter/);
});
