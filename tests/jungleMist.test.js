import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { float, uniform, vec3 } from 'three/tsl';
import {
  DEFAULT_JUNGLE_MIST,
  createJungleMistNodes,
  jungleMistBanks,
  jungleMistFactor,
  jungleMistIntegral,
  jungleMistUniforms,
  resolveJungleMistConfig,
} from '../src/editor/stylized/ambient/JungleMist.js';

/**
 * Build in Node, with real three/tsl inputs, so a TSL mistake fails here rather
 * than as an invisible sheet in a browser. `worldPosition` sits down the ray from
 * `cameraPosition`, as a shaded ground or foliage fragment would.
 */
function build(overrides = {}, extra = {}) {
  return createJungleMistNodes({
    worldPosition: uniform(new THREE.Vector3(4, 2, 60)),
    cameraPosition: uniform(new THREE.Vector3(0, 4, 30)),
    ground: uniform(0),
    weight: uniform(1),
    time: uniform(0),
    quality: 1,
    settings: resolveJungleMistConfig(overrides),
    ...extra,
  });
}

test('the defaults resolve from an empty ambient block', () => {
  // Absent config means the defaults, not no mist — a world that never mentions
  // it still gets jungle mist where the region weight says there is jungle.
  const settings = resolveJungleMistConfig();
  assert.equal(settings.enabled, true);
  assert.equal(settings.strength, DEFAULT_JUNGLE_MIST.strength);
  assert.equal(settings.presetDefault, 1);
  assert.equal(settings.density, DEFAULT_JUNGLE_MIST.density);
  assert.equal(settings.height, DEFAULT_JUNGLE_MIST.height);
  assert.equal(settings.maxDistance, DEFAULT_JUNGLE_MIST.maxDistance);
  assert.deepEqual(settings.nearClear, [...DEFAULT_JUNGLE_MIST.nearClear]);
  assert.equal(settings.color, DEFAULT_JUNGLE_MIST.color);
  // The near span must rise, or the clear window and the density fight.
  assert.ok(settings.nearClear[1] > settings.nearClear[0]);
});

test('it reads the ambient layer\'s own jungleMist key', () => {
  // config/ambient-effects.yaml carries `jungleMist`; the resolved block keeps
  // the donor's shape keys and presets there.
  const settings = resolveJungleMistConfig({
    enabled: true,
    jungleMist: {
      strength: 1,
      presets: { rainy: 1.4, moonlight: 1.2 },
      density: 0.02,
      height: 8,
      maxDistance: 300,
      nearStart: 4,
      nearEnd: 20,
      pocketStrength: 0.4,
      color: '#aabbcc',
    },
  });
  assert.equal(settings.presets.rainy, 1.4);
  assert.equal(settings.density, 0.02);
  assert.equal(settings.height, 8);
  assert.equal(settings.maxDistance, 300);
  assert.deepEqual(settings.nearClear, [4, 20]);
  assert.equal(settings.pocketStrength, 0.4);
  assert.equal(settings.color, '#aabbcc');
  // An already-resolved `nearClear` pair is accepted too, so the resolver
  // round-trips through its own output.
  assert.deepEqual(resolveJungleMistConfig({ jungleMist: { nearClear: [2, 14] } }).nearClear, [2, 14]);
});

test('a bad setting fails loudly, naming its path', () => {
  assert.throws(() => resolveJungleMistConfig({ jungleMist: { nearEnd: 4, nearStart: 12 } }),
    /ambientEffects\.jungleMist\.nearEnd must be greater than ambientEffects\.jungleMist\.nearStart/);
  assert.throws(() => resolveJungleMistConfig({ jungleMist: { density: -1 } }),
    /ambientEffects\.jungleMist\.density must be a finite number in range/);
  assert.throws(() => resolveJungleMistConfig({ jungleMist: { height: 0 } }),
    /ambientEffects\.jungleMist\.height must be a finite number in range/);
  assert.throws(() => resolveJungleMistConfig({ jungleMist: { maxDistance: 0 } }),
    /ambientEffects\.jungleMist\.maxDistance must be a finite number in range/);
  assert.throws(() => resolveJungleMistConfig({ jungleMist: { pocketStrength: 2 } }),
    /ambientEffects\.jungleMist\.pocketStrength must be a finite number in range/);
  assert.throws(() => resolveJungleMistConfig({ jungleMist: { ceiling: 1.5 } }),
    /ambientEffects\.jungleMist\.ceiling must be a finite number in range/);
  assert.throws(() => resolveJungleMistConfig({ jungleMist: { color: 5 } }),
    /ambientEffects\.jungleMist\.color must be a color string/);
  assert.throws(() => resolveJungleMistConfig({ jungleMist: { drift: [1] } }),
    /ambientEffects\.jungleMist\.drift must be an \[across, along\] pair/);
});

