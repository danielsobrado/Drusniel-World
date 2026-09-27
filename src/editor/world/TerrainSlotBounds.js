import * as THREE from 'three/webgpu';

/**
 * Culling bounds for terrain slots.
 *
 * Every slot draws the same flat chunk plane and displaces it by its height
 * texture in the vertex shader. Culled against that flat plane — a sphere a
 * chunk wide around y = 0 — a chunk several hundred metres up the Eldara
 * relief lies outside it, so looking toward the horizon from high ground
 * culled every chunk and only the sky showed where the ground should be.
 *
 * Each slot therefore gets its own geometry object that shares the plane's
 * buffers (no copy) but carries bounds fitted to the heights its page holds.
 * The plane lies in local XY and is displaced along local +Z (the mesh is
 * rotated −90° about X), so the height range is along local Z.
 */

/** A geometry sharing `source`'s index and attributes, with bounds of its own. */
export function createSlotGeometry(source) {
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(source.index);
  for (const [name, attribute] of Object.entries(source.attributes)) {
    geometry.setAttribute(name, attribute);
  }
  for (const group of source.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
  geometry.boundingBox = source.boundingBox?.clone() ?? null;
  geometry.boundingSphere = source.boundingSphere?.clone() ?? null;
  // Disposing a slot must not free the shared buffers.
  geometry.dispose = () => {};
  return geometry;
}

/** Fit a slot geometry's bounds to its page's vertex heights. */
export function fitSlotBounds(geometry, heights, chunkWorldSize) {
  let minimum = Infinity;
  let maximum = -Infinity;
  for (let index = 0; index < heights.length; index += 1) {
    const height = heights[index];
    if (height < minimum) minimum = height;
    if (height > maximum) maximum = height;
  }
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return;
  const half = chunkWorldSize * 0.5;
  // Headroom for anything the material adds on top of the height texture.
  const pad = 2;
  geometry.boundingBox = new THREE.Box3(
    new THREE.Vector3(-half, -half, minimum - pad),
    new THREE.Vector3(half, half, maximum + pad),
  );
  geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
}
