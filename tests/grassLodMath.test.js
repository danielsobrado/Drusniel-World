import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bladeLengthFraction,
  clumpSpacing,
  clumpsFormCarpet,
  clumpsPerCell,
  densityForDistance,
  dominantEligibleTile,
  grassContinuousDensity,
  grassInstanceAttributeBytes,
  grassLodBand,
  grassLodCoverage,
  grassLodPresence,
  grassLodWiden,
  trianglesPerBlade,
} from '../src/editor/stylized/grassLodMath.js';

test('grass clumping preserves effective blade density with fewer instances', () => {
  assert.equal(clumpsPerCell(48, 8), 6);
  const bytes = grassInstanceAttributeBytes({
    chunkSize: 64,
    bladesPerCell: 48,
    bladesPerClump: 8,
  });
  assert.equal(bytes, 64 * 64 * 6 * 7 * 4);
  assert.ok(bytes < 1024 * 1024);
});

test('outer-ring density is monotonic', () => {
  assert.equal(densityForDistance(0, 2, 0.4), 1);
  assert.equal(densityForDistance(2, 2, 0.4), 0.4);
  assert.ok(densityForDistance(1, 2, 0.4) < 1);
});

test('the far blade band is a fifth of the near band per blade', () => {
  assert.equal(trianglesPerBlade(3), 5);
  assert.equal(trianglesPerBlade(1), 1);
  // The saving is what pays for the extra ring of grass.
  assert.equal(trianglesPerBlade(3) / trianglesPerBlade(1), 5);
  assert.throws(() => trianglesPerBlade(0), /positive integer/);
  assert.throws(() => trianglesPerBlade(1.5), /positive integer/);
});

test('the shipped clump radius overlaps clumps into continuous cover', () => {
  // Regression guard for grass reading as separate tufts on bare ground. Values
  // mirror editor.config.yaml: tileSize 2, blades 576/96, clumpRadius 0.75 m.
  const tileSize = 2;
  const clumps = clumpsPerCell(576, 96);

  const spacing = clumpSpacing(clumps, tileSize);
  assert.ok(Math.abs(spacing - 0.8165) < 0.001, `spacing ${spacing}`);
  assert.ok(clumpsFormCarpet(0.75, clumps, tileSize), 'clumps leave gaps');

  // Half that radius must still read as tufts — otherwise this test is not
  // measuring anything.
  assert.equal(clumpsFormCarpet(0.36, clumps, tileSize), false);
});

test('clump footprint no longer moves with blade width', () => {
  // The radius used to be expressed in blade-widths and resolved against the
  // instance width, so narrowing the blades to stop them reading as ribbons also
  // shrank every clump. At the shipped 0.023 m mean width the old model gave
  // 12.5 * 0.023 = 0.29 m — inside the tuft range this same test rejects above.
  const tileSize = 2;
  const clumps = clumpsPerCell(576, 96);
  assert.equal(clumpsFormCarpet(12.5 * 0.023, clumps, tileSize), false);
  // The metre-denominated radius is unmoved by the same narrowing, which is the
  // whole point of separating the two.
  assert.ok(clumpsFormCarpet(0.75, clumps, tileSize));
});

test('the shipped length skew gives a mostly-short sward with a tall minority', () => {
  // Pins the split editor.config.yaml documents. A flat roll over 0.10–0.32 puts
  // most blades near 0.21 m, which reads as a mown lawn; sward is mostly short.
  const minLength = 0.10;
  const maxLength = 0.32;
  const skew = 5.0;
  const samples = 100000;
  let short = 0;
  let medium = 0;
  let tall = 0;
  let total = 0;
  for (let index = 0; index < samples; index += 1) {
    const length = minLength
      + bladeLengthFraction((index + 0.5) / samples, skew) * (maxLength - minLength);
    total += length;
    if (length < 0.16) short += 1;
    else if (length < 0.24) medium += 1;
    else tall += 1;
  }
  const percent = (count) => (count / samples) * 100;
  assert.ok(percent(short) > 70 && percent(short) < 80, `short ${percent(short)}%`);
  assert.ok(percent(medium) > 10 && percent(medium) < 20, `medium ${percent(medium)}%`);
  assert.ok(percent(tall) > 5 && percent(tall) < 12, `tall ${percent(tall)}%`);
  // The mean matters as much as the split: it is what apparent coverage scales
  // with, and it is why the config points at bladesPerCell as the compensation.
  assert.ok(Math.abs(total / samples - 0.137) < 0.005, `mean ${total / samples}`);
});

