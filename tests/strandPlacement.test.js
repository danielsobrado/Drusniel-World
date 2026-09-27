import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STRAND_PLACEMENT_BED,
  STRAND_PLACEMENT_GROUND,
  evaluateStrandPlacement,
  resolveStrandPlacementRule,
} from '../src/editor/stylized/strandPlacement.js';

const GROUND = { placement: STRAND_PLACEMENT_GROUND, minimumAbove: 0.05, maximumAbove: 1.8 };
const BED = { placement: STRAND_PLACEMENT_BED, minimumDepth: 1.2, maximumDepth: 11 };

test('a ground band keeps only the sand just above the waterline', () => {
  const seaLevel = 40;
  // Under water, the swash and foam already draw there.
  assert.equal(evaluateStrandPlacement({ height: 39.5, seaLevel, layerRule: GROUND }), null);
  // On the sand.
  assert.ok(evaluateStrandPlacement({ height: 40.4, seaLevel, layerRule: GROUND }));
  // Above the beach, inland, where the groundcover's band starts.
  assert.equal(evaluateStrandPlacement({ height: 42, seaLevel, layerRule: GROUND }), null);
});

test('the band is measured from sea level, not from zero', () => {
  // A world whose sea sits at 40 m must place exactly as one whose sea sits at 0.
  for (const seaLevel of [0, 40, -12]) {
    const placement = evaluateStrandPlacement({
      height: seaLevel + 0.5,
      seaLevel,
      layerRule: GROUND,
    });
    assert.ok(placement, `sea level ${seaLevel} rejected the beach`);
    assert.equal(placement.strandAbove, 0.5);
    assert.equal(placement.strandDepth, -0.5);
    assert.equal(placement.strandPlacementHeight, seaLevel + 0.5);
  }
});

test('a bed rule counts downwards and rejects the dry', () => {
  const seaLevel = 0;
  assert.equal(evaluateStrandPlacement({ height: 0.4, seaLevel, layerRule: BED }), null);
  assert.equal(evaluateStrandPlacement({ height: -0.5, seaLevel, layerRule: BED }), null);
  const placement = evaluateStrandPlacement({ height: -4, seaLevel, layerRule: BED });
  assert.ok(placement);
  assert.equal(placement.strandDepth, 4);
  assert.equal(placement.strandPlacement, STRAND_PLACEMENT_BED);
  // The stone stands on the bed, so the height it is drawn at is the ground.
  assert.equal(placement.strandPlacementHeight, -4);
  assert.equal(evaluateStrandPlacement({ height: -20, seaLevel, layerRule: BED }), null);
});

test('a prototype rule overrides its layer', () => {
  // How one layer carries several species: the layer sets the broad band and a
  // prototype narrows it, exactly as the aquatic rules already do.
  const evaluation = evaluateStrandPlacement({
    height: 40.9,
    seaLevel: 40,
    layerRule: GROUND,
    prototypeRule: { placement: STRAND_PLACEMENT_GROUND, minimumAbove: 0.05, maximumAbove: 0.6 },
  });
  assert.equal(evaluation, null, 'the prototype band should have rejected this');

  const narrower = evaluateStrandPlacement({
    height: 40.4,
    seaLevel: 40,
    layerRule: GROUND,
    prototypeRule: { placement: STRAND_PLACEMENT_GROUND, minimumAbove: 0.05, maximumAbove: 0.6 },
  });
  assert.ok(narrower);
});

test('a rule that names only one side cannot claim the world', () => {
  // The failure this guards: a half-written rule defaulting the unnamed bound to
  // zero or Infinity and either plastering a species over every chunk in the world
  // or quietly placing nothing anywhere. It fails instead, and the config validator
  // is what reports it before a world ever loads.
  assert.throws(
    () => resolveStrandPlacementRule(null, { placement: STRAND_PLACEMENT_GROUND }),
    /maximumAbove must exceed/,
  );
  // A prototype may name only the band it narrows, though: the layer supplies the
  // rest, which is how one layer carries several species.
  assert.deepEqual(
    resolveStrandPlacementRule(GROUND, { maximumAbove: 0.6 }),
    {
      placement: STRAND_PLACEMENT_GROUND,
      minimumAbove: 0.05,
      maximumAbove: 0.6,
      minimumDepth: 0,
      maximumDepth: 0,
    },
  );
});

test('an inverted or unknown rule fails loudly', () => {
  assert.throws(
    () => resolveStrandPlacementRule({ placement: 'everywhere' }),
    /Unknown strand placement mode/,
  );
  assert.throws(
    () => resolveStrandPlacementRule({ placement: STRAND_PLACEMENT_GROUND, minimumAbove: 2, maximumAbove: 1 }),
    /maximumAbove must exceed/,
  );
  assert.throws(
    () => resolveStrandPlacementRule({ placement: STRAND_PLACEMENT_BED, minimumDepth: 5, maximumDepth: 5 }),
    /maximumDepth must exceed/,
  );
});

test('a missing height or sea level is a rejection, not a throw', () => {
  // Candidates at the edge of a resident window can sample off the terrain, and a
  // layer must not take the frame down over it.
  assert.equal(evaluateStrandPlacement({ height: Number.NaN, seaLevel: 0, layerRule: GROUND }), null);
  assert.equal(evaluateStrandPlacement({ height: 1, seaLevel: undefined, layerRule: GROUND }), null);
});
