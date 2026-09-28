import * as THREE from 'three/webgpu';

/**
 * A terrain chunk's occluder for the GPU occlusion pass (render/occlusion).
 *
 * The drawn terrain is a flat grid displaced by its height texture in the vertex
 * shader, so its own geometry is flat and cannot stand in for the hills in a
 * depth-only pass. This is the same surface at a coarse step, built on the CPU
 * from the page's vertex heights: a hill hides what is behind it at any step,
 * and a coarse proxy is cheap to draw into a half-resolution depth target.
 *
 * Positions are in world axes around the chunk centre (x east, y up, z the
 * canonical z), so the proxy only needs the slot's position, not the drawn
 * plane's rotation — `occlusionUpright`. The surface is lowered by `sink` metres
 * so the proxy never pokes above the real ground and hides things resting on it.
 *
 * @param {object} options
 * @param {ArrayLike<number>} options.heights (chunkSize + 1)² vertex heights
 * @param {number} options.chunkSize cells per side
 * @param {number} options.tileSize metres per cell
 * @param {number} [options.step] cells between proxy vertices
 * @param {number} [options.sink] metres the proxy sits below the surface
 * @returns {THREE.BufferGeometry}
 */
export function createTerrainOccluderGeometry({ heights, chunkSize, tileSize, step = 4, sink = 0.5 }) {
  const stride = Math.max(1, Math.min(chunkSize, Math.round(step)));
  const samples = Math.floor(chunkSize / stride) + 1;
  const vertexSize = chunkSize + 1;
  const half = chunkSize / 2;
  const positions = new Float32Array(samples * samples * 3);
  for (let row = 0; row < samples; row += 1) {
    const j = Math.min(chunkSize, row * stride);
    for (let column = 0; column < samples; column += 1) {
      const i = Math.min(chunkSize, column * stride);
      const offset = (row * samples + column) * 3;
      positions[offset] = (i - half) * tileSize;
      positions[offset + 1] = heights[j * vertexSize + i] - sink;
      // Cell z grows toward −canonical z.
      positions[offset + 2] = -(j - half) * tileSize;
    }
  }
  const indices = [];
  for (let row = 0; row < samples - 1; row += 1) {
    for (let column = 0; column < samples - 1; column += 1) {
      const a = row * samples + column;
      const b = a + 1;
      const c = a + samples;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
