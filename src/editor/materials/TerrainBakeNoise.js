/**
 * The terrain material bake's CPU value noise, shared with anything that must
 * agree with the bake texel for texel (the snow gate on grass, for one).
 */

function hashUnit(x, z, seed) {
  let value = Math.imul(x ^ seed, 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16) ^ z, 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) / 0xffffffff;
}

/** Smooth value noise in [0, 1] at canonical world metres. */
export function terrainBakeValueNoise(worldX, worldZ, scale, seed) {
  const x = worldX / scale;
  const z = worldZ / scale;
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = x - x0;
  const tz = z - z0;
  const sx = tx * tx * (3 - 2 * tx);
  const sz = tz * tz * (3 - 2 * tz);
  const a = hashUnit(x0, z0, seed);
  const b = hashUnit(x0 + 1, z0, seed);
  const c = hashUnit(x0, z0 + 1, seed);
  const d = hashUnit(x0 + 1, z0 + 1, seed);
  const ab = a + (b - a) * sx;
  const cd = c + (d - c) * sx;
  return ab + (cd - ab) * sz;
}

/** The bake's macro noise seed for a world. */
export function terrainBakeMacroSeed(seedOffset, worldSeed) {
  return (seedOffset ^ (Number.isSafeInteger(worldSeed) ? worldSeed : 0)) | 0;
}
