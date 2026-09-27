import * as THREE from 'three/webgpu';

import { createSnowPowderMaterial, createSnowPowderUniforms } from './snowPowderMaterial.js';

export const DEFAULT_SNOW_POWDER = Object.freeze({
  enabled: true,
  /** Footfalls in flight at once; the oldest is reused. */
  slots: 12,
  puffsPerKick: 9,
  lifetime: 1.1,
  /** Largest puff radius, metres. */
  size: 0.32,
  opacity: 0.3,
  /** Running speed (m/s) at which a kick reaches full strength. */
  fullStrengthSpeed: 7,
});

/** Quads for every puff of every slot: its corner, its slot and a seed. */
export function createPowderGeometry(slots, puffsPerKick, random = Math.random) {
  const count = slots * puffsPerKick;
  const positions = new Float32Array(count * 4 * 3);
  const corners = new Float32Array(count * 4 * 2);
  const uvs = new Float32Array(count * 4 * 2);
  const slotIds = new Float32Array(count * 4);
  const seeds = new Float32Array(count * 4 * 4);
  const indices = new Uint32Array(count * 6);
  const quad = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let puff = 0; puff < count; puff += 1) {
    const seed = [random(), random(), random(), random()];
    const slot = Math.floor(puff / puffsPerKick);
    for (let vertex = 0; vertex < 4; vertex += 1) {
      const index = puff * 4 + vertex;
      corners.set(quad[vertex], index * 2);
      uvs.set([(quad[vertex][0] + 1) / 2, (quad[vertex][1] + 1) / 2], index * 2);
      slotIds[index] = slot;
      seeds.set(seed, index * 4);
    }
    indices.set([0, 1, 2, 0, 2, 3].map((v) => puff * 4 + v), puff * 6);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute('powderCorner', new THREE.BufferAttribute(corners, 2));
  geometry.setAttribute('powderSlot', new THREE.BufferAttribute(slotIds, 1));
  geometry.setAttribute('powderSeed', new THREE.BufferAttribute(seeds, 4));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}

/**
 * Powder kicked up by footfalls in snow (after grass-test's SnowPowderSystem,
 * footfall kicks only). A kick writes one slot's uniforms; the puffs animate
 * on the GPU and age out on their own, so an idle walker costs nothing but a
 * draw of collapsed quads, and the mesh hides once the last kick has settled.
 */
export class SnowPowderKicks {
  constructor({ scene, config = {} }) {
    this.config = { ...DEFAULT_SNOW_POWDER, ...config };
    this.uniforms = createSnowPowderUniforms(this.config.slots);
    this.geometry = createPowderGeometry(this.config.slots, this.config.puffsPerKick);
    this.material = createSnowPowderMaterial(this.uniforms, this.config);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'stylized-snow-powder';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 30;
    this.mesh.visible = false;
    this.next = 0;
    this.seconds = 0;
    this.lastKickAt = -Infinity;
    scene.add(this.mesh);
  }

  /**
   * @param {{ x: number, y: number, z: number, facing?: number, speed?: number }} footfall
   *   render space; `(sin facing, cos facing)` is forward, so facing 0 looks down
   *   +z, as the character does (CharacterMotionState.facing)
   * @param {number} [depth] 0..1 how deep the snow is
   */
  kick(footfall, depth = 1) {
    if (!this.config.enabled) return;
    const facing = footfall.facing ?? 0;
    const strength = Math.min(1.4, (0.35 + (footfall.speed ?? 0) / this.config.fullStrengthSpeed) * depth);
    const slot = this.next;
    this.next = (this.next + 1) % this.config.slots;
    this.uniforms.kicks.array[slot].set(footfall.x, footfall.y + 0.05, footfall.z, this.seconds);
    this.uniforms.motions.array[slot].set(Math.sin(facing), Math.cos(facing), strength, Math.random());
    this.lastKickAt = this.seconds;
    this.mesh.visible = true;
  }

  /** Move kicks in flight with the floating origin, so they do not jump. */
  shiftWorld(shiftX, shiftZ) {
    for (const kick of this.uniforms.kicks.array) {
      kick.x -= shiftX;
      kick.z -= shiftZ;
    }
  }

  update(seconds) {
    this.seconds = seconds;
    this.uniforms.time.value = seconds;
    if (this.mesh.visible && seconds - this.lastKickAt > this.config.lifetime * 1.3) {
      this.mesh.visible = false;
    }
  }

  dispose() {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
