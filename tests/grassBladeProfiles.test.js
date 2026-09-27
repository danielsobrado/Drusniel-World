import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GENERATED_PROFILE_ID,
  GENERATED_SHAPE_IDS,
  describeProfileSets,
  generatedProfile,
  resampleProfile,
  resolveProfileSet,
  shapedProfile,
} from '../src/editor/stylized/grassBladeProfiles.js';

const AUTHORED = {
  id: 'stylized-01',
  // Narrow base, plateau low, fine tip — the shape the alpha cards actually carry,
  // and the opposite of the generated taper.
  halfWidth: [0.2, 0.8, 1, 0.9, 0.1],
  curve: [0, -0.01, -0.03, -0.06, -0.1],
  aspect: 0.066,
};
const MANIFEST = { profiles: [AUTHORED] };
const SETS = {
  generated: { label: 'Baseline', profiles: [GENERATED_PROFILE_ID] },
  authored: { label: 'Authored', profiles: ['stylized-01'] },
  mixed: { label: 'Mixed', profiles: ['stylized-01', GENERATED_PROFILE_ID] },
  unbaked: { label: 'Unbaked', profiles: ['stylized-01', 'never-extracted'] },
};

test('resampling lands one row per segment boundary plus the tip', () => {
  for (const segments of [1, 3, 5]) {
    const resampled = resampleProfile(AUTHORED, segments);
    assert.equal(resampled.halfWidth.length, segments + 1);
    assert.equal(resampled.curve.length, segments + 1);
    // The ends are the authored ends, not an interpolation toward them: a blade
    // whose base crept inward would leave a gap over the ground.
    assert.equal(resampled.halfWidth[0], AUTHORED.halfWidth[0]);
    assert.equal(resampled.curve[0], AUTHORED.curve[0]);
    assert.equal(resampled.curve[segments], AUTHORED.curve.at(-1));
  }
});

test('the authored outline survives the near band it is drawn at', () => {
  // Three segments is the whole near-band budget, so if the profile's defining
  // feature — wider above the base than at it — does not survive resampling, the
  // authored silhouette never reaches the screen.
  const resampled = resampleProfile(AUTHORED, 3);
  assert.ok(
    resampled.halfWidth[1] > resampled.halfWidth[0],
    'blade must still widen above its base at near-band resolution',
  );
  assert.ok(resampled.curve[3] < resampled.curve[0], 'the arc must survive too');
});

test('the generated taper is widest at the base', () => {
  const generated = resampleProfile(generatedProfile(), 3);
  assert.equal(generated.halfWidth[0], 1);
  for (let i = 1; i < generated.halfWidth.length; i += 1) {
    assert.ok(generated.halfWidth[i] < generated.halfWidth[i - 1]);
  }
  assert.deepEqual([...generated.curve], [0, 0, 0, 0]);
});

test('a set resolves to every profile it names, in order', () => {
  const resolved = resolveProfileSet({
    manifest: MANIFEST, sets: SETS, setId: 'mixed', segments: 3,
  });
  assert.deepEqual(resolved.map((profile) => profile.id), ['stylized-01', GENERATED_PROFILE_ID]);
});

test('a set naming nothing bakeable still draws grass', () => {
  // The manifest is a build artifact. A stale or missing one has to degrade to a
  // duller field, not an empty world.
  for (const [manifest, setId] of [[null, 'authored'], [MANIFEST, 'missing-set'], [{ profiles: [] }, 'authored']]) {
    const resolved = resolveProfileSet({ manifest, sets: SETS, setId, segments: 3 });
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].id, GENERATED_PROFILE_ID);
  }
});

