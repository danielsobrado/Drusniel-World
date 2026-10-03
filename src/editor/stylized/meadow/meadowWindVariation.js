import { latticeHashCpu } from '../../weather/wind/windNoise.js';

const TWO_PI = Math.PI * 2;

// A dense 8 m tile has thousands of stems but touches only a few noise cells.
// Cache their gradients once, keeping the per-stem work to interpolation.
function noiseForTile(centerX, centerZ, tileSize, scale) {
  const half = tileSize / 2;
  const minX = Math.floor((centerX - half) * scale);
  const minZ = Math.floor((centerZ - half) * scale);
  const width = Math.floor((centerX + half) * scale) - minX + 2;
  const depth = Math.floor((centerZ + half) * scale) - minZ + 2;
  const gradients = new Float64Array(width * depth * 2);
  for (let z = 0; z < depth; z += 1) {
    for (let x = 0; x < width; x += 1) {
      const angle = latticeHashCpu(minX + x, minZ + z) * TWO_PI;
      const offset = (z * width + x) * 2;
      gradients[offset] = Math.cos(angle);
      gradients[offset + 1] = Math.sin(angle);
    }
  }
  return (worldX, worldZ) => {
    const x = worldX * scale;
    const z = worldZ * scale;
    const cellX = Math.floor(x);
    const cellZ = Math.floor(z);
    const localX = x - cellX;
    const localZ = z - cellZ;
    const fadeX = localX * localX * (3 - 2 * localX);
    const fadeZ = localZ * localZ * (3 - 2 * localZ);
    const offset = ((cellZ - minZ) * width + cellX - minX) * 2;
    const south = offset + width * 2;
    const a = gradients[offset] * localX + gradients[offset + 1] * localZ;
    const b = gradients[offset + 2] * (localX - 1) + gradients[offset + 3] * localZ;
    const c = gradients[south] * localX + gradients[south + 1] * (localZ - 1);
    const d = gradients[south + 2] * (localX - 1) + gradients[south + 3] * (localZ - 1);
    const value = (a * (1 - fadeX) + b * fadeX) * (1 - fadeZ)
      + (c * (1 - fadeX) + d * fadeX) * fadeZ + 0.5;
    return Math.max(0, Math.min(1, value));
  };
}

/**
 * Wind variation belongs to the world, not a reusable tile template. Bake it
 * during compaction in double precision so every LOD and the far cards agree,
 * even after floating-origin rebases on large imported maps. No per-vertex
 * noise evaluation or extra instance attribute is needed.
 */
export function createMeadowWindVariationWriter(centerX, centerZ, tileSize) {
  const phase = noiseForTile(centerX, centerZ, tileSize, 0.2);
  const variation = noiseForTile(centerX, centerZ, tileSize, 0.3);
  return (data, offset, worldX, worldZ) => {
    data[offset] = phase(worldX, worldZ) * TWO_PI;
    data[offset + 1] = variation(worldX, worldZ);
  };
}
