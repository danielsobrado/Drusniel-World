/**
 * Shared plumbing for stones placed by world features (rivers, coasts) rather
 * than by the scatter manifest: stable hashing, and a sink that keeps only the
 * stones a chunk owns and gives them the rock manifest's placement shape.
 *
 * A stone belongs to the chunk its own position lies in — collision requires a
 * collider to overlap its owner chunk — using the same half-open cell rule a
 * canonical position is assigned to a chunk by (x = cell × tile, z = −cell ×
 * tile), so chunk borders never duplicate a stone.
 */

/** Deterministic hash of integers to [0, 1). */
export function stoneHash01(...values) {
  let hash = 0x811c9dc5;
  for (const value of values) {
    hash = Math.imul(hash ^ (value | 0), 0x01000193);
    hash ^= hash >>> 13;
    hash = Math.imul(hash, 0x5bd1e995);
    hash ^= hash >>> 15;
  }
  return (hash >>> 0) / 4294967296;
}

export function smoothstep(edge0, edge1, value) {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * @param {object} options
 * @param {string} options.prefix stable-id namespace, e.g. `river-rock`
 * @param {number} options.chunkX
 * @param {number} options.chunkZ
 * @param {number} options.chunkSize cells per chunk side
 * @param {number} options.tileSize metres per cell
 * @param {(x: number, z: number) => number} options.heightAt canonical ground height
 * @param {(roll: number, x: number, z: number) => number} options.prototypeIndexForRoll
 * @param {(scale: number) => number} options.radiusForScale
 */
export function createStonePlacementSink({
  prefix,
  chunkX,
  chunkZ,
  chunkSize,
  tileSize,
  heightAt,
  prototypeIndexForRoll,
  radiusForScale,
}) {
  const minX = chunkX * chunkSize;
  const minZ = chunkZ * chunkSize;
  const maxX = minX + chunkSize;
  const maxZ = minZ + chunkSize;
  const placements = [];
  const owns = (x, z) => {
    const cellX = Math.floor(x / tileSize);
    const cellZ = Math.floor(-z / tileSize);
    return cellX >= minX && cellX < maxX && cellZ >= minZ && cellZ < maxZ;
  };
  return {
    /** The chunk's cell box, half-open. */
    cells: Object.freeze({ minX, minZ, maxX, maxZ }),
    placements,
    owns,
    place(identity, x, z, scale, roll, rotation, priority, height = null) {
      if (!owns(x, z)) return false;
      placements.push(Object.freeze({
        stableId: `${prefix}:${identity}`,
        ownerChunkX: chunkX,
        ownerChunkZ: chunkZ,
        x,
        z,
        height: height ?? heightAt(x, z),
        scale,
        rotationY: rotation * Math.PI * 2,
        prototypeIndex: prototypeIndexForRoll(roll, x, z),
        radius: radiusForScale(scale),
        priority,
      }));
      return true;
    },
  };
}
