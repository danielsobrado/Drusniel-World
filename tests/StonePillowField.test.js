import assert from 'node:assert/strict';
import test from 'node:test';
import { constructionStoneRoundingProfile } from '../src/editor/construction/config/ConstructionStoneRoundingProfiles.generated.js';
import {
  domeFactor,
  pillowScale,
  sampleStonePillow,
} from '../src/editor/construction/masonry/StonePillowField.js';

const PROFILE = constructionStoneRoundingProfile('rounded-fieldstone');

function sample(overrides = {}) {
  return sampleStonePillow({
    profile: PROFILE,
    seed: 3141,
    stableIndex: 17,
    width: 0.9,
    height: 0.45,
    depth: 0.8,
    ...overrides,
  });
}

test('the same stone always rounds the same way', () => {
  assert.deepEqual(sample(), sample());
  assert.equal(Object.isFrozen(sample()), true);
  assert.equal(Object.isFrozen(sample().front), true);
});

test('sandstone wears each corner independently while preserving rim clearance', () => {
  const profile = constructionStoneRoundingProfile('glade-sandstone');
  let varied = 0;
  for (let stableIndex = 0; stableIndex < 100; stableIndex += 1) {
    const options = { profile, stableIndex, width: 0.43, height: 0.34 };
    const stone = sample(options);
    assert.deepEqual(stone, sample(options));
    if (new Set(stone.cornerRadii).size > 1) varied += 1;
    for (const radius of stone.cornerRadii) {
      assert.ok(radius >= Math.max(stone.front.edgeRadius, stone.back.edgeRadius));
      assert.ok(radius <= 0.34 * 0.48);
    }
  }
  assert.ok(varied > 90, 'rim clearance can clamp the smallest corners equally');
});

test('front and back faces roll and dome independently', () => {
  let differing = 0;
  for (let stableIndex = 0; stableIndex < 40; stableIndex += 1) {
    const { front, back } = sample({ stableIndex });
    if (front.edgeRadius !== back.edgeRadius || front.bulge !== back.bulge) differing += 1;
  }
  assert.ok(differing > 30, `only ${differing} of 40 stones had distinct faces`);
});

test('radii stay inside the stone and the corner never undercuts the rim', () => {
  for (let stableIndex = 0; stableIndex < 200; stableIndex += 1) {
    const width = 0.3 + (stableIndex % 7) * 0.15;
    const height = 0.2 + (stableIndex % 5) * 0.1;
    const depth = 0.3 + (stableIndex % 3) * 0.3;
    const pillow = sample({ stableIndex, width, height, depth });
    const short = Math.min(width, height);
    for (const face of [pillow.front, pillow.back]) {
      assert.ok(face.edgeRadius > 0);
      assert.ok(face.edgeRadius <= short * 0.45 + 1e-12);
      assert.ok(face.edgeRadius <= depth * 0.3 + 1e-12);
      assert.ok(face.edgeRadius <= pillow.cornerRadius + 1e-12);
      assert.ok(face.bulge >= 0);
      assert.ok(face.bulge <= face.edgeRadius * 0.6 + 1e-12);
      assert.ok(face.bulge <= PROFILE.bulge.maximum + 1e-12);
    }
    assert.ok(pillow.cornerRadius <= short * 0.48 + 1e-12);
  }
});

test('field stone rims take the profile share of the short side', () => {
  const pillow = sample({ width: 1, height: 0.45, depth: 0.8 });
  const ratio = pillow.front.edgeRadius / 0.45;
  assert.ok(ratio >= PROFILE.edgeRadius.ratioMin - 1e-9, `ratio ${ratio}`);
  assert.ok(ratio <= PROFILE.edgeRadius.ratioMax + 1e-9, `ratio ${ratio}`);
});

test('dressings are rounded less than field stone, and footing stones more', () => {
  const field = pillowScale(PROFILE, { category: 'field' });
  assert.equal(field, 1);
  for (const category of ['coping', 'ashlar', 'quoin', 'voussoir', 'merlon']) {
    assert.ok(pillowScale(PROFILE, { category }) < field, category);
  }
  assert.ok(pillowScale(PROFILE, { category: 'field', footing: true }) > field);

  const fieldPillow = sample({ category: 'field' });
  const voussoirPillow = sample({ category: 'voussoir' });
  assert.ok(voussoirPillow.front.edgeRadius < fieldPillow.front.edgeRadius);
  assert.ok(voussoirPillow.cornerRadius < fieldPillow.cornerRadius);
});

test('a zero-scale category keeps a softened arris instead of a knife edge', () => {
  const pillow = sample({ category: 'recess' });
  assert.equal(pillow.front.edgeRadius, PROFILE.minimumEdgeRadius);
  assert.equal(pillow.front.bulge, 0);
});

test('the dome never dips behind the rim however it tilts', () => {
  const face = { tiltU: 1, tiltV: -1, saddle: 0.5 };
  for (const u of [-1, -0.5, 0, 0.5, 1]) {
    for (const v of [-1, 0, 1]) {
      const factor = domeFactor(face, u, v);
      assert.ok(factor >= 0.25 && factor <= 1.75, `${u},${v} -> ${factor}`);
    }
  }
  assert.equal(domeFactor(face, 0, 0), 1);
});

test('degenerate stones fail loudly', () => {
  assert.throws(() => sample({ width: 0 }), /degenerate/);
  assert.throws(() => sampleStonePillow({ seed: 1, stableIndex: 1 }), /profile is required/);
});