test('an unskewed roll is the flat distribution the skew replaces', () => {
  assert.equal(bladeLengthFraction(0.5), 0.5);
  assert.equal(bladeLengthFraction(0.5, 1), 0.5);
  // Monotone, which is what lets blade width keep correlating against the raw rank
  // instead of the skewed value.
  assert.ok(bladeLengthFraction(0.8, 5) > bladeLengthFraction(0.3, 5));
  // Clamped, so a roll that lands slightly outside [0, 1] cannot invert a blade.
  assert.equal(bladeLengthFraction(-0.2, 5), 0);
  assert.equal(bladeLengthFraction(1.4, 5), 1);
});

test('chunks switch to the cheap blade band past the near radius', () => {
  assert.equal(grassLodBand(0, 1), 'near');
  assert.equal(grassLodBand(1, 1), 'near');
  assert.equal(grassLodBand(2, 1), 'far');
  // nearRadius equal to residentRadius keeps every ring on full-shape blades,
  // which is the pre-band behaviour.
  assert.equal(grassLodBand(2, 2), 'near');
});

// The ring law the compaction can only approximate, and the coverage that closes
// the gap between the two. Everything below is about the seam between rings: the
// compaction can only keep whole clumps per cell, so neighbouring rings hold
// different populations and the coverage is what makes the boundary continuous.
const RING_LAW = Object.freeze({
  radiusMeters: 2 * 128,
  farDensity: 0.45,
});
const ringDensity = (ring) => densityForDistance(ring, 2, RING_LAW.farDensity);
const coverageFor = (ring, distanceMeters) => grassLodCoverage({
  distanceMeters,
  bandDensity: ringDensity(ring),
  ...RING_LAW,
});

test('the smooth law is continuous where the per-ring law steps', () => {
  const stepped = [ringDensity(0), ringDensity(1), ringDensity(2)];
  assert.deepEqual(stepped.map((d) => Number(d.toFixed(4))), [1, 0.725, 0.45]);
  // Half a ring past ring 1's start the per-ring law is still saying 0.725 while
  // the smooth law has already fallen between the two steps.
  const midRing = 128 * 1.5;
  const smooth = grassContinuousDensity(midRing, RING_LAW);
  assert.ok(smooth < stepped[1] && smooth > stepped[2], `smooth ${smooth}`);
});

test('coverage closes the gap wherever the compaction is too dense', () => {
  // The invariant that makes the seam safe: whatever population a chunk was
  // compacted to, blades x coverage never exceeds the smooth law, and matches it
  // wherever the compaction over-shot. Two chunks either side of a residency edge
  // therefore agree, even though one was built at 100% and the other at 45%.
  for (const ring of [0, 1, 2]) {
    for (const metres of [10, 64, 128, 160, 200, 256]) {
      const coverage = coverageFor(ring, metres);
      const realised = ringDensity(ring) * coverage;
      const smoothed = grassContinuousDensity(metres, RING_LAW);
      assert.ok(
        Math.abs(realised - Math.min(ringDensity(ring), smoothed)) < 1e-9,
        `ring ${ring} at ${metres} m: realised ${realised} vs smooth ${smoothed}`,
      );
    }
  }
});

