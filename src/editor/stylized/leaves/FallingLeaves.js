import * as THREE from 'three/webgpu';

import { createFallingLeavesMaterial, createFallingLeavesUniforms } from './fallingLeavesMaterial.js';
import { sampleTilesAround, tileShare } from '../../world/sampleTilesAround.js';

export const DEFAULT_FALLING_LEAVES = Object.freeze({
  enabled: true,
  count: 400,
  /** Side of the square box around the camera leaves fall through, metres. */
  boxSize: 36,
  boxHeight: 14,
  size: 0.09,
  fallSpeed: 0.9,
  /** Biomes whose canopy sheds: temperate deciduous forest and temperate rainforest. */
  tileIds: [6, 8],
  /** Autumn tones, linear RGB: gold, rust, brown. */
  palette: [[0.78, 0.5, 0.08], [0.62, 0.2, 0.04], [0.3, 0.16, 0.06]],
});

/** Rings of ground samples, metres, for how much shedding canopy is around. */
const SAMPLE_RINGS = [0, 12, 28];
const SAMPLE_DIRECTIONS = 6;
const RESAMPLE_SECONDS = 0.5;

/** A mesh of `count` unit quads, each carrying its corner and a random seed. */
export function createLeafGeometry(count, random = Math.random) {
  const corners = new Float32Array(count * 4 * 2);
  const seeds = new Float32Array(count * 4 * 4);
  const uvs = new Float32Array(count * 4 * 2);
  const positions = new Float32Array(count * 4 * 3);
  const indices = new Uint32Array(count * 6);
  const quad = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  for (let leaf = 0; leaf < count; leaf += 1) {
    // Seeds spread evenly in w, so `amount` switches leaves on in a fixed order.
    const seed = [random(), random(), random(), (leaf + random()) / count];
    for (let vertex = 0; vertex < 4; vertex += 1) {
      const index = leaf * 4 + vertex;
      corners.set(quad[vertex], index * 2);
      uvs.set([quad[vertex][0] + 0.5, quad[vertex][1] + 0.5], index * 2);
      seeds.set(seed, index * 4);
    }
    indices.set([0, 1, 2, 0, 2, 3].map((v) => leaf * 4 + v), leaf * 6);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute('leafCorner', new THREE.BufferAttribute(corners, 2));
  geometry.setAttribute('leafSeed', new THREE.BufferAttribute(seeds, 4));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}

/** Share of samples on shedding biomes, 0..1. */
export function sheddingCanopyShare(tiles, tileIds) {
  return tileShare(tiles, tileIds);
}

/**
 * Leaves drifting down around the camera in deciduous woods (after
 * grass-test's LeafSystem, but animated wholly on the GPU). How many fall
 * follows the share of shedding canopy nearby, eased so walking out of a wood
 * thins them rather than cutting them off.
 */
export class FallingLeaves {
  constructor({ scene, config = {}, getTile, getTileSize, getOrigin }) {
    this.config = { ...DEFAULT_FALLING_LEAVES, ...config };
    this.getTile = getTile;
    this.getTileSize = getTileSize;
    this.getOrigin = getOrigin;
    this.target = 0;
    this.sinceSample = Infinity;
    this.uniforms = createFallingLeavesUniforms(this.config);
    this.geometry = createLeafGeometry(this.config.count);
    this.material = createFallingLeavesMaterial(this.uniforms, this.config);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'stylized-falling-leaves';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  sampleCanopy(camera) {
    const origin = this.getOrigin();
    const tiles = sampleTilesAround({
      getTile: this.getTile,
      tileSize: this.getTileSize(),
      x: camera.position.x + origin.x,
      z: camera.position.z + origin.z,
      rings: SAMPLE_RINGS,
      directions: SAMPLE_DIRECTIONS,
    });
    return sheddingCanopyShare(tiles, this.config.tileIds);
  }

  /**
   * @param {number} seconds frame time
   * @param {number} dt seconds since the last frame
   * @param {import('three').Camera} camera
   * @param {{ x: number, z: number }} wind weather wind, m/s-ish
   * @param {boolean} [onFoot] leaves fall around a walker, not an orbit camera
   */
  update(seconds, dt, camera, wind, onFoot = true) {
    if (!this.config.enabled) return;
    this.sinceSample += dt;
    if (!onFoot) {
      this.target = 0;
    } else if (this.sinceSample >= RESAMPLE_SECONDS) {
      this.sinceSample = 0;
      this.target = this.sampleCanopy(camera);
    }
    const amount = this.uniforms.amount;
    amount.value += (this.target - amount.value) * Math.min(1, dt * 0.8);
    this.mesh.visible = amount.value > 0.01;
    if (!this.mesh.visible) return;
    this.uniforms.time.value = seconds;
    this.uniforms.center.value.copy(camera.position);
    this.uniforms.wind.value.set(wind?.x ?? 0, wind?.z ?? 0);
  }

  dispose() {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
