import * as THREE from 'three/webgpu';

/**
 * One draw per LOD band, ported from grass-test's `GrassBatches`.
 *
 * Every in-range tile of a band is drawn by that band's batch. Stem positions
 * stay tile-local and each instance carries its tile's render-space origin
 * (`instanceTile`), which the material adds only where a position becomes
 * world space — so per-stem hashes see exactly the inputs they would per tile.
 *
 * Each tile owns a fixed slot sized to its band's uncompacted stem count, so a
 * tile entering, leaving or recompacting rewrites and uploads only its own slot.
 * (The donor measured repacking the whole batch on every membership change at
 * tens of MiB a frame at fly speed.) Unused instances in a slot sit far outside
 * the grass range, where the shader's visibility test collapses them.
 *
 * Membership is every in-range tile, visible or not, so a camera turn never
 * touches a batch; blades behind the camera are culled by the clipper.
 */
const INSTANCE_ATTRIBUTES = Object.freeze([['instancePosition', 4], ['instanceRotation', 2], ['instanceData', 4]]);
const MIN_SLOTS = 16;
export const EMPTY_POSITION = 1e7;

class MeadowBandBatch {
  constructor({ scene, template, material, name, renderOrder = 0 }) {
    this.scene = scene;
    this.template = template;
    this.stride = Math.max(1, template.instanceCount);
    this.slots = new Map();
    this.free = [];
    this.used = 0;
    this.present = new Set();
    this.geometry = this.createGeometry(MIN_SLOTS);
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.name = name;
    this.mesh.renderOrder = renderOrder;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  // Growing builds a new geometry: the WebGPU renderer caches a geometry's
  // attribute bindings, so attributes replaced in place kept drawing from the old,
  // smaller buffers.
  createGeometry(slotCapacity) {
    this.slotCapacity = slotCapacity;
    const capacity = slotCapacity * this.stride;
    const geometry = new THREE.InstancedBufferGeometry();
    for (const name of ['position', 'uv', 'bladeSide']) geometry.setAttribute(name, this.template.getAttribute(name));
    geometry.index = this.template.index;
    geometry.instanceCount = 0;
    for (const [name, itemSize] of INSTANCE_ATTRIBUTES) {
      geometry.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(capacity * itemSize), itemSize));
    }
    geometry.setAttribute('instanceTile', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2));
    return geometry;
  }

  grow() {
    const previous = this.geometry;
    this.geometry = this.createGeometry(this.slotCapacity * 2);
    for (const name of [...INSTANCE_ATTRIBUTES.map(([key]) => key), 'instanceTile']) {
      const attribute = this.geometry.getAttribute(name);
      attribute.array.set(previous.getAttribute(name).array);
      attribute.needsUpdate = true;
    }
    this.geometry.instanceCount = previous.instanceCount;
    this.mesh.geometry = this.geometry;
    previous.dispose();
  }

  markRange(start, count) {
    for (const [name, itemSize] of [...INSTANCE_ATTRIBUTES, ['instanceTile', 2]]) {
      const attribute = this.geometry.getAttribute(name);
      attribute.addUpdateRange(start * itemSize, count * itemSize);
      attribute.needsUpdate = true;
    }
  }

  clearUpdateRanges() {
    for (const [name] of [...INSTANCE_ATTRIBUTES, ['instanceTile', 2]]) this.geometry.getAttribute(name).clearUpdateRanges();
  }

  writeSlot(index, tile) {
    const start = index * this.stride;
    const source = tile?.output ?? null;
    const count = source ? Math.min(source.count, this.stride) : 0;
    const position = this.geometry.getAttribute('instancePosition').array;
    if (count > 0) {
      position.set(source.position.subarray(0, count * 4), start * 4);
      this.geometry.getAttribute('instanceRotation').array.set(source.rotation.subarray(0, count * 2), start * 2);
      this.geometry.getAttribute('instanceData').array.set(source.data.subarray(0, count * 4), start * 4);
      const origins = this.geometry.getAttribute('instanceTile').array;
      for (let i = start; i < start + count; i += 1) {
        origins[i * 2] = tile.renderX;
        origins[i * 2 + 1] = tile.renderZ;
      }
    }
    for (let i = start + count; i < start + this.stride; i += 1) {
      position[i * 4] = EMPTY_POSITION;
      position[i * 4 + 1] = 0;
      position[i * 4 + 2] = EMPTY_POSITION;
      position[i * 4 + 3] = 0;
    }
    this.markRange(start, this.stride);
  }

  /** `tiles` share this band and carry finished compactions. Returns stems drawn. */
  update(tiles) {
    let dirty = false;
    const present = this.present;
    present.clear();
    for (const tile of tiles) present.add(tile);
    for (const [tile, slot] of this.slots) {
      if (present.has(tile)) continue;
      if (!dirty) { this.clearUpdateRanges(); dirty = true; }
      this.writeSlot(slot.index, null);
      this.free.push(slot.index);
      this.slots.delete(tile);
    }
    for (const tile of tiles) {
      const key = `${tile.buildId}:${tile.renderX}:${tile.renderZ}`;
      let slot = this.slots.get(tile);
      if (slot?.key === key) continue;
      if (!slot) {
        // Lowest free slot first keeps the drawn range short.
        let index;
        if (this.free.length) {
          this.free.sort((a, b) => a - b);
          index = this.free.shift();
        } else {
          if (this.used === this.slotCapacity) this.grow();
          index = this.used;
          this.used += 1;
        }
        slot = { index, key };
        this.slots.set(tile, slot);
      }
      slot.key = key;
      if (!dirty) { this.clearUpdateRanges(); dirty = true; }
      this.writeSlot(slot.index, tile);
    }
    if (dirty) {
      // Trailing free slots stop being drawn.
      this.free.sort((a, b) => a - b);
      while (this.used > 0 && this.free[this.free.length - 1] === this.used - 1) {
        this.free.pop();
        this.used -= 1;
      }
      this.geometry.instanceCount = this.used * this.stride;
    }
    this.mesh.visible = this.slots.size > 0;
    let stems = 0;
    for (const tile of tiles) stems += Math.min(tile.output.count, this.stride);
    return stems;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.geometry.dispose();
  }
}

/** The batches for every band of one template family. */
export class MeadowGrassBatches {
  /**
   * @param {object} options
   * @param {THREE.Object3D} options.scene
   * @param {Record<string, THREE.InstancedBufferGeometry>} options.templates band → template
   * @param {THREE.Material} options.material
   * @param {string} options.name
   * @param {number} [options.renderOrder]
   */
  constructor({ scene, templates, material, name, renderOrder = 0 }) {
    this.batches = new Map();
    this.members = new Map();
    for (const [band, template] of Object.entries(templates)) {
      this.batches.set(band, new MeadowBandBatch({ scene, template, material, name: `${name}-${band}`, renderOrder }));
      this.members.set(band, []);
    }
  }

  begin() {
    for (const list of this.members.values()) list.length = 0;
  }

  add(band, tile) {
    this.members.get(band)?.push(tile);
  }

  /** @returns {Record<string, number>} stems drawn per band */
  commit() {
    const stems = {};
    for (const [band, batch] of this.batches) stems[band] = batch.update(this.members.get(band));
    return stems;
  }

  get meshes() {
    return [...this.batches.values()].map((batch) => batch.mesh);
  }

  dispose() {
    for (const batch of this.batches.values()) batch.dispose();
    this.batches.clear();
    this.members.clear();
  }
}
