import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCoastStones, DEFAULT_COAST_STONES } from '../src/editor/stylized/coastStones.js';

const TILE = 2;
const SEA = -1.5;
// A beach rising from the sea along canonical x: 0.05 m above water per metre.
const beach = (x) => SEA - 2 + x * 0.05;

function build(chunkX, heightAt = beach, config = DEFAULT_COAST_STONES) {
  return buildCoastStones({
    chunkX,
    chunkZ: 0,
    chunkSize: 64,
    tileSize: TILE,
    seaLevel: SEA,
    heightAt: (x) => heightAt(x),
    prototypeIndexForRoll: (roll) => Math.floor(roll * 3),
    radiusForScale: (scale) => scale * 1.8,
    config,
  });
}

test('pebbles lie only in the band just above the sea', () => {
  const stones = build(0);
  assert.ok(stones.length > 10);
  for (const stone of stones) {
    const above = stone.height - SEA;
    assert.ok(above >= 0.05 && above <= DEFAULT_COAST_STONES.band, `${above} m above the sea`);
    assert.ok(stone.scale <= DEFAULT_COAST_STONES.maxScale);
    assert.equal(Math.floor(stone.x / TILE / 64), stone.ownerChunkX);
  }
});

test('placement is stable and never duplicated across chunks', () => {
  assert.deepEqual(build(0), build(0));
  const ids = [...build(0), ...build(1)].map((stone) => stone.stableId);
  assert.equal(new Set(ids).size, ids.length);
});

test('inland and open-sea chunks are skipped without placing anything', () => {
  assert.deepEqual(build(0, () => 300), []);
  assert.deepEqual(build(0, () => SEA - 40), []);
  assert.deepEqual(build(0, beach, { ...DEFAULT_COAST_STONES, enabled: false }), []);
});

test('splitting a stretch of beach into chunks loses no stones at the borders', () => {
  // A beach that stays in the band everywhere, so only the grid decides.
  const flat = () => SEA + 0.3;
  const config = { ...DEFAULT_COAST_STONES, keep: 1 };
  const stones = (chunkX, chunkZ, chunkSize) => buildCoastStones({
    chunkX,
    chunkZ,
    chunkSize,
    tileSize: TILE,
    seaLevel: SEA,
    heightAt: flat,
    prototypeIndexForRoll: () => 0,
    radiusForScale: (scale) => scale,
    config,
  }).map((stone) => stone.stableId).sort();
  const whole = stones(0, 0, 128);
  const split = [
    ...stones(0, 0, 64), ...stones(1, 0, 64), ...stones(0, 1, 64), ...stones(1, 1, 64),
  ].sort();
  assert.ok(whole.length > 20, `only ${whole.length} stones`);
  assert.deepEqual(split, whole);
});
