/**
 * Deterministic 2D value noise for terrain generation, evaluated in double
 * precision on the CPU and in the chunk workers alike. Lattice points are
 * hashed as 32-bit integers, so it is exact wherever cell coordinates are.
 */

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function fade(value) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

export function hash2d(x, z, seed) {
  let value = Math.imul(x | 0, 0x1f123bb5) ^ Math.imul(z | 0, 0x5f356495) ^ (seed | 0);
  value = Math.imul(value ^ (value >>> 15), 0x2c1b3c6d);
  value = Math.imul(value ^ (value >>> 12), 0x297a2d39);
  value ^= value >>> 15;
  return (value >>> 0) / 0xffffffff;
}

/** Smooth noise in [-1, 1] with one lattice point per unit. */
export function valueNoise(x, z, seed) {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = fade(x - x0);
  const tz = fade(z - z0);
  const north = hash2d(x0, z0, seed) + (hash2d(x0 + 1, z0, seed) - hash2d(x0, z0, seed)) * tx;
  const south = hash2d(x0, z0 + 1, seed) + (hash2d(x0 + 1, z0 + 1, seed) - hash2d(x0, z0 + 1, seed)) * tx;
  return (north + (south - north) * tz) * 2 - 1;
}
