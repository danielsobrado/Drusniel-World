import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_CONTACT_SHADE,
  contactShadeRadius,
  paintContactShade,
  resolveContactShade,
} from '../src/editor/stylized/contactShade.js';
import {
  FOREST_FLOOR_CANOPY_SAMPLES,
  FOREST_FLOOR_SIZE,
  writeForestFloorCanopy,
} from '../src/editor/stylized/forestFloorTexture.js';

const SIZE = 16;
const CHUNK = 128;
const CENTER = { x: 256, z: -1024 };

function makePixels() {
  return new Uint8Array(SIZE * SIZE * 4);
}

function paint(sources, options = {}) {
  const pixels = makePixels();
  const painted = paintContactShade({
    pixels,
    size: SIZE,
    centerWorldX: CENTER.x,
    centerWorldZ: CENTER.z,
    chunkWorldSize: CHUNK,
    sources,
    ...options,
  });
  return { pixels, painted };
}

/** The darkest value painted into the shade channel. */
function darkest(pixels) {
  let value = 0;
  for (let index = 0; index < SIZE * SIZE; index += 1) {
    value = Math.max(value, pixels[index * 4 + 1]);
  }
  return value;
}

test('a canopy-sized patch darkens the middle of the texture', () => {
  // Eight metres to a texel: a patch has to be canopy-sized to land on the
  // texture at all, which is why the default radius is what it is.
  const { pixels, painted } = paint([
    { x: CENTER.x, z: CENTER.z, radius: 16, strength: 0.8 },
  ]);
  assert.equal(painted, 1);
  // A two-texel patch: the darkest texel is a third of a radius from the centre,
  // which is a shade that reads without being black.
  assert.ok(darkest(pixels) > 60, `the patch should be shaded, darkest ${darkest(pixels)}`);
  const mid = Math.floor(SIZE / 2);
  const centre = mid * SIZE + mid;
  assert.ok(pixels[centre * 4 + 1] > 0);
  assert.equal(pixels[(0 * SIZE + 0) * 4 + 1], 0, 'a corner is outside the patch');
});

test('the falloff is quadratic, so the patch has no rim', () => {
  const { pixels } = paint([{ x: CENTER.x, z: CENTER.z, radius: 64, strength: 1 }]);
  const mid = Math.floor(SIZE / 2);
  // Sampling outward from the centre along one row: the value has to fall, and
  // fall as a square — that is what makes a soft patch rather than a disc with a
  // visible edge. Half way out, the value is a quarter of the centre's.
  const values = [];
  for (let step = 0; step < 5; step += 1) {
    values.push(pixels[(mid * SIZE + mid + step) * 4 + 1]);
  }
  for (let index = 1; index < values.length; index += 1) {
    assert.ok(values[index] <= values[index - 1], 'shade should not rise outward');
  }
  const centreValue = values[0];
  const halfWayOut = values[4];
  assert.ok(centreValue > halfWayOut, 'the middle should be the darkest');
  assert.ok(Math.abs(halfWayOut / centreValue - 0.25) < 0.05, `ratio ${halfWayOut / centreValue}`);
});

test('overlapping footprints keep the darker one', () => {
  const weak = { x: CENTER.x, z: CENTER.z, radius: 16, strength: 0.3 };
  const strong = { x: CENTER.x, z: CENTER.z, radius: 16, strength: 0.9 };
  const { pixels: weakFirst } = paint([weak, strong]);
  const { pixels: strongFirst } = paint([strong, weak]);
  // Max-blend, so the order they arrive in cannot change the ground. A sum would
  // have made a cluster of trunks black.
  assert.deepEqual(Array.from(weakFirst), Array.from(strongFirst));
  const { pixels: strongOnly } = paint([strong]);
  assert.deepEqual(Array.from(weakFirst), Array.from(strongOnly));
});

test('a footprint outside the chunk paints nothing', () => {
  const { pixels, painted } = paint([
    { x: CENTER.x + CHUNK, z: CENTER.z, radius: 4, strength: 1 },
    { x: CENTER.x, z: CENTER.z - CHUNK, radius: 4, strength: 1 },
  ]);
  assert.equal(painted, 0);
  assert.equal(darkest(pixels), 0);
});

