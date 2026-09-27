import * as THREE from 'three/webgpu';

/**
 * Falling-water detail, u across the fall and v down it, tiling both ways
 * (ported from grass-test's waterfall texture).
 *
 *   R  fine strands
 *   G  broader sheets
 *   B  slow patches of thick and thin water
 *
 * The lattices are far finer across than down, so every channel streaks along
 * the fall; a shared meander keeps the strands off straight lattice columns.
 * Each channel is rank-equalized, so a threshold of `1 - coverage` whitens
 * about `coverage` of the surface.
 */

function hash(x, y, seed) {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(seed, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Gradient noise that tiles every `columns` by `rows` lattice cells. */
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
    const a = corner(ix, iy, fx, fy);
    const b = corner(ix + 1, iy, fx - 1, fy);
    const c = corner(ix, iy + 1, fx, fy - 1);
    const d = corner(ix + 1, iy + 1, fx - 1, fy - 1);
    const u = fade(fx);
    const top = a + (b - a) * u;
    return top + (c + (d - c) * u - top) * fade(fy);
  };
}

/** Remaps values to their rank, spreading each channel evenly over 0..1. */
function equalize(values) {
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const value of values) {
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  const bins = new Float64Array(2048);
  const scale = (bins.length - 1) / Math.max(maximum - minimum, 1e-9);
  for (const value of values) bins[Math.round((value - minimum) * scale)] += 1;
  let below = 0;
  for (let index = 0; index < bins.length; index += 1) {
    const count = bins[index];
    bins[index] = (below + count * 0.5) / values.length;
    below += count;
  }
  return values.map((value) => bins[Math.round((value - minimum) * scale)]);
}

export function createWaterfallStrandPixels({ width = 256, height = 64, seed = 4211 } = {}) {
  const meander = [tiledNoise(6, 2, seed), tiledNoise(12, 3, seed + 1)];
  const strands = [tiledNoise(48, 4, seed + 2), tiledNoise(96, 8, seed + 3)];
  const sheets = [tiledNoise(12, 2, seed + 4), tiledNoise(24, 4, seed + 5)];
  const patches = [tiledNoise(4, 1, seed + 6), tiledNoise(8, 2, seed + 7)];
  const channels = [0, 1, 2].map(() => new Float32Array(width * height));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const u = x / width;
      const v = y / height;
      const k = y * width + x;
      // In units of one strand-lattice cell across (1/48 of the tile).
      const warp = meander[0](u * 6, v * 2) * 1.2 + meander[1](u * 12, v * 3) * 0.45;
      channels[0][k] = strands[0](u * 48 + warp, v * 4) * 0.62
        + strands[1](u * 96 + warp * 2, v * 8) * 0.38;
      channels[1][k] = sheets[0](u * 12 + warp / 4, v * 2) * 0.65
        + sheets[1](u * 24 + warp / 2, v * 4) * 0.35;
      channels[2][k] = patches[0](u * 4, v) * 0.7 + patches[1](u * 8, v * 2) * 0.3;
    }
  }
  const [r, g, b] = channels.map(equalize);
  const data = new Uint8Array(width * height * 4);
  for (let k = 0; k < width * height; k += 1) {
    data[k * 4] = Math.round(r[k] * 255);
    data[k * 4 + 1] = Math.round(g[k] * 255);
    data[k * 4 + 2] = Math.round(b[k] * 255);
    data[k * 4 + 3] = 255;
  }
  return { data, width, height };
}

let sharedTexture = null;

/** One strand texture for every water material; built on first use. */
export function getWaterfallStrandTexture() {
  if (sharedTexture) return sharedTexture;
  const { data, width, height } = createWaterfallStrandPixels();
  sharedTexture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  sharedTexture.name = 'Waterfall strands';
  sharedTexture.wrapS = THREE.RepeatWrapping;
  sharedTexture.wrapT = THREE.RepeatWrapping;
  sharedTexture.minFilter = THREE.LinearMipmapLinearFilter;
  sharedTexture.magFilter = THREE.LinearFilter;
  sharedTexture.generateMipmaps = true;
  sharedTexture.colorSpace = THREE.NoColorSpace;
  sharedTexture.needsUpdate = true;
  return sharedTexture;
}
