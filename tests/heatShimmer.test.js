import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { mix, normalize, positionLocal, uniform, vec3 } from 'three/tsl';
import {
  DEFAULT_HEAT_SHIMMER,
  createHeatShimmerNodes,
  heatShimmerHot,
  heatShimmerRipple,
  heatShimmerUniforms,
  resolveHeatShimmerConfig,
} from '../src/editor/stylized/ambient/HeatShimmer.js';

test('the defaults resolve from an empty ambient block', () => {
  // A world that never mentions the shimmer still gets the nodes, because the
  // effect is a sky term that only costs anything where the region is hot.
  const settings = resolveHeatShimmerConfig();
  assert.equal(settings.enabled, true);
  assert.equal(settings.strength, DEFAULT_HEAT_SHIMMER.strength);
  assert.equal(settings.presetDefault, 0, 'the donor ships a zero preset default');
  assert.equal(settings.amplitude, DEFAULT_HEAT_SHIMMER.amplitude);
  assert.deepEqual(settings.band, [...DEFAULT_HEAT_SHIMMER.band]);
  assert.deepEqual(settings.ripple, { ...DEFAULT_HEAT_SHIMMER.ripple });
  assert.equal(settings.rise, DEFAULT_HEAT_SHIMMER.rise);
  // The hot air sits low: the band's floor is below its ceiling.
  assert.ok(settings.band[1] > settings.band[0]);
});

test('it reads the ambient layer\'s own heatShimmer key', () => {
  // config/ambient-effects.yaml carries the effect as `heatShimmer`; the resolved
  // block keeps enabled, strength and presets there, and the shape keys fill in
  // from the defaults, so nothing has to be added to the YAML for the nodes.
  const settings = resolveHeatShimmerConfig({
    enabled: true,
    heatShimmer: {
      strength: 1,
      presets: { sunny: 1, calm: 1, windy: 0.4 },
      amplitude: 0.01,
      band: [0.05, 0.3],
      ripple: { across: 30 },
    },
  });
  assert.equal(settings.enabled, true);
  assert.equal(settings.presets.sunny, 1);
  assert.equal(settings.presets.windy, 0.4);
  assert.equal(settings.amplitude, 0.01);
  assert.deepEqual(settings.band, [0.05, 0.3]);
  assert.equal(settings.ripple.across, 30);
  assert.equal(settings.ripple.along, DEFAULT_HEAT_SHIMMER.ripple.along);
});

test('a bad setting fails loudly, naming its path', () => {
  assert.throws(() => resolveHeatShimmerConfig({ heatShimmer: { strength: 5 } }),
    /ambientEffects\.heatShimmer\.strength must be within \[0, 4\]/);
  assert.throws(() => resolveHeatShimmerConfig({ heatShimmer: { amplitude: -1 } }),
    /ambientEffects\.heatShimmer\.amplitude must be within \[0, 0\.2\]/);
  assert.throws(() => resolveHeatShimmerConfig({ heatShimmer: { rise: 99 } }),
    /ambientEffects\.heatShimmer\.rise must be within \[0, 20\]/);
  assert.throws(() => resolveHeatShimmerConfig({ heatShimmer: { ripple: { across: 0 } } }),
    /ambientEffects\.heatShimmer\.ripple\.across must be positive/);
  assert.throws(() => resolveHeatShimmerConfig({ heatShimmer: { ripple: 3 } }),
    /ambientEffects\.heatShimmer\.ripple must be an object/);
  assert.throws(() => resolveHeatShimmerConfig({ heatShimmer: { band: [0.4, 0.2] } }),
    /ambientEffects\.heatShimmer\.band must be two numbers in \[0, 1\]/);
  assert.throws(() => resolveHeatShimmerConfig({ heatShimmer: { presets: { sunny: 9 } } }),
    /ambientEffects\.heatShimmer\.presets\.sunny must be within \[0, 4\]/);
});

test('disabling the layer, the effect or its strength compiles nothing', () => {
  assert.equal(resolveHeatShimmerConfig({ enabled: false }).enabled, false);
  assert.equal(resolveHeatShimmerConfig({ heatShimmer: { enabled: false } }).enabled, false);
  // A zero strength is the effect off in every sense that matters.
  assert.equal(resolveHeatShimmerConfig({ heatShimmer: { strength: 0 } }).enabled, false);
  // The node function returns null, so the dome material adds no nodes at all.
  assert.equal(createHeatShimmerNodes({
    direction: normalize(positionLocal),
    settings: resolveHeatShimmerConfig({ heatShimmer: { enabled: false } }),
  }), null);
  // A zero quality share is the compile-time starve, like the valley fog.
  assert.equal(createHeatShimmerNodes({
    direction: normalize(positionLocal),
    settings: resolveHeatShimmerConfig(),
    quality: 0,
  }), null);
});

