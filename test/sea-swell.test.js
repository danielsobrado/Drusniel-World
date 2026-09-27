import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SEA_SWELL_COMPONENTS,
  SEA_SWELL_WEIGHT_SUM,
  sampleSeaSwellCpu,
  seaSwellPhaseOrigin,
  seaWaveShape,
} from '../src/editor/water/SeaSwell.js';
import {
  configureSea,
  seaAmplitude,
  seaSurfaceOffset,
  updateSeaState,
} from '../src/editor/water/seaState.js';
import { validateSeaConfig } from '../src/editor/water/SeaConfig.js';

const SEA = Object.freeze({
  enabled: true,
  amplitude: 0.9,
  stormScale: 1.65,
  choppiness: 4,
  shallowDepth: 1.5,
  depthRatio: 0.42,
  slopeShading: 0.55,
  crestLift: 0.12,
  whitecapThreshold: 0.8,
  stormWhitecapThreshold: 0.45,
});

/** What the shader computes: the chunk-centre phase plus the phase across the chunk. */
function shaderSwell(center, local, time, sharpness) {
  const origin = seaSwellPhaseOrigin(center[0], center[1]);
  let height = 0;
  SEA_SWELL_COMPONENTS.forEach((wave, index) => {
    const phase = origin[index]
      + (local[0] * wave.x + local[1] * wave.z) * wave.waveNumber
      + ((time * wave.angularSpeed) % (Math.PI * 2));
    height += wave.weight * seaWaveShape(phase, sharpness);
  });
  return height / SEA_SWELL_WEIGHT_SUM;
}

test('chunk phase origins reproduce the absolute swell far out on a planet-sized sea', () => {
  const center = [-4226432, 278528];
  for (const local of [[0, 0], [31.5, -12], [-64, 64]]) {
    for (const time of [0, 17.3, 3600.25]) {
      const cpu = sampleSeaSwellCpu(center[0] + local[0], center[1] + local[1], time, 0.3);
      assert.ok(Math.abs(shaderSwell(center, local, time, 0.3) - cpu) < 1e-6);
    }
  }
});

test('the swell is continuous across a chunk border', () => {
  // The same point seen from two chunks' origins agrees.
  const a = shaderSwell([1000, 2000], [64, 0], 12, 0.3);
  const b = shaderSwell([1128, 2000], [-64, 0], 12, 0.3);
  assert.ok(Math.abs(a - b) < 1e-6);
});

test('normalised swell stays within about one', () => {
  let peak = 0;
  for (let x = 0; x < 400; x += 3.7) {
    peak = Math.max(peak, Math.abs(sampleSeaSwellCpu(x, x * 0.61, 5, 0.3)));
  }
  assert.ok(peak > 0.5 && peak <= 1.2);
});

test('the amplitude vanishes in the shallows and grows in a storm', () => {
  assert.equal(seaAmplitude(SEA, 0, 0), 0);
  assert.ok(seaAmplitude(SEA, 0, 0.4) <= 0.4 * SEA.depthRatio);
  assert.equal(seaAmplitude(SEA, 0, 20), SEA.amplitude);
  assert.ok(Math.abs(seaAmplitude(SEA, 1, 20) - SEA.amplitude * SEA.stormScale) < 1e-9);
});

test('gameplay rides the swell only once the sea is configured', () => {
  configureSea(null);
  assert.equal(seaSurfaceOffset(10, 20, 10), 0);
  configureSea(SEA);
  updateSeaState({ timeSeconds: 42, storm: 0, seaLevel: -1.5 });
  const offset = seaSurfaceOffset(10, 20, 10);
  assert.ok(Math.abs(offset) <= SEA.amplitude * 1.2);
  assert.equal(seaSurfaceOffset(10, 20, 0), 0, 'no swell on the beach');
  configureSea(null);
});

test('sea config is validated', () => {
  assert.equal(validateSeaConfig({ ...SEA }).amplitude, 0.9);
  assert.throws(() => validateSeaConfig({ ...SEA, depthRatio: 0 }), /depthRatio/);
  assert.throws(() => validateSeaConfig({ ...SEA, enabled: 'yes' }), /enabled/);
});
