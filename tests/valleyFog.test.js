import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { float, uniform, vec3 } from 'three/tsl';
import {
  DEFAULT_VALLEY_FOG,
  resolveValleyFogConfig,
} from '../src/editor/stylized/mist/valleyFogConfig.js';
import { createValleyFogNodes } from '../src/editor/stylized/mist/ValleyFogShading.js';
import { LocalGroundHeight } from '../src/editor/stylized/ambient/LocalGroundHeight.js';

/** A 64² half-float patch, as the ambient system keeps around the focus. */
function groundPatch() {
  const ground = new LocalGroundHeight({ getHeight: () => 0 });
  ground.update({ x: 0, y: 0, z: 0 }, { x: 0, z: 0 });
  return ground;
}

/**
 * Build in Node, with real three/tsl inputs, so a TSL mistake fails here rather
 * than as an invisible field in a browser. `worldPosition` sits down the ray from
 * `cameraPosition`, as a shaded terrain fragment would.
 */
function build(overrides = {}, extra = {}) {
  return createValleyFogNodes({
    worldPosition: uniform(new THREE.Vector3(4, 20, 60)),
    cameraPosition: uniform(new THREE.Vector3(0, 18, 30)),
    heightSampler: groundPatch(),
    config: resolveValleyFogConfig(overrides),
    time: uniform(0),
    weight: uniform(1),
    quality: 1,
    ...extra,
  });
}

test('the shipped defaults resolve, and switching it off resolves to nothing', () => {
  // Absent config means the defaults, not no mist — a world that never mentions
  // it still gets gorge mist where the region weight says there are gorges.
  assert.deepEqual(resolveValleyFogConfig(undefined), DEFAULT_VALLEY_FOG);
  // Enabled false is the compile-time switch: the meter returns null and the
  // caller keeps the material it already had.
  assert.equal(resolveValleyFogConfig({ enabled: false }), null);
});

test('an out-of-range value fails loudly, naming the field', () => {
  // The ranges are the only thing keeping a typo out of a shader; an unnamed
  // failure would send a human hunting through the march for it.
  assert.throws(() => resolveValleyFogConfig({ steps: 99 }), /valleyFog\.steps/);
  assert.throws(() => resolveValleyFogConfig({ pocketStrength: 2 }), /valleyFog\.pocketStrength/);
  assert.throws(() => resolveValleyFogConfig({ scatter: 1 }), /valleyFog\.scatter/);
  assert.throws(() => resolveValleyFogConfig({ maxDistance: 0 }), /valleyFog\.maxDistance/);
  // nearClear must rise, and must fit inside the march distance.
  assert.throws(() => resolveValleyFogConfig({ nearClear: [12, 4] }), /valleyFog\.nearClear must rise/);
  assert.throws(() => resolveValleyFogConfig({ nearClear: [3, 80] }), /nearClear must end within/);
});

test('the node graph assembles against real three/tsl inputs', () => {
  const nodes = build();
  assert.ok(nodes, 'the enabled config should build nodes');
  assert.ok(nodes.color, 'the fog should carry a colour');
  assert.ok(nodes.amount, 'the fog should carry how much of it there is');
});

test('a height sampler given as a bare function also assembles', () => {
  // The wiring may hand in the bound `heightNode` rather than the patch object.
  const ground = groundPatch();
  const nodes = build({}, { heightSampler: (x, z) => ground.heightNode(x, z) });
  assert.ok(nodes?.amount);
});

test('it blends into a material colour node', () => {
  // The blend a human adds: mix the shaded colour toward the mist by how much
  // mist covers the pixel. The base here stands in for a terrain or sky colour.
  const nodes = build();
  const base = vec3(0.2, 0.35, 0.15);
  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = base.mul(float(1).sub(nodes.amount)).add(nodes.color.mul(nodes.amount));
  assert.ok(material.colorNode, 'the blended colour should assemble');
  material.dispose();
});

test('it can be switched off entirely, or starved of a height field', () => {
  // Compiling nothing is the point: a disabled config, a zero quality share or a
  // missing height sampler must all return null rather than a dead node graph.
  assert.equal(build({ enabled: false }), null);
  assert.equal(build({}, { quality: 0 }), null);
  assert.equal(createValleyFogNodes({
    config: resolveValleyFogConfig(undefined),
    time: uniform(0),
  }), null);
});

test('a region weight of zero is a runtime skip, not a rebuild', () => {
  // The region gate fades the mist out where there are no gorges without
  // recompiling; zero is the region weight, and the nodes still exist.
  const nodes = build({}, { weight: uniform(0) });
  assert.ok(nodes?.amount);
  assert.ok(nodes?.color);
});
