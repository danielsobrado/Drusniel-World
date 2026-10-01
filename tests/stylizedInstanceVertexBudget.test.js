import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { createInstancedRenderers, writeInstances } from '../src/editor/stylized/lod/StylizedLodRuntime.js';

/**
 * WebGPU guarantees only 8 vertex buffers per pipeline, and three's WebGPU backend spends
 * one per non-interleaved attribute plus one for the instance matrix. Going over does not
 * degrade gracefully — CreateRenderPipeline fails and the mesh disappears entirely, which
 * is easy to miss because the console error looks like a warning.
 *
 * A tree leaf is the worst case: it carries morphology and a leaf tint on top of the base
 * mesh attributes, so it is the part that pins the budget.
 */
const WEBGPU_MAX_VERTEX_BUFFERS = 8;

function sourcePart(kind) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(9), 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(6), 2));
  geometry.setIndex([0, 1, 2]);
  return { kind, geometry, material: new THREE.MeshLambertNodeMaterial() };
}

function vertexBufferCount(mesh) {
  // One buffer per attribute. The instance matrix is a storage binding now, not a
  // vertex buffer, but it is still counted so the budget keeps a slot in reserve.
  return Object.keys(mesh.geometry.attributes).length + 1;
}

test('tree leaf instancing stays inside the WebGPU vertex buffer budget', () => {
  const root = new THREE.Group();
  const renderers = createInstancedRenderers({
    root,
    partsByPrototype: [[sourcePart('leaf'), sourcePart('trunk')]],
    capacity: 4,
    name: 'budget',
    castShadow: true,
    tintLeaves: true,
  });

  for (const parts of renderers) {
    for (const mesh of parts) {
      const count = vertexBufferCount(mesh);
      assert.ok(
        count <= WEBGPU_MAX_VERTEX_BUFFERS,
        `${mesh.name} binds ${count} vertex buffers (limit ${WEBGPU_MAX_VERTEX_BUFFERS}): `
        + `${Object.keys(mesh.geometry.attributes).join(', ')} + instanceMatrix. `
        + 'Pack per-instance scalars into an existing vector attribute instead of adding one.',
      );
    }
  }
});

test('packed dither attribute carries fade, seed and colour variation', () => {
  const root = new THREE.Group();
  const renderers = createInstancedRenderers({
    root,
    partsByPrototype: [[sourcePart('leaf')]],
    capacity: 4,
    name: 'dither',
    castShadow: false,
    tintLeaves: true,
  });
  const mesh = renderers[0][0];

  // Colour variation is a multiplier, so unwritten instances must default to 1 rather
  // than zeroing the albedo of anything that is allocated but not yet populated.
  const initial = mesh.geometry.getAttribute('instanceDither');
  assert.equal(initial.array[2], 1);
  assert.equal(initial.array[5], 1);

  writeInstances([[mesh]], [[{
    matrix: new THREE.Matrix4(),
    fade: 0.5,
    ditherDirection: -1,
    seed: 0.25,
    colorVariation: 0.75,
    leafTint: [1, 1, 1],
    morphology: [1, 1, 1],
  }]]);

  const dither = mesh.geometry.getAttribute('instanceDither');
  assert.equal(dither.itemSize, 3);
  assert.equal(dither.array[0], -0.5, 'x carries the signed LOD fade');
  assert.equal(dither.array[1], 0.25, 'y carries the stable dither seed');
  assert.equal(dither.array[2], 0.75, 'z carries the colour variation');
});

test('instance matrices are a storage buffer, so a material rebuild cannot strand a write', () => {
  // Past the uniform limit three used to wrap the matrices in an interleaved vertex
  // buffer with one view per material build; a view built after a partial write took
  // the buffer as current, and the donor rocks kept their creation-time matrices.
  const root = new THREE.Group();
  const [[mesh]] = createInstancedRenderers({
    root,
    partsByPrototype: [[sourcePart('trunk')]],
    capacity: 2000,
    name: 'storage',
    castShadow: false,
  });
  assert.equal(mesh.instanceMatrix.isStorageInstancedBufferAttribute, true);
  assert.equal(mesh.instanceMatrix.count, 2000);
  assert.equal(mesh.instanceMatrix.itemSize, 16);

  const version = mesh.instanceMatrix.version;
  writeInstances([[mesh]], [[{
    matrix: new THREE.Matrix4().makeTranslation(-4189764.5, 21.2, 700110.3),
    fade: 1,
    seed: 0.5,
  }]]);
  assert.equal(mesh.count, 1);
  assert.ok(mesh.instanceMatrix.version > version, 'the write must bump the storage buffer');
  assert.deepEqual(mesh.instanceMatrix.updateRanges, [{ start: 0, count: 16 }]);
  const written = new THREE.Matrix4();
  mesh.getMatrixAt(0, written);
  assert.equal(written.elements[12], Math.fround(-4189764.5));
});

test('instances are written relative to the anchor, exact at planet scale', async () => {
  const { InstanceAnchor } = await import('../src/editor/stylized/lod/InstanceAnchor.js');
  const root = new THREE.Group();
  const [[mesh]] = createInstancedRenderers({
    root,
    partsByPrototype: [[sourcePart('trunk')]],
    capacity: 8,
    name: 'anchor',
    castShadow: false,
  });
  // A pebble on Eldara: float32 steps by 0.25 m at x = −4 188 269.
  const pebble = { x: -4188269.4079, z: 701997.9749 };
  const instance = () => ({
    matrix: new THREE.Matrix4().makeTranslation(pebble.x, 22.2, pebble.z),
    fade: 1,
    seed: 0.5,
  });
  const origin = { x: -4188200, z: 702030 };
  const anchor = new InstanceAnchor().follow(origin);
  writeInstances([[mesh]], [[instance()]], anchor);
  anchor.place(root, origin);
  const stored = new THREE.Matrix4();
  mesh.getMatrixAt(0, stored);
  // Stored relative to the anchor, to a hundredth of a millimetre...
  assert.ok(Math.abs(stored.elements[12] - (pebble.x - origin.x)) < 1e-5);
  assert.ok(Math.abs(stored.elements[14] - (pebble.z - origin.z)) < 1e-5);
  // ...and the root puts it back where it belongs in render space.
  assert.ok(Math.abs(stored.elements[12] + root.position.x - (pebble.x - origin.x)) < 1e-5);

  // The same instance again uploads nothing: compared as float32, not float64.
  mesh.instanceMatrix.clearUpdateRanges();
  const version = mesh.instanceMatrix.version;
  writeInstances([[mesh]], [[instance()]], anchor);
  assert.equal(mesh.instanceMatrix.version, version);

  // A small drift of the origin keeps the anchor; a far one moves it.
  assert.equal(anchor.follow({ x: origin.x + 500, z: origin.z }).x, origin.x);
  assert.equal(anchor.follow({ x: origin.x + 5000, z: origin.z }).x, origin.x + 5000);
});
