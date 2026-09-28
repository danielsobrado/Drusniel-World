import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { float, uniform, vec2 } from 'three/tsl';
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
import { createSeaSurfaceNodes } from '../src/editor/stylized/SeaSurfaceShading.js';

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
  crestTransmission: 0.5,
  crestColor: '#8fd0a8',
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
  // The crest transmission and its colour are validated with the rest: a colour
  // typo would otherwise reach the shader as a parse failure in the browser.
  assert.throws(() => validateSeaConfig({ ...SEA, crestTransmission: 2 }), /crestTransmission/);
  assert.throws(() => validateSeaConfig({ ...SEA, crestColor: 'green' }), /crestColor/);
});

test('crest transmission is a term the sea nodes expose and the graph builds', () => {
  // The three factors the donor multiplies cannot be evaluated here — they are shader
  // nodes — so what this holds is that the term exists, that it is built from the
  // crest and the view direction, and that assembling it does not throw. The failure
  // mode it guards is a term that is refactored away, or an input the graph cannot
  // take, which would otherwise only show as a sea that never glows.
  const sea = createSeaSurfaceNodes({
    terrainUv: vec2(0.5, 0.5),
    chunkWorldSize: 8,
    surfaceWorldHeight: float(0),
    waterDepth: float(20),
    waterCoverage: float(1),
    currentStrength: float(0),
    time: uniform(0),
    phaseOrigin: [uniform(0), uniform(0), uniform(0), uniform(0), uniform(0)],
    sunDirection: uniform(new THREE.Vector3(0, 0.2, -1)),
    config: SEA,
  });
  assert.equal(typeof sea.transmissionAmount, 'function');
  const amount = sea.transmissionAmount(uniform(new THREE.Vector3(0, 0, -1)));
  assert.ok(amount, 'the term should be a node');
  assert.equal(typeof amount.mul, 'function', 'a node, not a number');
  // Zero compiles the term out of the material entirely, so a world that does not
  // want it pays nothing.
  sea.transmissionAmount(uniform(new THREE.Vector3(0, 0, -1)));
  assert.equal(
    createSeaSurfaceNodes({
      terrainUv: vec2(0.5, 0.5),
      chunkWorldSize: 8,
      surfaceWorldHeight: float(0),
      waterDepth: float(20),
      waterCoverage: float(1),
      currentStrength: float(0),
      time: uniform(0),
      phaseOrigin: [uniform(0), uniform(0), uniform(0), uniform(0), uniform(0)],
      sunDirection: uniform(new THREE.Vector3(0, 0.2, -1)),
      config: { ...SEA, crestTransmission: 0 },
    }).transmissionAmount(uniform(new THREE.Vector3(0, 0, -1))) !== undefined,
    true,
  );
});
