import * as THREE from 'three/webgpu';

/**
 * Meadow grass templates, ported from grass-test's `GrassGeometry.js`.
 *
 * One template per LOD band, shared by every tile: tile-local stems in a stable
 * low-discrepancy order (an R2 sequence), so *every prefix covers the tile* and a
 * lower band — which keeps the first N stems — keeps the same stems a nearer band
 * drew. That is what lets bands retire stems by rank without anything popping.
 *
 * Blades are built at unit width, profile-free; the vertex shader applies the
 * blade's own silhouette (see meadowGrassShapes.js), so one template draws every
 * shape.
 *
 * Instance layout (tile-local metres):
 *  - `instancePosition` vec4: x, ground height, z, grass strength (0..1). The
 *    template holds (x, 0, z, 1); compaction writes the ground and strength.
 *  - `instanceRotation` vec2: sin, cos of the blade's facing.
 *  - `instanceData` vec4: shape id (or atlas cell for cards), stable rank, wind
 *    phase, variation.
 */
const HASH_X = 127.1;
const HASH_Y = 311.7;
const HASH_SCALE = 43758.5453123;
const TWO_PI = Math.PI * 2;
/** The R2 sequence's two irrational steps. */
const R2_X = 0.7548776662466927;
const R2_Z = 0.5698402909980532;
export const ATLAS_VARIANTS = 4;

function fract(value) {
  return value - Math.floor(value);
}

export function hash2d(x, y) {
  return fract(Math.sin(x * HASH_X + y * HASH_Y) * HASH_SCALE);
}

function gradientNoise2d(x, y) {
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
  const localX = x - cellX;
  const localY = y - cellY;
  const fadeX = localX * localX * (3 - 2 * localX);
  const fadeY = localY * localY * (3 - 2 * localY);
  const dotAt = (ox, oy) => {
    const angle = fract(Math.sin((cellX + ox) * HASH_X + (cellY + oy) * HASH_Y) * 43758.5453) * TWO_PI;
    return Math.cos(angle) * (localX - ox) + Math.sin(angle) * (localY - oy);
  };
  const top = dotAt(0, 0) + (dotAt(1, 0) - dotAt(0, 0)) * fadeX;
  const bottom = dotAt(0, 1) + (dotAt(1, 1) - dotAt(0, 1)) * fadeX;
  return top + (bottom - top) * fadeY + 0.5;
}

/** A blade of `detail` segments sharing vertices: 2·detail − 1 triangles. */
function createBladeTemplate(detail) {
  const segments = Math.max(1, Math.round(detail));
  const positions = [];
  const uvs = [];
  const sides = [];
  const indices = [];
  for (let ring = 0; ring < segments; ring += 1) {
    const ratio = ring / segments;
    positions.push(-0.5, ratio, 0, 0.5, ratio, 0);
    uvs.push(0, ratio, 1, ratio);
    sides.push(-1, 1);
  }
  positions.push(0, 1, 0);
  uvs.push(0.5, 1);
  sides.push(0);
  for (let segment = 0; segment < segments - 1; segment += 1) {
    const vertex = segment * 2;
    indices.push(vertex, vertex + 1, vertex + 2, vertex + 1, vertex + 3, vertex + 2);
  }
  const last = (segments - 1) * 2;
  indices.push(last, last + 1, last + 2);
  return { positions, uvs, sides, indices };
}

/** A unit card standing on its base: the far clump. */
function createCardTemplate() {
  return {
    positions: [-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0],
    uvs: [0, 0, 1, 0, 0, 1, 1, 1],
    sides: [-1, 1, -1, 1],
    indices: [0, 1, 2, 2, 1, 3],
  };
}

/**
 * Stems for one tile, in stable order: stem i sits at the i-th point of the R2
 * sequence (with a hair of hash jitter so it is not a visible lattice).
 */
export function createStableInstances({ count, tileSize, cards = false }) {
  const position = new Float32Array(count * 4);
  const rotation = new Float32Array(count * 2);
  const data = new Float32Array(count * 4);
  for (let index = 0; index < count; index += 1) {
    const x = (fract(0.5 + (index + 1) * R2_X + (hash2d(index, 31) - 0.5) * 0.018) - 0.5) * tileSize;
    const z = (fract(0.5 + (index + 1) * R2_Z + (hash2d(index, 47) - 0.5) * 0.018) - 0.5) * tileSize;
    const angle = hash2d(index, 7) * TWO_PI;
    position.set([x, 0, z, 1], index * 4);
    rotation.set([Math.sin(angle), Math.cos(angle)], index * 2);
    data.set([
      cards ? Math.floor(hash2d(index, 11) * ATLAS_VARIANTS) : 0,
      index,
      gradientNoise2d(x * 0.2, z * 0.2) * TWO_PI,
      gradientNoise2d(x * (cards ? 0.1 : 0.3), z * (cards ? 0.1 : 0.3)),
    ], index * 4);
  }
  return { position, rotation, data, count };
}

/**
 * A band's template: the blade (or card) mesh plus the tile's stems as instance
 * attributes. `count` stems — the band's per-side count squared.
 *
 * @param {object} options
 * @param {number} options.detail blade segments (ignored for cards)
 * @param {number} options.count stems in one tile
 * @param {number} options.tileSize metres
 * @param {boolean} [options.cards]
 */
export function createMeadowTemplate({ detail, count, tileSize, cards = false }) {
  const mesh = cards ? createCardTemplate() : createBladeTemplate(detail);
  const instances = createStableInstances({ count, tileSize, cards });
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(mesh.uvs, 2));
  geometry.setAttribute('bladeSide', new THREE.Float32BufferAttribute(mesh.sides, 1));
  geometry.setIndex(mesh.indices);
  geometry.setAttribute('instancePosition', new THREE.InstancedBufferAttribute(instances.position, 4));
  geometry.setAttribute('instanceRotation', new THREE.InstancedBufferAttribute(instances.rotation, 2));
  geometry.setAttribute('instanceData', new THREE.InstancedBufferAttribute(instances.data, 4));
  geometry.instanceCount = count;
  geometry.userData.meadow = { detail, count, tileSize, cards, triangles: mesh.indices.length / 3 };
  return geometry;
}
