import assert from 'node:assert/strict';
import test from 'node:test';
import { GrassBladeProfilePool } from '../src/editor/stylized/GrassBladeProfilePool.js';

const CONFIG = {
  bladeProfiles: {
    set: 'authored',
    sets: {
      authored: { label: 'Authored', profiles: ['field-01'] },
      familyReed: { label: 'Reeds', profiles: ['reed'] },
      familyMeadow: { label: 'Meadow', profiles: ['slender', 'broadleaf'] },
    },
    biomeSets: {
      byTileId: { 12: 'familyReed', 4: 'familyMeadow' },
    },
  },
};

function makePool(config = CONFIG) {
  return new GrassBladeProfilePool({ config, nearSegments: 3, farSegments: 1 });
}

test('an unmapped biome keeps the selected set', () => {
  const pool = makePool();
  assert.equal(pool.setForTile(6), 'authored');
  assert.equal(pool.setForTile(null), 'authored');
  assert.equal(pool.setForTile(undefined), 'authored');
  // Wetland is the mapping the donor called out, and it is the one that must win
  // over the global selection.
  assert.equal(pool.setForTile(12), 'familyReed');
  assert.equal(pool.setForTile(4), 'familyMeadow');
});

test('a biome mapping naming a set that does not exist falls back', () => {
  // A typo in the config should leave grass growing, not blank the field or throw
  // on every chunk build.
  const pool = makePool({
    bladeProfiles: {
      set: 'authored',
      sets: { authored: { profiles: ['field-01'] } },
      biomeSets: { byTileId: { 12: 'neverDefined' } },
    },
  });
  assert.equal(pool.setForTile(12), 'authored');
});

test('each set resolves once and is then reused', () => {
  const pool = makePool();
  const first = pool.forSet('familyReed');
  assert.equal(pool.forSet('familyReed'), first, 'a hot chunk should not re-resolve its set');
  assert.notEqual(pool.forSet('familyMeadow'), first);
  assert.equal(first.near.length, 1);
  assert.equal(first.far.length, 1);
  assert.equal(first.setId, 'familyReed');
  // Near and far are different segment budgets of the same outline, which is what
  // keeps a chunk's silhouette across the band boundary.
  assert.equal(first.near[0].halfWidth.length, 4);
  assert.equal(first.far[0].halfWidth.length, 2);
});

test('selecting a set drops every resolved band, not just the selected one', () => {
  // Otherwise a chunk already wearing a biome set keeps drawing the old shapes and
  // only the chunks that happen to pick the new selection change.
  const pool = makePool();
  const before = pool.forSet('familyReed');
  const revision = pool.revision;
  assert.equal(pool.select('familyMeadow'), true);
  assert.equal(pool.revision, revision + 1);
  assert.notEqual(pool.forSet('familyReed'), before);
  // A repeated selection is a no-op so it cannot rebuild every resident chunk.
  assert.equal(pool.select('familyMeadow'), false);
  assert.equal(pool.select('neverDefined'), false);
});

test('a manifest arriving later invalidates what was resolved without it', () => {
  const pool = makePool();
  const before = pool.forSet('authored');
  // Before the manifest loads, an authored-only set falls back to the generated
  // taper. Caching that would leave the field wearing the wrong shape forever.
  assert.equal(before.near[0].id, 'generated');
  const revision = pool.revision;
  pool.manifest = { profiles: [{ id: 'field-01', halfWidth: [1, 0.5], curve: [0, 0] }] };
  pool.resolve();
  assert.equal(pool.revision, revision + 1);
  const after = pool.forSet('authored');
  assert.equal(after.near[0].id, 'field-01');
});

test('a configured set naming a silhouette family resolves without a manifest', () => {
  const pool = makePool();
  const bands = pool.forSet('familyMeadow');
  assert.deepEqual(bands.near.map((profile) => profile.id), ['slender', 'broadleaf']);
  // Two shapes in one set is what stops a chunk reading as rows of one outline.
  assert.deepEqual(bands.far.map((profile) => profile.id), ['slender', 'broadleaf']);
});
