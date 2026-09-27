import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';
import { createShoreLifePrototypes } from '../src/editor/stylized/shoreLifePrototypes.js';
import { evaluateStrandPlacement } from '../src/editor/stylized/strandPlacement.js';

function shippedShoreLife() {
  return yaml.load(readFileSync(new URL('../editor.config.yaml', import.meta.url), 'utf8'))
    .stylizedSurface.shoreLife;
}

function radiusOf(part) {
  part.geometry.computeBoundingSphere();
  return part.geometry.boundingSphere.radius;
}

test('the shipped config yields one prototype per species, each with a band', () => {
  const layer = shippedShoreLife();
  const prototypes = createShoreLifePrototypes(layer);
  assert.deepEqual(
    prototypes.map((prototype) => prototype.id),
    ['starfish', 'shell', 'driftwood', 'groundcover'],
  );
  for (const prototype of prototypes) {
    assert.equal(prototype.parts.length, 1);
    assert.ok(prototype.parts[0].geometry, `${prototype.id} has no geometry`);
    assert.ok(prototype.parts[0].material, `${prototype.id} has no material`);
    assert.ok(
      prototype.strand.maximumAbove > prototype.strand.minimumAbove,
      `${prototype.id} has an empty band`,
    );
    assert.equal(prototype.strand.placement, 'ground');
  }
});

test('every shipped species lands on the beach and no two claim the same height', () => {
  // The bands are the whole placement rule, so they are worth reading as a set:
  // driftwood sits highest on the sand, groundcover lives inland of it, and the
  // starfish and shells are in the wet strip between.
  const layer = shippedShoreLife();
  const prototypes = Object.fromEntries(
    createShoreLifePrototypes(layer).map((prototype) => [prototype.id, prototype]),
  );
  const band = (id) => prototypes[id].strand;
  assert.ok(band('starfish').maximumAbove <= band('driftwood').maximumAbove);
  assert.ok(band('shell').minimumAbove < band('starfish').maximumAbove);
  assert.ok(
    band('groundcover').minimumAbove >= band('starfish').maximumAbove,
    'the ground cover should start where the wet sand stops',
  );
  // And the rule they share must actually admit them: a species whose band is
  // outside the layer's would place nothing and never say so.
  for (const [id, prototype] of Object.entries(prototypes)) {
    const height = layer.strand.minimumAbove
      + (prototype.strand.minimumAbove + prototype.strand.maximumAbove) / 2;
    const evaluation = evaluateStrandPlacement({
      height,
      seaLevel: 0,
      layerRule: layer.strand,
      prototypeRule: prototype.strand,
    });
    assert.ok(evaluation, `${id} would place nothing inside the layer band`);
  }
});

test('each shape is built at its own natural size, not the layer scale', () => {
  // One scale band serves the whole layer, so a starfish and a driftwood log can
  // only differ in size because their geometry is authored at that size. If this
  // regresses, the log is starfish-sized and the layer reads as debris.
  const prototypes = Object.fromEntries(
    createShoreLifePrototypes(shippedShoreLife())
      .map((prototype) => [prototype.id, prototype]),
  );
  const starfish = radiusOf(prototypes.starfish.parts[0]);
  const driftwood = radiusOf(prototypes.driftwood.parts[0]);
  const groundcover = radiusOf(prototypes.groundcover.parts[0]);
  // A 12 cm starfish is a 0.12 m sphere; a 1.6 m twig is a good deal larger.
  assert.ok(Math.abs(starfish - 0.12) < 0.02, `starfish radius ${starfish}`);
  assert.ok(driftwood > starfish * 3, `driftwood ${driftwood} vs starfish ${starfish}`);
  assert.ok(groundcover < driftwood, 'a creeping leaf is not a log');
});

test('a variant narrows its own species band, and a disabled one is skipped', () => {
  // Each kind carries its own default band — that is the donor's placement, and it
  // is what the layer's band is a bound around rather than a value that overwrites
  // it. A variant's own numbers win; a disabled variant is not built.
  const prototypes = createShoreLifePrototypes({
    strand: { placement: 'ground', minimumAbove: 0.02, maximumAbove: 26 },
    variants: {
      starfish: { kind: 'starfish', maximumAbove: 0.6 },
      shell: { kind: 'shell' },
      off: { kind: 'shell', enabled: false },
    },
  });
  assert.deepEqual(prototypes.map((prototype) => prototype.id), ['starfish', 'shell']);
  // Narrowed where the config said so...
  assert.equal(prototypes[0].strand.maximumAbove, 0.6);
  // ...and the kind's own default kept where it did not, not the layer's 0.02.
  assert.equal(prototypes[0].strand.minimumAbove, 0.05);
  assert.equal(prototypes[1].strand.minimumAbove, 0.02);
  assert.equal(prototypes[1].strand.maximumAbove, 1.8);
});

test('a kind this build does not carry leaves the rest of the shore standing', () => {
  // A config written against a newer build must not take the world down with it.
  const prototypes = createShoreLifePrototypes({
    strand: { placement: 'ground', minimumAbove: 0.02, maximumAbove: 26 },
    variants: {
      unknown: { kind: 'crab' },
      starfish: { kind: 'starfish' },
    },
  });
  assert.deepEqual(prototypes.map((prototype) => prototype.id), ['starfish']);
});

test('geometry is per prototype, so two variants never share one buffer', () => {
  // The layer disposes each part's geometry on teardown; a shared buffer would be
  // disposed under a live prototype.
  const prototypes = createShoreLifePrototypes({
    strand: { placement: 'ground', minimumAbove: 0.02, maximumAbove: 26 },
    variants: {
      starfish: { kind: 'starfish' },
      shell: { kind: 'shell' },
    },
  });
  assert.notEqual(prototypes[0].parts[0].geometry, prototypes[1].parts[0].geometry);
  assert.notEqual(prototypes[0].parts[0].material, prototypes[1].parts[0].material);
});
