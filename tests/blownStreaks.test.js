import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { float, mix, positionWorld, uniform, vec2, vec3 } from 'three/tsl';
import {
  BLOWN_STREAK_TRAVEL_WRAP,
  DEFAULT_BLOWN_STREAKS,
  advanceBlownStreaks,
  blownStreakUniforms,
  blownStreaks,
  resolveBlownStreaks,
  streakBasis,
  streakLift,
} from '../src/editor/stylized/ambient/BlownStreaks.js';

test('the defaults resolve from an empty ambient block', () => {
  // A world that never mentions the streaks still gets them, because the effect
  // is a terrain term that only costs nodes when it is enabled.
  const settings = resolveBlownStreaks();
  assert.equal(settings.enabled, true);
  assert.equal(settings.snow.strength, DEFAULT_BLOWN_STREAKS.snow.strength);
  assert.equal(settings.snow.hardness, DEFAULT_BLOWN_STREAKS.snow.hardness);
  assert.equal(settings.sand.strength, DEFAULT_BLOWN_STREAKS.sand.strength);
  assert.ok(settings.snow.length > 0 && settings.sand.length > 0);
  // Snow is the softer ground, which is what lets a snow streak run further on the
  // same wind than a sand one — the "ground hardness" the strength is keyed on.
  assert.ok(settings.snow.hardness < settings.sand.hardness);
});

test('it reads the ambient layer\'s own snow and sand keys', () => {
  // config/ambient-effects.yaml already carries snowStreaks/sandStreaks; the
  // resolved block keeps enabled and strength on those names, so the shape keys
  // fall back to the defaults here and nothing has to be added to the YAML.
  const settings = resolveBlownStreaks({
    enabled: true,
    snowStreaks: { enabled: true, strength: 1 },
    sandStreaks: { enabled: true, strength: 0.75 },
  });
  assert.equal(settings.snow.strength, 1);
  assert.equal(settings.sand.strength, 0.75);
  assert.equal(settings.snow.length, DEFAULT_BLOWN_STREAKS.snow.length);
});

test('a bad shape fails loudly, naming its path', () => {
  assert.throws(() => resolveBlownStreaks({ snowStreaks: { hardness: 2 } }),
    /ambientEffects\.snowStreaks\.hardness must be within \[0, 1\]/);
  assert.throws(() => resolveBlownStreaks({ sandStreaks: { strength: -1 } }),
    /ambientEffects\.sandStreaks\.strength must be within \[0, 4\]/);
  assert.throws(() => resolveBlownStreaks({ snowStreaks: { length: 0 } }),
    /ambientEffects\.snowStreaks\.length must be positive/);
  assert.throws(() => resolveBlownStreaks({ sandStreaks: { reach: 'wide' } }),
    /ambientEffects\.sandStreaks\.reach must be positive/);
});

test('disabling the layer or both surfaces compiles nothing', () => {
  assert.equal(resolveBlownStreaks({ enabled: false }).enabled, false);
  const bothOff = resolveBlownStreaks({
    snowStreaks: { enabled: false },
    sandStreaks: { enabled: false },
  });
  assert.equal(bothOff.enabled, false);
  assert.equal(bothOff.snow, null);
  // The node function returns null, so a material blending it in adds no nodes.
  assert.equal(blownStreaks({ worldXZ: vec2(0, 0), kind: 'snow', weight: float(1), settings: bothOff }), null);

  // One surface off leaves the other working, and only the off one is null.
  const snowOnly = resolveBlownStreaks({ sandStreaks: { enabled: false } });
  assert.ok(snowOnly.snow);
  assert.equal(snowOnly.sand, null);
  assert.equal(blownStreaks({ worldXZ: vec2(0, 0), kind: 'sand', weight: float(1), settings: snowOnly }), null);
});

