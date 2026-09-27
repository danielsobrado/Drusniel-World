import assert from 'node:assert/strict';
import test from 'node:test';
import { createReachProfile } from '../src/editor/water/RiverReachProfile.js';
import {
  collectRiverFallSites,
  createRiverFallSiteSource,
  RiverFallSiteIndex,
} from '../src/editor/water/RiverFallSites.js';
import { resolveWaterDomainConfig } from '../src/editor/water/WaterConfig.js';
import { createMistParticles, mistParticleCount } from '../src/editor/stylized/mist/mistParticles.js';
import { createSprayPuffPixels } from '../src/editor/stylized/mist/sprayPuffTexture.js';
import { createWaterfallStrandPixels } from '../src/editor/stylized/waterfallStrandTexture.js';

const { falls: fallsConfig } = resolveWaterDomainConfig();

/** A 4 km reach along +cell X at cell Z = 100 with three 12 m steps. */
function segment() {
  const levels = [160, 160, 148, 148, 136, 136, 124, 124];
  return {
    profile: createReachProfile(levels, 4000, fallsConfig),
    ax: 0,
    az: 100,
    dx: 4000,
    dz: 0,
    length: 4000,
    flowX: 1,
    flowZ: 0,
    radiusCells: 20,
  };
}

test('fall sites sit at each face foot in canonical metres, facing downstream', () => {
  const sites = collectRiverFallSites([segment()], 1);
  assert.equal(sites.length, 3);
  for (const site of sites) {
    assert.equal(site.z, -100);
    assert.ok(site.lipX < site.x, 'the lip is upstream of the foot');
    assert.ok(site.top > site.foot);
    assert.ok(Math.abs(site.top - site.foot - site.drop) < site.drop * 0.02);
    assert.deepEqual([site.dirX, site.dirZ], [1, -0]);
    assert.equal(site.widthMeters, 40);
  }
  assert.equal(new Set(sites.map((site) => site.seed)).size, sites.length);
});

test('the site index returns the nearest falls first within the radius', () => {
  const sites = [
    { x: 0, z: 0 }, { x: 900, z: 0 }, { x: 5000, z: 5000 }, { x: -300, z: 200 },
  ];
  const index = new RiverFallSiteIndex(sites);
  assert.deepEqual(index.near(0, 0, 1000), [sites[0], sites[3], sites[1]]);
  assert.deepEqual(index.near(0, 0, 1000, 2), [sites[0], sites[3]]);
  assert.deepEqual(index.near(5000, 4990, 50), [sites[2]]);
});

test('the site source rebuilds only when the world changes', () => {
  let generator = { waterTerrainModel: { config: { cellSizeMeters: 1 }, riverChannel: { segments: [segment()] } } };
  const source = createRiverFallSiteSource(() => generator);
  const first = source();
  assert.ok(first);
  assert.equal(source(), first);
  generator = { waterTerrainModel: { config: { cellSizeMeters: 1 }, riverChannel: null } };
  assert.equal(source(), null);
});

test('mist particles are deterministic, above the water, and scale with the fall', () => {
  const [site] = collectRiverFallSites([segment()], 1);
  const first = createMistParticles(site);
  const second = createMistParticles(site);
  assert.deepEqual(first.spawn, second.spawn);
  assert.equal(first.count, mistParticleCount(site));
  for (let index = 0; index < first.count; index += 1) {
    const [, y, , waterLevel] = first.spawn.subarray(index * 4, index * 4 + 4);
    assert.ok(y > waterLevel, 'each puff is born above the water it rises from');
    assert.ok(first.shape[index * 4 + 2] > 0);
  }
  const small = { ...site, drop: 3, widthMeters: 8 };
  assert.ok(mistParticleCount(small) < first.count);
});

test('the procedural waterfall textures are equalized and bordered', () => {
  const strands = createWaterfallStrandPixels({ width: 64, height: 16 });
  const red = [];
  for (let index = 0; index < strands.data.length; index += 4) red.push(strands.data[index]);
  const mean = red.reduce((sum, value) => sum + value, 0) / red.length;
  assert.ok(Math.abs(mean - 127.5) < 6, `strands are rank-equalized (mean ${mean})`);

  const puffs = createSprayPuffPixels({ size: 32 });
  for (let channel = 0; channel < 4; channel += 1) {
    assert.equal(puffs.data[channel], 0, 'the billboard corner is clear');
    const centre = ((16 * 32) + 16) * 4 + channel;
    assert.ok(puffs.data[centre] > 100, 'the puff is dense in the middle');
  }
});