test('disabling the layer or the effect compiles nothing', () => {
  assert.equal(resolveJungleMistConfig({ enabled: false }).enabled, false);
  assert.equal(resolveJungleMistConfig({ jungleMist: { enabled: false } }).enabled, false);
  // The node function returns null, so a material blending it in adds no nodes.
  assert.equal(build({ enabled: false }), null);
  // A zero quality share is the compile-time starve, as in the valley fog.
  assert.equal(build({}, { quality: 0 }), null);
});

test('the mist graph assembles from real three/tsl inputs', () => {
  const nodes = build();
  assert.ok(nodes, 'the enabled config should build nodes');
  assert.ok(nodes.color, 'the mist should carry a colour');
  assert.ok(nodes.amount, 'the mist should carry how much of it there is');
  // The blend a human adds: mix the shaded colour toward the mist by how much
  // mist covers the pixel. The base here stands in for terrain or foliage colour.
  const base = vec3(0.2, 0.35, 0.15);
  const material = new THREE.MeshStandardNodeMaterial();
  material.colorNode = base.mul(float(1).sub(nodes.amount)).add(nodes.color.mul(nodes.amount));
  assert.ok(material.colorNode, 'the blended colour should assemble');
  material.dispose();
});

test('it carries the lit tint and the fog tint through', () => {
  // The donor leans the mist toward the scene fog and lights it by the sun, the
  // sky fill and a little ambient; a build with and without them must both work.
  const withLight = build({}, {
    fogColor: vec3(0.7, 0.8, 0.85),
    sunColor: vec3(1, 0.95, 0.85),
    fill: float(0.3),
  });
  assert.ok(withLight?.color);
  // With neither, the mist falls back to its own colour lit by ambient alone.
  const bare = build();
  assert.ok(bare?.color);
});

test('a region weight of zero is a runtime skip, not a rebuild', () => {
  const nodes = build({}, { weight: uniform(0) });
  assert.ok(nodes?.amount);
  assert.ok(nodes?.color);
  // The shared uniforms are what the ambient system drives, and both start cold.
  assert.equal(jungleMistUniforms.weight.value, 0);
  assert.equal(jungleMistUniforms.ground.value, 0);
});

test('the closed-form integral matches the height falloff it stands for', () => {
  // A level ray sees the near-end density all the way: exp(-0)/1, times the reach.
  assert.equal(jungleMistIntegral({ start: 0, end: 0, scale: 6, reach: 50 }), 50);
  // A ray rising away from the ground runs through thinner air and gathers less.
  const rising = jungleMistIntegral({ start: 0, end: 60, scale: 6, reach: 50 });
  assert.ok(rising > 0 && rising < 50, `a rising ray should gather less than level, got ${rising}`);
  // A ray descending into the ground's denser air gathers more than a level ray
  // at the same starting height.
  const descending = jungleMistIntegral({ start: 6, end: 0, scale: 6, reach: 50 });
  const level = jungleMistIntegral({ start: 6, end: 6, scale: 6, reach: 50 });
  assert.ok(descending > level, `${descending} should outrun ${level}`);
  // Higher air, less mist, however it is reached.
  assert.ok(jungleMistIntegral({ start: 20, end: 20, scale: 6, reach: 50 })
    < jungleMistIntegral({ start: 2, end: 2, scale: 6, reach: 50 }));
  // Deterministic.
  assert.equal(
    jungleMistIntegral({ start: 3, end: 9, scale: 6, reach: 40 }),
    jungleMistIntegral({ start: 3, end: 9, scale: 6, reach: 40 }),
  );
});

test('the pocket banks split the sheet without emptying it', () => {
  // A still pocket gap and a thick bank bound the two ends; the middle is even.
  assert.ok(Math.abs(jungleMistBanks({ noise: 0, strength: 0.55 }) - 1) < 1e-9);
  assert.ok(Math.abs(jungleMistBanks({ noise: -1, strength: 0.55 }) - 0.45) < 1e-9);
  assert.ok(Math.abs(jungleMistBanks({ noise: 1, strength: 0.55 }) - 1.55) < 1e-9);
  // No pocket strength is an even sheet; the strongest empties a gap entirely.
  assert.equal(jungleMistBanks({ noise: 0.5, strength: 0 }), 1);
  assert.equal(jungleMistBanks({ noise: -1, strength: 1 }), 0);
  // The shipped default leaves some mist even in the thinnest pocket.
  assert.ok(jungleMistBanks({ noise: -1, strength: DEFAULT_JUNGLE_MIST.pocketStrength }) > 0);
});

test('the factor saturates to the ceiling and never takes the whole pixel', () => {
  assert.equal(jungleMistFactor({ opticalDepth: 0 }), 0);
  assert.ok(jungleMistFactor({ opticalDepth: 100 }) <= DEFAULT_JUNGLE_MIST.ceiling);
  // Monotonic in the optical depth, and clamped below 1 so the scene shows through.
  assert.ok(jungleMistFactor({ opticalDepth: 2 }) > jungleMistFactor({ opticalDepth: 1 }));
  assert.ok(jungleMistFactor({ opticalDepth: 100 }) < 1);
});
