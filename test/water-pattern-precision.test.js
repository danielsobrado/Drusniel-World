import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PATTERN_PERIOD,
  PatternOrigins,
  latticePatternOrigin,
  referenceBlendTapsCpu,
  wavePatternOrigin,
  wrapPeriodic,
} from '../src/editor/stylized/PatternOrigins.js';
import { PERIODIC_OCTAVE_PERIODS } from '../src/editor/stylized/PeriodicNoiseNodes.js';
import {
  WATER_FLOW_REFERENCE_BLEND,
  WATER_FLOW_REFERENCE_METERS,
} from '../src/editor/stylized/WaterPatternOrigins.js';

// An Eldara beach sits near cell (-2478811, -211331); the far side of the
// planet reaches past five million metres.
const PLANET_CENTERS = Object.freeze([
  [-2478811 * 2, 211331 * 2],
  [-5000123.5, 3999871.25],
  [12.5, -7.5],
]);
const CHUNK_METERS = 64;
const f32 = Math.fround;

/** What the shader computes: a float32 origin uniform plus the float32 local term. */
function shaderLattice(center, local, scale, period = PATTERN_PERIOD) {
  const origin = latticePatternOrigin(center[0], center[1], scale, period);
  return [
    f32(f32(origin[0]) + f32(f32(local[0]) * f32(scale))),
    f32(f32(origin[1]) + f32(f32(local[1]) * f32(scale))),
  ];
}

/** Distance between two coordinates modulo a lattice period. */
function periodicGap(a, b, period) {
  const gap = wrapPeriodic(a - b, period);
  return Math.min(gap, period - gap);
}

test('every FBM octave closes over the pattern period on a power of two', () => {
  for (const period of PERIODIC_OCTAVE_PERIODS) {
    // The shader wraps a cell with `& (period - 1)`.
    assert.equal(Number.isInteger(Math.log2(period)), true, `octave period ${period}`);
    assert.equal(period % PATTERN_PERIOD, 0);
  }
});

test('lattice origins keep the fraction a canonical float32 position loses', () => {
  const scale = 0.87;
  for (const center of PLANET_CENTERS) {
    const local = [13.37, -21.5];
    const exact = [(center[0] + local[0]) * scale, (center[1] + local[1]) * scale];
    const shader = shaderLattice(center, local, scale);
    for (let axis = 0; axis < 2; axis += 1) {
      assert.ok(periodicGap(shader[axis], exact[axis], PATTERN_PERIOD) < 1e-3);
    }
  }
  // The regression: a float32 canonical coordinate has no fraction left.
  const naive = f32(f32(PLANET_CENTERS[0][0]) + 13.37) * scale;
  assert.ok(periodicGap(naive, (PLANET_CENTERS[0][0] + 13.37) * scale, PATTERN_PERIOD) > 0.05);
});

test('neighbouring chunks address one point congruently for every octave', () => {
  for (const scale of [0.87, 0.23, 0.045, 0.16, 0.45, 0.021]) {
    for (const [x, z] of PLANET_CENTERS) {
      // Step across chunk borders until the two chunks land on different wraps,
      // so the seam test covers the case a periodic hash exists for.
      let crossedWrap = false;
      for (let step = 0; step < 4096 && !crossedWrap; step += 1) {
        const west = [x + step * CHUNK_METERS, z];
        const east = [west[0] + CHUNK_METERS, z];
        const fromWest = shaderLattice(west, [CHUNK_METERS / 2, 5], scale);
        const fromEast = shaderLattice(east, [-CHUNK_METERS / 2, 5], scale);
        crossedWrap = Math.floor(fromWest[0] / PATTERN_PERIOD) !== Math.floor(fromEast[0] / PATTERN_PERIOD);
        PERIODIC_OCTAVE_PERIODS.forEach((period, index) => {
          const frequency = period / PATTERN_PERIOD;
          assert.ok(
            periodicGap(fromWest[0] * frequency, fromEast[0] * frequency, period) < 2e-3,
            `scale ${scale} octave ${index} step ${step}`,
          );
          assert.ok(periodicGap(fromWest[1] * frequency, fromEast[1] * frequency, period) < 2e-3);
        });
      }
      assert.equal(crossedWrap, true, `scale ${scale} never crossed a wrap`);
    }
  }
});

