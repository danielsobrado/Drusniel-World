import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SEABED_ROCKS, buildSeabedRocks } from '../src/editor/stylized/seabedRocks.js';

const SEA_LEVEL = 0;
const TILE_SIZE = 2;
const CHUNK = { chunkX: 0, chunkZ: 0, chunkSize: 8, tileSize: TILE_SIZE };

const STUBS = {
  prototypeIndexForRoll: () => 0,
  radiusForScale: (scale) => scale,
};

function build(heightAt, config = {}) {
  return buildSeabedRocks({
    ...CHUNK,
    ...STUBS,
    seaLevel: SEA_LEVEL,
    // A one-metre grid so a 16 m test chunk has enough candidates to say anything,
    // and a 4 m cluster cell so it spans several of them — at the shipped 22 m the
    // whole test chunk sits inside one lattice cell and the layer is all or
    // nothing, which is a property of the test's chunk size, not of the layer.
    config: { ...DEFAULT_SEABED_ROCKS, spacingMeters: 1, clusterMeters: 4, ...config },
    heightAt,
  });
}

/** Ground `depth` metres below sea level everywhere. */
const flatAt = (depth) => () => SEA_LEVEL - depth;

/** Ground that deepens with x, so a chunk spans the whole band. */
const shelving = (x) => SEA_LEVEL - (1 + (x / 16) * 12);

test('stones sit in the shallow band, not on the beach and not in the deep', () => {
  const placements = build((x) => shelving(x));
  assert.ok(placements.length > 0, 'the shelf should place something');
  for (const placement of placements) {
    const depth = SEA_LEVEL - placement.height;
    assert.ok(
      depth >= DEFAULT_SEABED_ROCKS.minDepth && depth <= DEFAULT_SEABED_ROCKS.maxDepth,
      `stone at depth ${depth} is outside the band`,
    );
  }
});

test('dry ground places nothing', () => {
  for (const above of [0.2, 2, 60]) {
    assert.deepEqual(build(flatAt(-above)), []);
  }
});

test('water deeper than the band places nothing', () => {
  // Past maxDepth the stones would be drawn and never seen, so the whole chunk is
  // rejected before a candidate is tried.
  assert.deepEqual(build(flatAt(DEFAULT_SEABED_ROCKS.maxDepth + 1)), []);
  // Just inside the band, in the shallows where it is actually visible.
  assert.ok(build(flatAt(3)).length > 0);
});

test('the band starts below the waterline', () => {
  // Right at the waterline the layer would be drawing breakers on the sand, where
  // the swash and the foam already are.
  assert.deepEqual(build(flatAt(DEFAULT_SEABED_ROCKS.minDepth - 0.4)), []);
  assert.deepEqual(build(flatAt(DEFAULT_SEABED_ROCKS.minDepth + 0.8)).length > 0, true);
});

test('the shallows are denser than the deep, because the deep is not visible', () => {
  // The donor's seaward bias, adapted: the water's colour saturates by about six
  // metres, so `keep` has to fade the stones out before that rather than filling
  // the band. Compared at two flat depths over the identical chunk, so the only
  // variable is the fade and not how much of the chunk falls in each band.
  const shallow = build(flatAt(2.5)).length;
  const deep = build(flatAt(9)).length;
  assert.ok(shallow > deep, `shallow ${shallow} should outnumber deep ${deep}`);
  assert.ok(deep > 0, 'the deep end should thin, not vanish outright');
  // The fade reaches zero exactly at the band's end, which is the point of a band
  // this deep: the deepest stones would be paid for and never seen.
  assert.equal(build(flatAt(DEFAULT_SEABED_ROCKS.maxDepth)).length, 0);
  assert.ok(build(flatAt(DEFAULT_SEABED_ROCKS.maxDepth - 1)).length > 0);
});

test('the same chunk places the same stones every time', () => {
  const first = build(shelving);
  const second = build(shelving);
  assert.deepEqual(
    first.map((p) => [p.stableId, p.x, p.z, p.scale, p.radius]),
    second.map((p) => [p.stableId, p.x, p.z, p.scale, p.radius]),
  );
});

test('a stone belongs to exactly one chunk', () => {
  // The sink owns by position, and the grid deliberately reaches one row and
  // column back into the neighbouring chunk. A stone landing there must be
  // refused here and taken there, or it is placed twice — with two colliders — or
  // not at all.
  const collected = new Map();
  const seaBed = (x, z) => SEA_LEVEL - (2 + Math.abs((x % 13) + (z % 7)) * 0.4);
  for (const chunkX of [-1, 0]) {
    for (const chunkZ of [-1, 0]) {
      const placements = buildSeabedRocks({
        chunkX,
        chunkZ,
        chunkSize: 8,
        tileSize: TILE_SIZE,
        ...STUBS,
        seaLevel: SEA_LEVEL,
        config: { ...DEFAULT_SEABED_ROCKS, spacingMeters: 1, clusterMeters: 4 },
        heightAt: seaBed,
      });
      for (const placement of placements) {
        assert.equal(placement.ownerChunkX, chunkX);
        assert.equal(placement.ownerChunkZ, chunkZ);
        assert.equal(
          collected.has(placement.stableId),
          false,
          `${placement.stableId} was placed by two chunks`,
        );
        collected.set(placement.stableId, placement);
      }
    }
  }
  assert.ok(collected.size > 0, 'the four chunks should place something between them');
});

test('scale stays inside the configured range', () => {
  const placements = build(shelving);
  assert.ok(placements.length > 0);
  for (const placement of placements) {
    assert.ok(placement.scale >= DEFAULT_SEABED_ROCKS.minScale);
    assert.ok(placement.scale <= DEFAULT_SEABED_ROCKS.maxScale);
    assert.equal(placement.radius, placement.scale);
    assert.equal(placement.prototypeIndex, 0);
  }
});

test('switching the layer off places nothing', () => {
  assert.deepEqual(build(shelving, { enabled: false }), []);
});
