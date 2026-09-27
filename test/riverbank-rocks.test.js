import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveWaterDomainConfig } from '../src/editor/water/WaterConfig.js';
import { createReachProfile } from '../src/editor/water/RiverReachProfile.js';
import { collectRiverFallSites } from '../src/editor/water/RiverFallSites.js';
import { buildRiverbankRocks, DEFAULT_RIVERBANK_ROCKS } from '../src/editor/stylized/riverbankRocks.js';

const { falls: fallsConfig } = resolveWaterDomainConfig();
const TILE = 2;

/** A 2 km river along +cell X at cell Z = 32, with one 12 m fall halfway. */
function segment() {
  return {
    bodyId: 1030,
    profile: createReachProfile(
      [100, 99, 98, 97, 96, 95, 94, 93, 92, 91, 79, 78, 77, 76, 75, 74, 73, 72, 71, 70, 69],
      2000,
      fallsConfig,
    ),
    ax: 0,
    az: 32,
    dx: 1000,
    dz: 0,
    length: 1000,
    flowX: 1,
    flowZ: 0,
    radiusCells: 6,
  };
}

function build(chunkX, extra = {}) {
  const river = segment();
  return buildRiverbankRocks({
    chunkX,
    chunkZ: 0,
    chunkSize: 64,
    tileSize: TILE,
    segments: [river],
    falls: collectRiverFallSites([river], TILE),
    heightAt: () => 5,
    prototypeIndexForRoll: (roll) => Math.floor(roll * 3),
    radiusForScale: (scale) => scale * 1.8,
    ...extra,
  });
}

test('bank stones line both banks, each owned by the chunk it stands in', () => {
  const placements = [];
  for (let chunkX = 0; chunkX < 16; chunkX += 1) placements.push(...build(chunkX));
  const bank = placements.filter((placement) => placement.stableId.startsWith('river-rock:bank:'));
  assert.ok(bank.length > 20);
  const north = bank.filter((placement) => -placement.z > 32 * TILE);
  const south = bank.filter((placement) => -placement.z < 32 * TILE);
  assert.ok(north.length > 5 && south.length > 5, 'stones on both banks');
  for (const stone of bank) {
    const offset = Math.abs(-stone.z - 32 * TILE);
    assert.ok(offset > 6 * TILE - 1.3 && offset < 6 * TILE + 3.01, `stone ${offset} m from the centre line`);
  }
  // Collision needs every stone inside its owner chunk.
  for (const stone of placements) {
    assert.equal(Math.floor(stone.x / TILE / 64), stone.ownerChunkX);
    assert.equal(Math.floor(-stone.z / TILE / 64), stone.ownerChunkZ);
  }
  // Rebuilding one chunk gives the same stones.
  assert.deepEqual(build(3), build(3));
  const keys = new Set(placements.map((placement) => placement.stableId));
  assert.equal(keys.size, placements.length, 'no stone is placed twice across chunks');
});

test('bank runs leave bare gaps, and no stone sits on a fall face', () => {
  const placements = [];
  for (let chunkX = 0; chunkX < 16; chunkX += 1) placements.push(...build(chunkX));
  const possible = 2 * Math.floor(2000 / DEFAULT_RIVERBANK_ROCKS.spacingMeters);
  const bank = placements.filter((placement) => placement.stableId.startsWith('river-rock:bank:'));
  assert.ok(bank.length < possible * 0.8, 'clustered, not a continuous wall of stones');
  const [fall] = collectRiverFallSites([segment()], TILE);
  for (const stone of bank) {
    const along = stone.x;
    assert.ok(along < fall.lipX - 0.5 || along > fall.x + 0.5, 'no bank stone on the face');
  }
});

test('falls get lip boulders and plunge-pool blocks', () => {
  const placements = [];
  for (let chunkX = 0; chunkX < 16; chunkX += 1) placements.push(...build(chunkX));
  const lip = placements.filter((placement) => placement.stableId.startsWith('river-rock:lip:'));
  const plunge = placements.filter((placement) => placement.stableId.startsWith('river-rock:plunge:'));
  assert.equal(lip.length, DEFAULT_RIVERBANK_ROCKS.lipBoulders);
  assert.equal(plunge.length, DEFAULT_RIVERBANK_ROCKS.plungeBlocks);
  const [fall] = collectRiverFallSites([segment()], TILE);
  for (const block of plunge) assert.ok(block.x > fall.x, 'plunge blocks lie downstream of the foot');
});

test('riverbank rocks can be switched off', () => {
  assert.deepEqual(build(3, { config: { ...DEFAULT_RIVERBANK_ROCKS, enabled: false } }), []);
});