test('the residency edge is where both rings agree', () => {
  // This is the seam the thinning exists for. Ring 0 is compacted at full density
  // and ring 1 at 72.5%; without coverage the field steps 100% -> 72.5% across the
  // boundary in one metre. With it the inner ring has thinned all the way down to
  // what the outer ring holds before the two meet, so neither a bright band nor a
  // bald one is left at the join.
  assert.equal(coverageFor(0, 128), ringDensity(1));
  assert.equal(coverageFor(1, 128), 1);
  assert.equal(ringDensity(0) * coverageFor(0, 128), ringDensity(1) * coverageFor(1, 128));
  // Just inside, the inner ring is already most of the way down rather than
  // holding full density until the last metre.
  assert.ok(coverageFor(0, 112) < 1 && coverageFor(0, 112) > ringDensity(1));
});

test('coverage only ever thins a chunk, never multiplies it up', () => {
  // The compaction can only keep whole clumps per cell, so it lands above or
  // below the smooth law. Retiring can correct the first case for free; the
  // second would need blades that are not in the buffer, so it is left alone
  // rather than faked. A chunk near the camera on a sparse ring is the one case
  // this leaves as it was.
  for (const ring of [0, 1, 2]) {
    for (const metres of [0, 32, 96, 128, 192, 256, 400]) {
      const coverage = coverageFor(ring, metres);
      assert.ok(coverage >= 0 && coverage <= 1, `ring ${ring} at ${metres} m gave ${coverage}`);
    }
  }
  assert.equal(coverageFor(1, 10), 1, 'a sparse ring close in must not be reported as thinned');
});

test('the camera chunk keeps its density until it is far enough out to lose it', () => {
  assert.equal(coverageFor(0, 0), 1);
  // Ring 0 is compacted at 100% and the smooth law only reaches 45% at the
  // residency radius, so the near part of it is untouched...
  assert.ok(coverageFor(0, 64) > 0.85, `coverageFor(0, 64) = ${coverageFor(0, 64)}`);
  // ...and it is the far corner, where the next ring's grass lives, that thins.
  assert.ok(coverageFor(0, 250) < 0.5);
});

test('coverage is monotone in distance and reaches zero past the fade', () => {
  const fading = (metres) => grassLodCoverage({
    distanceMeters: metres,
    bandDensity: ringDensity(2),
    ...RING_LAW,
    fadeMeters: 64,
  });
  let previous = 2;
  for (let metres = 0; metres <= 256; metres += 8) {
    const coverage = fading(metres);
    assert.ok(coverage <= previous + 1e-9, `coverage rose at ${metres} m`);
    previous = coverage;
  }
  // Without a fade the last ring simply stops at the residency edge.
  assert.ok(grassContinuousDensity(256, RING_LAW) > 0);
  // With one, the field has thinned to nothing by the end of the tail — which is
  // what hands the distance over to the terrain shader's faked ground cover.
  assert.equal(grassContinuousDensity(320, { ...RING_LAW, fadeMeters: 64 }), 0);
  assert.equal(fading(320), 0);
});