test('a footprint is painted to its own side of the centre, not mirrored', () => {
  // The texture's z axis runs down from the top edge while canonical z runs up, so
  // a flip here would put every boulder's shade on the wrong side of it — invisible
  // at the centre of a chunk and wrong everywhere else.
  const { pixels } = paint([{ x: CENTER.x, z: CENTER.z + 32, radius: 8, strength: 1 }]);
  const mid = Math.floor(SIZE / 2);
  let weightedZ = 0;
  let total = 0;
  for (let z = 0; z < SIZE; z += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const value = pixels[(z * SIZE + x) * 4 + 1];
      if (value === 0) continue;
      weightedZ += z * value;
      total += value;
    }
  }
  // Canonical +z is north; on the texture that is *up* the image, i.e. a z index
  // below the middle row.
  assert.ok(weightedZ / total < mid, `shade landed at row ${weightedZ / total}, expected above ${mid}`);
});

test('nonsense sources are skipped rather than painted', () => {
  const { painted } = paint([
    { x: CENTER.x, z: CENTER.z, radius: 0 },
    { x: CENTER.x, z: CENTER.z, radius: Number.NaN },
    { x: Number.NaN, z: CENTER.z, radius: 4 },
    { x: CENTER.x, z: CENTER.z, radius: 4, strength: 0 },
  ]);
  assert.equal(painted, 0);
});

test('the painter refuses a texture it cannot paint into', () => {
  assert.throws(
    () => paintContactShade({ pixels: null, size: SIZE, centerWorldX: 0, centerWorldZ: 0, chunkWorldSize: CHUNK, sources: [] }),
    /byte texture/,
  );
  assert.throws(
    () => paintContactShade({ pixels: new Uint8Array(4), size: 0, centerWorldX: 0, centerWorldZ: 0, chunkWorldSize: CHUNK, sources: [] }),
    /positive integer texture size/,
  );
});

test('the config resolves, and disabling it resolves to nothing', () => {
  assert.equal(resolveContactShade({ contactShade: { enabled: false } }), null);
  assert.equal(resolveContactShade({}).radiusPerScale, DEFAULT_CONTACT_SHADE.radiusPerScale);
  assert.throws(() => resolveContactShade({ contactShade: { treeStrength: 2 } }), /must be within \[0, 1\]/);
  assert.throws(() => resolveContactShade({ contactShade: { radiusPerScale: -1 } }), /must not be negative/);
  assert.throws(() => resolveContactShade({ contactShade: { treeRadius: -1 } }), /treeRadius must not be negative/);
});

test('patches follow the donor: trunk · 3 + 3 round a tree, radius · 1.5 + 1 round a stone', () => {
  const settings = resolveContactShade({});
  // A unit-scale tree's patch is about four metres, a stone's two: two texels
  // or more on the 2 m ground texture, so both actually paint.
  assert.ok(Math.abs(contactShadeRadius(settings, 'tree', 1) - 4.2) < 1e-9);
  assert.ok(Math.abs(contactShadeRadius(settings, 'rock', 1) - 2.2) < 1e-9);
  assert.ok(contactShadeRadius(settings, 'tree', 2) > contactShadeRadius(settings, 'tree', 1));
  assert.equal(contactShadeRadius(settings, 'rock', Number.NaN), contactShadeRadius(settings, 'rock', 1));
});

test('the forest floor keeps the canopy coarse and upsamples it smoothly', () => {
  const size = FOREST_FLOOR_SIZE;
  const samples = FOREST_FLOOR_CANOPY_SAMPLES;
  const pixels = new Uint8Array(size * size * 4).fill(77);
  let calls = 0;
  writeForestFloorCanopy({
    pixels,
    size,
    samples,
    // A ramp from west to east.
    canopyAt: (x) => { calls += 1; return x / (samples - 1); },
  });
  // The habitat is sampled at the old 16 × 16, not per texel.
  assert.equal(calls, samples * samples);
  const row = Array.from({ length: size }, (_, x) => pixels[(10 * size + x) * 4]);
  assert.equal(row[0], 0);
  assert.equal(row[size - 1], 255);
  for (let x = 1; x < size; x += 1) assert.ok(row[x] >= row[x - 1], 'the ramp must not step back');
  // Shade and blue are cleared for the contact pass; alpha is opaque.
  assert.equal(pixels[1], 0);
  assert.equal(pixels[2], 0);
  assert.equal(pixels[3], 255);
});