test('wave origins reproduce a plane wave exactly at planet scale', () => {
  const wave = [0.27, -0.21];
  for (const center of PLANET_CENTERS) {
    for (const local of [[0, 0], [31.9, -31.9], [-17.25, 4.5]]) {
      const origin = f32(wavePatternOrigin(center[0], center[1], wave[0], wave[1]));
      const shader = f32(origin + f32(local[0] * wave[0]) + f32(local[1] * wave[1]));
      const exact = (center[0] + local[0]) * wave[0] + (center[1] + local[1]) * wave[1];
      assert.ok(Math.abs(Math.sin(shader) - Math.sin(exact)) < 1e-4);
    }
  }
});

test('current-aligned patterns see the same references from both sides of a chunk border', () => {
  const spacing = WATER_FLOW_REFERENCE_METERS;
  for (const [x, z] of PLANET_CENTERS) {
    for (let step = 0; step < 16; step += 1) {
      const west = [x + step * CHUNK_METERS, z];
      const east = [west[0] + CHUNK_METERS, z];
      const tapsFrom = (center, local) => {
        const origin = latticePatternOrigin(center[0], center[1], 1, spacing);
        const point = [f32(origin[0] + local[0]), f32(origin[1] + local[1])];
        // Canonical reference = canonical point − (point − reference).
        return referenceBlendTapsCpu(point[0], point[1], spacing, WATER_FLOW_REFERENCE_BLEND)
          .filter((tap) => tap.weight > 0)
          .map((tap) => ({
            x: Math.round(center[0] + local[0] - (point[0] - tap.referenceX)),
            z: Math.round(center[1] + local[1] - (point[1] - tap.referenceZ)),
            weight: tap.weight,
          }))
          .sort((a, b) => a.x - b.x || a.z - b.z);
      };
      for (const along of [-20, 0, 7.5, 20]) {
        const fromWest = tapsFrom(west, [CHUNK_METERS / 2, along]);
        const fromEast = tapsFrom(east, [-CHUNK_METERS / 2, along]);
        assert.equal(fromWest.length, fromEast.length);
        fromWest.forEach((tap, index) => {
          assert.equal(tap.x, fromEast[index].x);
          assert.equal(tap.z, fromEast[index].z);
          assert.ok(Math.abs(tap.weight - fromEast[index].weight) < 1e-4);
          assert.equal(wrapPeriodic(tap.x, spacing), 0);
        });
      }
    }
  }
});

test('reference weights partition unity', () => {
  for (let x = -300; x < 300; x += 7.3) {
    for (let z = -300; z < 300; z += 11.1) {
      const taps = referenceBlendTapsCpu(x, z, WATER_FLOW_REFERENCE_METERS, WATER_FLOW_REFERENCE_BLEND);
      const sum = taps.reduce((total, tap) => total + tap.weight, 0);
      assert.ok(Math.abs(sum - 1) < 1e-9);
    }
  }
});

test('a shared material reads each drawn object\'s own origins', () => {
  const frames = { drift: { scale: 0.021 }, breakup: { wave: [0.13, 0.09] } };
  const template = new PatternOrigins(frames);
  const own = new PatternOrigins(frames);
  own.update(PLANET_CENTERS[0][0], PLANET_CENTERS[0][1]);
  const view = template.perObject((object) => object.origins);

  view.uniforms.drift.update({ object: { origins: own } });
  view.uniforms.breakup.update({ object: { origins: own } });
  assert.equal(view.uniforms.drift.value, own.uniforms.drift.value);
  assert.equal(view.uniforms.breakup.value, own.uniforms.breakup.value);
  assert.ok(view.uniforms.breakup.value > 0 && view.uniforms.breakup.value < Math.PI * 2);

  view.uniforms.drift.update({ object: {} });
  assert.equal(view.uniforms.drift.value, template.uniforms.drift.value);
});
