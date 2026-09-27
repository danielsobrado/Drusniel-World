import * as THREE from 'three/webgpu';

/**
 * Soft spray puffs for waterfall mist (ported from grass-test), a different
 * puff in each channel so a particle picks its shape without atlas bleeding.
 * Each is a round falloff broken up by warped noise, so the edges come out
 * wispy, and zero on the border so the billboard never shows its square.
 */

function hash(x, y, seed) {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(seed, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function tiledNoise(columns, rows, seed) {
  const gx = new Float32Array(columns * rows);
  const gy = new Float32Array(columns * rows);
  for (let index = 0; index < gx.length; index += 1) {
    const angle = hash(index % columns, Math.floor(index / columns), seed) * Math.PI * 2;
    gx[index] = Math.cos(angle);
    gy[index] = Math.sin(angle);
  }
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const corner = (cx, cy, dx, dy) => {
    const k = (((cy % rows) + rows) % rows) * columns + (((cx % columns) + columns) % columns);
    return gx[k] * dx + gy[k] * dy;
  };
  return (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const u = fade(fx);
    const top = corner(ix, iy, fx, fy) + (corner(ix + 1, iy, fx - 1, fy) - corner(ix, iy, fx, fy)) * u;
    const bottom = corner(ix, iy + 1, fx, fy - 1)
      + (corner(ix + 1, iy + 1, fx - 1, fy - 1) - corner(ix, iy + 1, fx, fy - 1)) * u;
    return top + (bottom - top) * fade(fy);
  };
}

export function createSprayPuffPixels({ size = 128, seed = 7723 } = {}) {
  const data = new Uint8Array(size * size * 4);
  for (let channel = 0; channel < 4; channel += 1) {
    const warp = tiledNoise(3, 3, seed + channel * 11);
    const noise = [
      tiledNoise(4, 4, seed + channel * 11 + 1),
      tiledNoise(8, 8, seed + channel * 11 + 2),
      tiledNoise(16, 16, seed + channel * 11 + 3),
    ];
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const u = (x + 0.5) / size;
        const v = (y + 0.5) / size;
        const bend = warp(u * 3, v * 3) * 0.9;
        const detail = noise[0](u * 4 + bend, v * 4 - bend) * 0.55
          + noise[1](u * 8 + bend, v * 8) * 0.3
          + noise[2](u * 16, v * 16 + bend) * 0.15;
        // Radius 1 at the inscribed circle; the noise pushes the edge in and out.
        const radius = Math.hypot(u - 0.5, v - 0.5) * 2 * (1 - detail * 0.5);
        const falloff = 1 - THREE.MathUtils.smoothstep(radius, 0.2, 0.95);
        const border = 1 - THREE.MathUtils.smoothstep(
          Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)) * 2,
          0.84,
          0.98,
        );
        const density = THREE.MathUtils.clamp(falloff * border * (0.72 + detail * 1.1), 0, 1);
        data[(y * size + x) * 4 + channel] = Math.round(density * 255);
      }
    }
  }
  return { data, size };
}

export function createSprayPuffTexture() {
  const { data, size } = createSprayPuffPixels();
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.name = 'Waterfall spray puffs';
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}
