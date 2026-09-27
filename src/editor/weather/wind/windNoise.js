/**
 * The gradient noise the world wind field is built from, on the CPU and in TSL,
 * returning the same values for the same inputs.
 *
 * Structure ported from grass-test (`src/weather/WindField.js`). The lattice
 * hash is not: grass-test's `fract(sin(dot(cell, k)) × 43758)` loses every
 * significant digit in float32 once the argument reaches the tens of thousands,
 * so the GPU and the CPU realised different fields and a CPU consumer (cloth,
 * particles, sound) felt gusts the grass did not show. An integer hash is exact
 * in both u32 and `Math.imul`, so the two agree to float rounding.
 *
 * Lattice cells must be non-negative integers below 2^31; callers wrap their
 * coordinates first (see `windFieldModel.js`).
 */

import { Fn, cos, float, floor, fract, mix, sin, uint, vec2 } from 'three/tsl';

const TWO_PI = Math.PI * 2;
const TWO_POW_32 = 4294967296;
const HASH_X = 0x8da6b343;
const HASH_Y = 0xd8163841;
const HASH_MIX_A = 0x2c1b3c6d;
const HASH_MIX_B = 0x297a2d39;

/** Lattice hash in [0, 1). */
export function latticeHashCpu(cellX, cellY) {
  let h = Math.imul(cellX, HASH_X) ^ Math.imul(cellY, HASH_Y);
  h = Math.imul(h ^ (h >>> 15), HASH_MIX_A);
  h ^= h >>> 12;
  h = Math.imul(h, HASH_MIX_B);
  h ^= h >>> 15;
  return Math.fround(h >>> 0) / TWO_POW_32;
}

function gradientDotCpu(cellX, cellY, localX, localY, offsetX, offsetY) {
  const angle = latticeHashCpu(cellX + offsetX, cellY + offsetY) * TWO_PI;
  return Math.cos(angle) * (localX - offsetX) + Math.sin(angle) * (localY - offsetY);
}

/** Gradient noise in roughly [0, 1], centred on 0.5. */
export function gradientNoise2dCpu(x, y) {
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
  const localX = x - cellX;
  const localY = y - cellY;
  const fadeX = localX * localX * (3 - 2 * localX);
  const fadeY = localY * localY * (3 - 2 * localY);
  return (
    (gradientDotCpu(cellX, cellY, localX, localY, 0, 0) * (1 - fadeX)
      + gradientDotCpu(cellX, cellY, localX, localY, 1, 0) * fadeX) * (1 - fadeY)
    + (gradientDotCpu(cellX, cellY, localX, localY, 0, 1) * (1 - fadeX)
      + gradientDotCpu(cellX, cellY, localX, localY, 1, 1) * fadeX) * fadeY
  ) + 0.5;
}

export function latticeHashNode(cellX, cellY) {
  let h = cellX.mul(uint(HASH_X)).bitXor(cellY.mul(uint(HASH_Y)));
  h = h.bitXor(h.shiftRight(uint(15))).mul(uint(HASH_MIX_A));
  h = h.bitXor(h.shiftRight(uint(12)));
  h = h.mul(uint(HASH_MIX_B));
  h = h.bitXor(h.shiftRight(uint(15)));
  return float(h).div(TWO_POW_32);
}

// Keep the return type explicit: nested warps otherwise expand this expression
// repeatedly during type inference.
export const gradientNoise2dNode = Fn(([point]) => {
  const cell = floor(point).toVar();
  const local = fract(point).toVar();
  const fade = local.mul(local).mul(float(3).sub(local.mul(2)));
  const cellX = uint(cell.x);
  const cellY = uint(cell.y);
  const gradientDot = (offsetX, offsetY) => {
    const angle = latticeHashNode(cellX.add(uint(offsetX)), cellY.add(uint(offsetY))).mul(TWO_PI);
    const delta = local.sub(vec2(offsetX, offsetY));
    return cos(angle).mul(delta.x).add(sin(angle).mul(delta.y));
  };
  const x0 = mix(gradientDot(0, 0), gradientDot(1, 0), fade.x);
  const x1 = mix(gradientDot(0, 1), gradientDot(1, 1), fade.x);
  return mix(x0, x1, fade.y).add(0.5);
}, 'float');