test('a partly baked set is offered but reported as incomplete', () => {
  // Hiding it would make an un-run extraction script look like a missing feature.
  const described = describeProfileSets({ manifest: MANIFEST, sets: SETS });
  const unbaked = described.find((set) => set.id === 'unbaked');
  assert.deepEqual(
    { requested: unbaked.requested, resolved: unbaked.resolved, complete: unbaked.complete },
    { requested: 2, resolved: 1, complete: false },
  );
  assert.equal(described.find((set) => set.id === 'authored').complete, true);
  // `generated` is not in the manifest and must not be counted as missing.
  assert.equal(described.find((set) => set.id === 'generated').complete, true);
});

test('the donor silhouette families are offered without an asset to bake', () => {
  // These are generated outlines, so a set naming only them resolves against an
  // empty manifest. That is the whole point of them: a biome can be given a
  // silhouette without anything to extract first.
  const sets = Object.fromEntries(GENERATED_SHAPE_IDS.map((id) => [id, { profiles: [id] }]));
  const described = describeProfileSets({ manifest: null, sets });
  for (const id of GENERATED_SHAPE_IDS) {
    assert.equal(described.find((set) => set.id === id).complete, true, `${id} reported incomplete`);
    const resolved = resolveProfileSet({ manifest: null, sets, setId: id, segments: 3 });
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].id, id);
  }
});

test('every silhouette family is a distinct outline, not a rescale of one', () => {
  const halfWidthAt = (id, t) => {
    const profile = shapedProfile(id);
    // Sampled rather than indexed, because the shapes are defined by continuous
    // functions and the arrays are just their samples.
    const last = profile.halfWidth.length - 1;
    const position = Math.round(t * last);
    return profile.halfWidth[position];
  };
  // Slender tapers evenly; a reed holds near-full width most of the way up and
  // then collapses into the tip; a broadleaf is widest at the base with a round
  // shoulder. Checked mid-height, where the three actually differ.
  assert.ok(halfWidthAt('reed', 0.5) > halfWidthAt('slender', 0.5));
  assert.ok(halfWidthAt('broadleaf', 0.5) > halfWidthAt('slender', 0.5));
  // The reed's collapse is the point of it: nearly the same width at half height
  // as at a quarter, and almost gone by the top. Slender has halved by then.
  const reedHold = halfWidthAt('reed', 0.5) / halfWidthAt('reed', 0.25);
  assert.ok(reedHold > 0.95, `reed should hold its width, ratio ${reedHold}`);
  assert.ok(halfWidthAt('reed', 0.97) < 0.2, 'reed should collapse into its tip');
  assert.ok(halfWidthAt('slender', 0.5) / halfWidthAt('slender', 0.25) < 0.7);
  // ...and its character includes being thin overall: the donor's 0.55 scale comes
  // through as a profile-level scale, so the instance width roll cannot undo it.
  assert.ok(shapedProfile('reed').widthScale < shapedProfile('slender').widthScale);
  assert.ok(shapedProfile('broadleaf').widthScale < shapedProfile('slender').widthScale);
  // Normalized, so "halfWidth" keeps meaning "units of this blade's widest point".
  for (const id of GENERATED_SHAPE_IDS) {
    const profile = shapedProfile(id);
    assert.equal(Math.max(...profile.halfWidth), 1, `${id} is not normalized`);
    assert.ok(profile.halfWidth.every((value) => value >= 0 && value <= 1), `${id} leaves [0,1]`);
    assert.ok(profile.curve.every((value) => value === 0), `${id} should not arc`);
  }
  assert.equal(shapedProfile('tufted'), null, 'the donor billboard family has no blade profile');
  assert.equal(shapedProfile('nonsense'), null);
});

test('the silhouette scale survives resampling and defaults where there is none', () => {
  // The geometry reads it per blade, off whichever shape that blade rolled, so it
  // has to travel with the profile rather than with the set.
  assert.equal(resampleProfile(shapedProfile('reed'), 3).widthScale, 0.55);
  assert.equal(resampleProfile(shapedProfile('slender'), 3).widthScale, 1);
  // An extracted profile predates the field and must read as unscaled.
  assert.equal(resampleProfile(AUTHORED, 3).widthScale, 1);
});
