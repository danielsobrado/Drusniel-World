import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { float, normalWorld, positionWorld, uniform, vec3 } from 'three/tsl';
import {
  DEFAULT_FROST,
  createFrostShading,
  frostMask,
  resolveFrost,
} from '../src/editor/stylized/ambient/FrostShading.js';

test('the defaults resolve from an empty ambient block', () => {
  const settings = resolveFrost();
  assert.equal(settings.enabled, true);
  assert.equal(settings.strength, DEFAULT_FROST.strength);
  assert.equal(settings.roughness, DEFAULT_FROST.roughness);
  assert.equal(settings.color, DEFAULT_FROST.color);
  assert.deepEqual(settings.facing, [...DEFAULT_FROST.facing]);
});

test('it reads the ambient layer\'s own frost key', () => {
  // config/ambient-effects.yaml already carries `frost`; the resolved block keeps
  // enabled and strength there, and the shape keys fall back to the defaults.
  const settings = resolveFrost({ enabled: true, frost: { enabled: true, strength: 0.55 } });
  assert.equal(settings.enabled, true);
  assert.equal(settings.strength, 0.55);
  assert.equal(settings.coverage, DEFAULT_FROST.coverage);
  // A different strength is taken, not ignored.
  assert.equal(resolveFrost({ frost: { strength: 0.9 } }).strength, 0.9);
});

test('a bad setting fails loudly, naming its path', () => {
  assert.throws(() => resolveFrost({ frost: { strength: 2 } }),
    /ambientEffects\.frost\.strength must be within \[0, 1\]/);
  assert.throws(() => resolveFrost({ frost: { roughness: -0.5 } }),
    /ambientEffects\.frost\.roughness must be within \[0, 1\]/);
  assert.throws(() => resolveFrost({ frost: { coverage: 1.5 } }),
    /ambientEffects\.frost\.coverage must be within \[0, 1\]/);
  assert.throws(() => resolveFrost({ frost: { facing: [0.9, 0.4] } }),
    /ambientEffects\.frost\.facing must be two numbers in \[0, 1\]/);
});

test('disabling the layer or the effect compiles nothing', () => {
  assert.equal(resolveFrost({ enabled: false }).enabled, false);
  assert.equal(resolveFrost({ frost: { enabled: false } }).enabled, false);
  // A zero strength is the effect off in every sense that matters.
  assert.equal(resolveFrost({ frost: { strength: 0 } }).enabled, false);
  // The node function returns null, so a material blending it in adds no nodes.
  assert.equal(createFrostShading({
    normal: normalWorld,
    worldXZ: positionWorld.xz,
    settings: resolveFrost({ frost: { enabled: false } }),
  }), null);
});

test('the frost graph assembles from real three/tsl inputs', () => {
  // Built in Node so a TSL mistake fails here rather than as black or untouched
  // ground in a browser. The cold weight is passed as a node, the way the terrain
  // material hands it its own baked snow.
  const settings = resolveFrost({ frost: { strength: 0.55 } });
  const nodes = createFrostShading({
    normal: normalWorld,
    worldXZ: positionWorld.xz,
    cold: uniform(1),
    settings,
  });
  assert.ok(nodes, 'an enabled frost should build a blend');
  assert.ok(nodes.mask, 'the blend should expose its mask');
  const material = new THREE.MeshStandardNodeMaterial();
  material.colorNode = nodes.applyColor(vec3(0.4, 0.4, 0.42));
  material.roughnessNode = nodes.applyRoughness(float(0.7));
  assert.ok(material.colorNode);
  assert.ok(material.roughnessNode);
  material.dispose();
});

test('the frost mask follows facing and the cold weight', () => {
  // Down-facing and side faces stay bare; only what points at the sky rimes. That
  // is what makes it read as deposition rather than as a white wash.
  assert.equal(frostMask({ facing: 0, cold: 1 }), 0);
  assert.equal(frostMask({ facing: -1, cold: 1 }), 0);
  // A cold up face rimes fully.
  assert.equal(frostMask({ facing: 1, cold: 1 }), 1);
  // No cold, no rime, however it faces.
  assert.equal(frostMask({ facing: 1, cold: 0 }), 0);
  // Monotonic in the cold weight.
  assert.ok(frostMask({ facing: 1, cold: 0.8 }) > frostMask({ facing: 1, cold: 0.4 }));
  // A partly up-turned face takes a partial cover.
  const sloped = frostMask({ facing: 0.6, cold: 1 });
  assert.ok(sloped > 0 && sloped < 1, `a slope should be partial, got ${sloped}`);
  // The coverage noise thins the rime but cannot exceed the cold weight.
  assert.ok(frostMask({ facing: 1, cold: 0.5, patch: 0.5 }) < frostMask({ facing: 1, cold: 0.5 }));
  assert.equal(frostMask({ facing: 1, cold: 0.5, patch: 1 }), 0.5);
});

test('the frost is weaker than full white, so it reads as rime not as snow', () => {
  // The shipped strength is deliberately below 1: a face turned fully to the sky
  // in full cold still blends toward the rime colour rather than snapping to it.
  const settings = resolveFrost();
  assert.ok(settings.strength > 0 && settings.strength < 1);
  assert.ok(settings.roughness > 0.5, 'rime is matte');
});