test('blades retire by rank so the chunk thins instead of snapping', () => {
  const rank = (index) => (index + 0.5) / 1000;
  const survivingShare = (coverage) => {
    let alive = 0;
    for (let index = 0; index < 1000; index += 1) {
      if (grassLodPresence(rank(index), coverage) > 0.5) alive += 1;
    }
    return alive / 1000;
  };
  assert.equal(survivingShare(0), 0);
  for (const coverage of [0.2, 0.45, 0.725, 0.9]) {
    // The share still standing is the coverage — that is what makes the retired
    // population follow the density law rather than the blade count.
    assert.ok(
      Math.abs(survivingShare(coverage) - coverage) < 0.02,
      `coverage ${coverage} kept ${survivingShare(coverage)}`,
    );
  }
  // At full coverage no blade is retired. It cannot promise every blade is whole —
  // the top of the window is still part-way out — but half-retired is the worst
  // case, which is what keeps a full-density chunk free of visible gaps.
  let worst = 1;
  for (let index = 0; index < 1000; index += 1) {
    worst = Math.min(worst, grassLodPresence(rank(index), 1));
  }
  assert.ok(worst >= 0.5, `a blade was ${worst} present at full coverage`);
  // The tail closes exactly, or the last ring would keep a residue of half-width
  // blades past the end of the fade instead of handing over to the terrain.
  for (let index = 0; index < 1000; index += 1) {
    assert.equal(grassLodPresence(rank(index), 0), 0);
  }
  // Every blade leaves at its own distance rather than the whole chunk snapping
  // at once: right at the threshold, higher ranks are already on their way out
  // while lower ones are still whole.
  const threshold = 0.5;
  assert.equal(grassLodPresence(0.4, threshold), 1);
  assert.equal(grassLodPresence(0.6, threshold), 0);
  assert.ok(Math.abs(grassLodPresence(0.5, threshold) - 0.5) < 1e-9);
  const ramping = [0.42, 0.46, 0.5, 0.54, 0.58]
    .map((r) => grassLodPresence(r, threshold));
  for (let index = 1; index < ramping.length; index += 1) {
    assert.ok(ramping[index] <= ramping[index - 1], 'presence should not rise with rank');
  }
  // Flat at both ends — a blade either side of the window is whole or gone — and a
  // real ramp in the middle, which is the part that spreads the retreat over
  // distance instead of snapping the chunk.
  assert.equal(ramping[0], 1);
  assert.equal(ramping[ramping.length - 1], 0);
  assert.ok(ramping.some((value) => value > 0 && value < 1), 'no blade is mid-retirement');
  // Rank is clamped, so a roll that lands on 1 is the worst case in the window
  // rather than an escape from it.
  assert.ok(grassLodPresence(1, 1) >= 0.5);
  assert.equal(grassLodPresence(1, 0), 0);
  assert.equal(grassLodPresence(2, 1), grassLodPresence(1, 1));
});

test('survivors widen as the field thins, within the fill budget', () => {
  assert.equal(grassLodWiden(1), 1);
  assert.equal(grassLodWiden(0.5), 1.35);
  assert.equal(grassLodWiden(0), 1.35);
  // Uncapped the compensation would run away on a blade that is nearly gone.
  assert.equal(grassLodWiden(0.01, { maximumWiden: 4 }), 4);
  // Compensation 0 leaves the width alone and lets the carpet genuinely thin.
  assert.equal(grassLodWiden(0.5, { compensation: 0 }), 1);
  assert.ok(grassLodWiden(0.5, { compensation: 0.5 }) < grassLodWiden(0.5));
  for (const coverage of [0, 0.3, 1]) {
    assert.ok(grassLodWiden(coverage) >= 1);
  }
});

test('the dominant biome of a chunk is a majority vote over its eligible cells', () => {
  const tiles = new Uint8Array([3, 3, 3, 4, 4, 12, 12]);
  assert.equal(dominantEligibleTile(tiles, [3, 4, 12]), 3);
  // A minority tile a chunk only clips still wins if it is the majority of what
  // the chunk actually grows on — that is the whole point of voting per chunk.
  assert.equal(dominantEligibleTile(tiles, [12]), 12);
  // Ineligible biomes do not vote, or a chunk mostly under water would be judged
  // by its water.
  assert.equal(dominantEligibleTile(new Uint8Array([0, 0, 0, 0, 3]), [3]), 3);
  assert.equal(dominantEligibleTile(new Uint8Array([0, 1, 2]), [3, 4]), null);
  // A tie goes to the lower id so the answer cannot depend on scan order.
  assert.equal(dominantEligibleTile(new Uint8Array([4, 3]), [3, 4]), 3);
  assert.equal(dominantEligibleTile(new Uint8Array([3, 4]), [3, 4]), 3);
});