test('the streak graph assembles from real three/tsl inputs', () => {
  // Built in Node so a TSL mistake fails here rather than as a blank, unshaded
  // patch of ground in a browser.
  const settings = resolveBlownStreaks();
  const snow = blownStreaks({
    worldXZ: positionWorld.xz,
    kind: 'snow',
    weight: uniform(1),
    packing: uniform(0),
    settings,
  });
  const sand = blownStreaks({
    worldXZ: positionWorld.xz,
    kind: 'sand',
    weight: uniform(1),
    packing: uniform(0),
    settings,
  });
  assert.ok(snow, 'an enabled snow effect should build a mask');
  assert.ok(sand, 'an enabled sand effect should build a mask');
  const material = new THREE.MeshStandardNodeMaterial();
  material.colorNode = mix(vec3(0.8, 0.8, 0.8), vec3(1, 1, 1), snow);
  material.emissiveNode = sand;
  assert.ok(material.colorNode);
  assert.ok(material.emissiveNode);
  material.dispose();
});

test('streakBasis points the streaks along the wind', () => {
  // The node stretches the noise along `dot(world, dir)` and across its
  // perpendicular, so a wrong handedness would rotate every streak off the gust
  // that is driving it.
  const north = streakBasis({ x: 0, y: 2 });
  assert.deepEqual(north.along, { x: 0, y: 1 });
  assert.deepEqual(north.across, { x: -1, y: 0 });
  const east = streakBasis({ x: 3, y: 0 });
  assert.deepEqual(east.along, { x: 1, y: 0 });
  assert.deepEqual(east.across, { x: 0, y: 1 });
  // A still or degenerate wind falls back to +X rather than producing NaNs.
  assert.deepEqual(streakBasis({ x: 0, y: 0 }).along, { x: 1, y: 0 });
  // The two axes stay unit and orthogonal for any heading.
  for (const heading of [0.3, 1.1, 2.7, 4.9]) {
    const basis = streakBasis({ x: Math.cos(heading), y: Math.sin(heading) });
    const dot = basis.along.x * basis.across.x + basis.along.y * basis.across.y;
    assert.ok(Math.abs(dot) < 1e-9);
    assert.ok(Math.abs(Math.hypot(basis.across.x, basis.across.y) - 1) < 1e-9);
  }
});

test('the lift is keyed on how hard the ground is', () => {
  assert.equal(streakLift({ weight: 1 }), 1);
  assert.equal(streakLift({ weight: 1, hardness: 1 }), 0, 'packed ground does not lift');
  assert.equal(streakLift({ weight: 0 }), 0, 'no surface, no streaks');
  assert.equal(streakLift({ weight: 1, packing: 1 }), 0, 'wet or compressed ground does not lift');

  // The shipped give: loose snow lofts more of itself than packed sand.
  const snow = streakLift({ weight: 1, ...DEFAULT_BLOWN_STREAKS.snow });
  const sand = streakLift({ weight: 1, ...DEFAULT_BLOWN_STREAKS.sand });
  assert.ok(snow > sand && sand > 0, `${snow} should outrun ${sand}`);
});

test('the travel scalars integrate and wrap', () => {
  blownStreakUniforms.snowTravel.value = 0;
  blownStreakUniforms.sandTravel.value = 0;
  advanceBlownStreaks({ delta: 1, envelope: 1, gust: 1 });
  assert.ok(blownStreakUniforms.snowTravel.value > 0);
  assert.ok(blownStreakUniforms.snowTravel.value < BLOWN_STREAK_TRAVEL_WRAP);
  // The two surfaces slide at their own rates, so they do not move as one sheet.
  assert.notEqual(blownStreakUniforms.snowTravel.value, blownStreakUniforms.sandTravel.value);
  // A long frame wraps instead of growing without bound.
  advanceBlownStreaks({ delta: 1e6, envelope: 4, gust: 2 });
  assert.ok(blownStreakUniforms.snowTravel.value >= 0);
  assert.ok(blownStreakUniforms.snowTravel.value < BLOWN_STREAK_TRAVEL_WRAP);
  blownStreakUniforms.snowTravel.value = 0;
  blownStreakUniforms.sandTravel.value = 0;
});