test('the shimmer graph assembles from real three/tsl inputs', () => {
  // Built in Node so a TSL mistake fails here rather than as a still horizon in
  // a browser. The direction is the dome's own ray, as StylizedSkyView computes it.
  const settings = resolveHeatShimmerConfig();
  const direction = normalize(positionLocal);
  const nodes = createHeatShimmerNodes({
    direction,
    weight: uniform(1),
    temperature: uniform(1),
    time: uniform(0),
    quality: 1,
    settings,
  });
  assert.ok(nodes, 'an enabled shimmer should build nodes');
  assert.ok(nodes.direction, 'the shimmer should return a warped direction');
  assert.ok(nodes.offset, 'the shimmer should expose its raw displacement');
  assert.ok(nodes.amount, 'the shimmer should expose how strong it is');
  // The blend a human adds: shade the dome from the warped ray.
  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
  material.colorNode = mix(vec3(0.6, 0.75, 0.95), vec3(0.9, 0.85, 0.7), nodes.direction.y.smoothstep(0, 0.3));
  assert.ok(material.colorNode);
  material.dispose();
});

test('a zero region weight is a runtime skip, not a rebuild', () => {
  // The region gate fades the shimmer out where the ground is not hot without
  // recompiling; zero is the region weight, and the nodes still exist.
  const nodes = createHeatShimmerNodes({
    direction: normalize(positionLocal),
    weight: uniform(0),
    settings: resolveHeatShimmerConfig(),
  });
  assert.ok(nodes?.direction);
  assert.ok(nodes?.amount);
  // The shared uniforms are what the ambient system drives.
  assert.equal(heatShimmerUniforms.hot.value, 0);
});

test('heatShimmerRipple is bounded, deterministic and rises with the clock', () => {
  const settings = resolveHeatShimmerConfig();
  // Bounded: the shape alone, amplitude applied by the node.
  for (const across of [-1, -0.3, 0, 0.5, 1]) {
    for (const along of [-0.2, 0, 0.1, 0.4]) {
      const { x, y } = heatShimmerRipple({ across, along, time: 3.7, settings });
      assert.ok(Math.abs(x) <= 0.35 + 1e-9, `x ${x} within the donor's 0.35 weight`);
      assert.ok(Math.abs(y) <= 1 + 1e-9, `y ${y} within a sine`);
    }
  }
  // Deterministic, so the shape is a function of the ray and the clock alone.
  assert.deepEqual(
    heatShimmerRipple({ across: 0.2, along: 0.1, time: 2, settings }),
    heatShimmerRipple({ across: 0.2, along: 0.1, time: 2, settings }),
  );
  // It climbs: the pattern at one instant is not the pattern a moment later.
  const now = heatShimmerRipple({ across: 0.2, along: 0.1, time: 2, settings });
  const later = heatShimmerRipple({ across: 0.2, along: 0.1, time: 2.05, settings });
  assert.notDeepEqual(now, later);
  // With no rise it freezes, which is what proves the clock is the only motion.
  const frozen = { ...DEFAULT_HEAT_SHIMMER, rise: 0 };
  assert.deepEqual(
    heatShimmerRipple({ across: 0.2, along: 0.1, time: 0, settings: frozen }),
    heatShimmerRipple({ across: 0.2, along: 0.1, time: 100, settings: frozen }),
  );
  // And it is continuous — a small step is a small move, so it cannot boil.
  const step = heatShimmerRipple({ across: 0.1, along: 0.1, time: 1, settings });
  const tiny = heatShimmerRipple({ across: 0.1, along: 0.1, time: 1 + 1e-4, settings });
  assert.ok(Math.abs(tiny.x - step.x) < 1e-2 && Math.abs(tiny.y - step.y) < 1e-2);
});

test('the hot-air gate pools low and follows the region heat', () => {
  const band = DEFAULT_HEAT_SHIMMER.band;
  // At and below the floor the air is fully hot; at the ceiling it has cooled out.
  assert.equal(heatShimmerHot({ elevation: 0, band }), 1);
  assert.equal(heatShimmerHot({ elevation: band[1], band }), 0);
  assert.equal(heatShimmerHot({ elevation: 0.8, band }), 0);
  // Monotonic: hotter low, cooler high.
  assert.ok(heatShimmerHot({ elevation: 0.08, band }) > heatShimmerHot({ elevation: 0.16, band }));
  // No hot region, or a cold hour, means no shimmer however low the ray is.
  assert.equal(heatShimmerHot({ elevation: 0, band, weight: 0 }), 0);
  assert.equal(heatShimmerHot({ elevation: 0, band, temperature: 0 }), 0);
  assert.ok(Math.abs(heatShimmerHot({ elevation: 0, band, weight: 0.4, temperature: 0.5 }) - 0.2) < 1e-12);
  // A custom band is honoured.
  assert.equal(heatShimmerHot({ elevation: 0.5, band: [0, 0.5] }), 0);
  assert.equal(heatShimmerHot({ elevation: 0.0, band: [0, 0.5] }), 1);
});
