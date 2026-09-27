import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';

import {
  WATERFALL_PATTERN_PERIOD_METERS as PERIOD,
  waterfallPatternOrigin,
} from '../src/editor/stylized/WaterfallShading.js';

const f32 = Math.fround;
const editorConfig = yaml.load(fs.readFileSync('editor.config.yaml', 'utf8'));
const waterfall = yaml.load(fs.readFileSync('config/water-visual.yaml', 'utf8')).water.waterfall;
const chunkWorldSize = editorConfig.world.chunkSize * editorConfig.map.tileSize;

/** Canonical chunk centres: a chunk's corner is a whole number of chunks from zero. */
const centre = (chunk) => (chunk + 0.5) * chunkWorldSize;

test('neighbouring chunks carry the pattern straight across, except where it wraps', () => {
  for (const chunk of [-55_740, -1, 0, 1, 32_756, 959, 960]) {
    const [a] = waterfallPatternOrigin(centre(chunk), 0);
    const [b] = waterfallPatternOrigin(centre(chunk + 1), 0);
    assert.ok(a >= 0 && a < PERIOD && b >= 0 && b < PERIOD);
    const wraps = Math.floor(centre(chunk + 1) / PERIOD) !== Math.floor(centre(chunk) / PERIOD);
    assert.equal(b - a, wraps ? chunkWorldSize - PERIOD : chunkWorldSize, `chunk ${chunk}`);
  }
});

test('strand coordinates keep centimetres at planet scale, where canonical metres do not', () => {
  // A chunk millions of metres out on Eldara, and points inside it.
  const [centreX, centreZ] = [centre(-55_740), centre(18_331)];
  const [originX, originZ] = waterfallPatternOrigin(centreX, centreZ);
  let worst = 0;
  let canonicalWorst = 0;
  for (const local of [-63.97, -21.4, 0.013, 17.31, 37.31, 63.99]) {
    // What the shader computes in float32: the uniform plus the local offset.
    const pattern = f32(f32(originX) + f32(local));
    worst = Math.max(worst, Math.abs(pattern - (originX + local)));
    worst = Math.max(worst, Math.abs(f32(f32(originZ) + f32(local)) - (originZ + local)));
    // What it computed before: the canonical centre plus the same offset.
    canonicalWorst = Math.max(canonicalWorst, Math.abs(f32(f32(centreX) + f32(local)) - (centreX + local)));
  }
  assert.ok(worst < 0.01, `pattern coordinates off by ${worst} m`);
  assert.ok(canonicalWorst > 0.1, `canonical coordinates off by only ${canonicalWorst} m`);
});

test('a wrap never shows on falls that flow along an axis', () => {
  // Shifting by the period along a fall's own axes moves each tile a whole
  // number of times, for the strands and the churn alike, and a wrap lies on a
  // chunk border.
  const tiles = [
    waterfall.strandWidthMeters,
    waterfall.strandLengthMeters,
    waterfall.plungeScaleMeters,
    waterfall.plungeScaleMeters * 4,
    chunkWorldSize,
  ];
  for (const tile of tiles) {
    const count = PERIOD / tile;
    assert.ok(Math.abs(count - Math.round(count)) < 1e-9, `${tile} m does not divide the period`);
  }
  assert.ok(PERIOD + chunkWorldSize < 2 ** 17, 'coordinates stay below 2^17 m, within a centimetre in float32');
});
