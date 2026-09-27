#!/usr/bin/env node
/**
 * Runtime textures for live construction, made from the authored stone-wall
 * images in `assets/textures/stone-walls/`.
 *
 * `shell-stone-detail.png` is the stone pattern on the wall shell, the ribbon
 * that stands in for a wall in the far LOD band and before its masonry is
 * built. The shell keeps its per-style colour, so the texture carries only
 * relative brightness: luminance, with the broad moss and lighting blotches
 * removed (they would repeat visibly across a long wall), normalized to a fixed
 * mean and contrast, cross-faded so it tiles, and resized to a power of two.
 * `ConstructionShellDetail.js` divides by the same mean, so a shell's average
 * colour is unchanged.
 *
 * Usage: npm run prepare:construction-textures
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  SHELL_DETAIL_CONTRAST,
  SHELL_DETAIL_MEAN,
} from '../src/editor/construction/render/ConstructionShellDetailConfig.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(rootDir, 'assets/textures/stone-walls/rubble-wall-mossy.png');
const OUTPUT = path.join(rootDir, 'public/assets/textures/construction/shell-stone-detail.png');

const SIZE = 512;
/** Width of the band where the image's far edge cross-fades into its near edge. */
const SEAM_BAND = 40;
/** Blur radius of the broad variation removed before normalizing. */
const HIGH_PASS_SIGMA = 48;
const FLOOR = 0.2;

async function readLuminance(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const values = new Float32Array(info.width * info.height);
  for (let index = 0; index < values.length; index += 1) {
    const offset = index * info.channels;
    values[index] = (0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2]) / 255;
  }
  return { values, width: info.width, height: info.height };
}

async function blurred({ values, width, height }, sigma) {
  const bytes = Buffer.from(Array.from(values, (value) => Math.round(value * 255)));
  const { data } = await sharp(bytes, { raw: { width, height, channels: 1 } })
    .blur(sigma)
    .raw()
    .toBuffer({ resolveWithObject: true });
  return Float32Array.from(data, (value) => value / 255);
}

/** Remove the broad variation, keeping stones and crevices. */
async function highPass(image) {
  const broad = await blurred(image, HIGH_PASS_SIGMA);
  return { ...image, values: Float32Array.from(image.values, (value, index) => value - broad[index]) };
}

/**
 * Crop `SEAM_BAND` off both axes and fade the cropped strip back in over the
 * opposite edge, so the last column continues into the first and the image
 * tiles. Only that thin band shows two layers of stone at once.
 */
function makeTileable({ values, width, height }) {
  const tileWidth = width - SEAM_BAND;
  const tileHeight = height - SEAM_BAND;
  const at = (x, y) => values[y * width + x];
  const acrossX = (x, y) => {
    if (x >= SEAM_BAND) return at(x, y);
    const t = x / SEAM_BAND;
    return t * at(x, y) + (1 - t) * at(tileWidth + x, y);
  };
  const tiled = new Float32Array(tileWidth * tileHeight);
  for (let y = 0; y < tileHeight; y += 1) {
    for (let x = 0; x < tileWidth; x += 1) {
      const t = y >= SEAM_BAND ? 1 : y / SEAM_BAND;
      tiled[y * tileWidth + x] = t < 1
        ? t * acrossX(x, y) + (1 - t) * acrossX(x, tileHeight + y)
        : acrossX(x, y);
    }
  }
  return { values: tiled, width: tileWidth, height: tileHeight };
}

function normalize(values) {
  let mean = 0;
  for (const value of values) mean += value;
  mean /= values.length;
  let variance = 0;
  for (const value of values) variance += (value - mean) ** 2;
  const deviation = Math.sqrt(variance / values.length) || 1;
  return Float32Array.from(values, (value) => (
    Math.min(1, Math.max(FLOOR, SHELL_DETAIL_MEAN + ((value - mean) / deviation) * SHELL_DETAIL_CONTRAST))
  ));
}

const tile = makeTileable(await highPass(await readLuminance(SOURCE)));
const detail = normalize(tile.values);
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
await sharp(Buffer.from(Array.from(detail, (value) => Math.round(value * 255))), {
  raw: { width: tile.width, height: tile.height, channels: 1 },
})
  .resize(SIZE, SIZE, { kernel: 'lanczos3' })
  .toColourspace('b-w')
  .png({ compressionLevel: 9 })
  .toFile(OUTPUT);
console.log(`Wrote ${path.relative(rootDir, OUTPUT)} (${SIZE}x${SIZE}, mean ${SHELL_DETAIL_MEAN})`);
