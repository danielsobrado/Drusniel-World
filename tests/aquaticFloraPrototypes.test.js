import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';
import {
  AQUATIC_FLORA_KINDS,
  createAquaticFloraPrototypes,
} from '../src/editor/stylized/aquaticFloraPrototypes.js';
import { evaluateAquaticPlacement } from '../src/editor/water/AquaticPlacement.js';
import { WATER_KIND_LAKE, WATER_KIND_OCEAN } from '../src/editor/water/WaterConstants.js';

function shippedAquaticPlants() {
  return yaml.load(readFileSync(new URL('../editor.config.yaml', import.meta.url), 'utf8'))
    .stylizedSurface.aquaticPlants;
}

function waterSample({
  kind = WATER_KIND_OCEAN,
  depth = 3,
  shoreDistance = 4,
  coverage = 1,
  flow = 0,
} = {}) {
  return {
    kind,
    coverage,
    depth,
    shoreDistance,
    surfaceHeight: 0,
    bedHeight: -depth,
    flowX: flow,
    flowZ: 0,
  };
}

test('the shipped config yields every species, each with a viable water rule', () => {
  const prototypes = createAquaticFloraPrototypes(shippedAquaticPlants());
  assert.deepEqual(
    prototypes.map((prototype) => prototype.id),
    ['seagrass', 'kelp', 'redAlgae', 'eelgrass', 'waterweed', 'pondweed', 'lilyPad'],
  );
  for (const prototype of prototypes) {
    assert.ok(prototype.parts[0].geometry, `${prototype.id} has no geometry`);
    assert.ok(prototype.parts[0].material, `${prototype.id} has no material`);
    assert.ok(prototype.water.maximumDepth > prototype.water.minimumDepth);
    assert.ok(Array.isArray(prototype.water.allowedKinds) && prototype.water.allowedKinds.length);
    // The rule has to admit a real sample, or the species is configured into
    // nowhere and nothing says so until a lake comes out empty.
    const midDepth = (prototype.water.minimumDepth + prototype.water.maximumDepth) / 2;
    const placed = evaluateAquaticPlacement({
      waterSample: waterSample({
        kind: prototype.water.allowedKinds[0],
        depth: midDepth,
        shoreDistance: 2,
        flow: Math.min(1, prototype.water.maximumCurrent ?? 1),
      }),
      layerRule: null,
      prototypeRule: prototype.water,
    });
    assert.ok(placed, `${prototype.id} would place nothing at its own mid-depth`);
  }
});

test('each species keeps to its own body of water', () => {
  // Kelp is a sea plant and eelgrass is not: a kelp bed in a lake would read as a
  // bug to anyone who has seen either.
  const byId = Object.fromEntries(
    createAquaticFloraPrototypes(shippedAquaticPlants())
      .map((prototype) => [prototype.id, prototype]),
  );
  assert.deepEqual(byId.kelp.water.allowedKinds, [WATER_KIND_OCEAN]);
  assert.deepEqual(byId.eelgrass.water.allowedKinds, [WATER_KIND_LAKE]);
  assert.ok(byId.seagrass.water.allowedKinds.includes(WATER_KIND_OCEAN));
  assert.ok(byId.seagrass.water.allowedKinds.includes(WATER_KIND_LAKE));
});

test('lily pads float on the surface and keep to the bank', () => {
  const pads = createAquaticFloraPrototypes(shippedAquaticPlants())
    .find((prototype) => prototype.id === 'lilyPad');
  assert.equal(pads.water.placement, 'surface');
  // Out in the middle of a lake there is nothing for a pad to root in, which is
  // why the donor keeps them near the shore.
  assert.ok(Number.isFinite(pads.water.maximumShoreDistance));
  assert.ok(pads.water.maximumShoreDistance <= 40);
  const far = evaluateAquaticPlacement({
    waterSample: waterSample({ kind: WATER_KIND_LAKE, depth: 2, shoreDistance: 60 }),
    prototypeRule: pads.water,
  });
  assert.equal(far, null, 'a pad 60 m from the bank should be rejected');
  const near = evaluateAquaticPlacement({
    waterSample: waterSample({ kind: WATER_KIND_LAKE, depth: 2, shoreDistance: 6 }),
    prototypeRule: pads.water,
  });
  assert.ok(near);
  // Placed on the surface, not the bed — that is the whole difference.
  assert.equal(near.waterPlacement, 'surface');
  assert.equal(near.waterPlacementHeight, 0);
});

test('depth bands overlap, so a bed has no line drawn across it', () => {
  const prototypes = createAquaticFloraPrototypes(shippedAquaticPlants());
  const shallowest = Math.min(...prototypes.map((p) => p.water.minimumDepth));
  const deepest = Math.max(...prototypes.map((p) => p.water.maximumDepth));
  // Some species must span a shared depth, or the bed changes character abruptly.
  let shared = 0;
  for (let depth = shallowest; depth < deepest; depth += 0.25) {
    const here = prototypes.filter((p) => (
      p.water.allowedKinds.includes(WATER_KIND_OCEAN)
      && depth >= p.water.minimumDepth
      && depth <= p.water.maximumDepth
    ));
    if (here.length > 1) shared += 1;
  }
  assert.ok(shared > 4, `only ${shared} quarter-metres carry more than one sea species`);
});

test('heights are scaled on the vertical only, so a tall species stays thin', () => {
  // Scaling the blade's width and spread with its height would make kelp as broad
  // as it is tall — the difference between a kelp and a bush.
  const byId = Object.fromEntries(
    createAquaticFloraPrototypes(shippedAquaticPlants())
      .map((prototype) => [prototype.id, prototype]),
  );
  const boxOf = (prototype) => {
    const geometry = prototype.parts[0].geometry;
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    return {
      height: box.max.y - box.min.y,
      width: Math.max(box.max.x - box.min.x, box.max.z - box.min.z),
    };
  };
  const kelp = boxOf(byId.kelp);
  const seagrass = boxOf(byId.seagrass);
  assert.ok(kelp.height > seagrass.height, 'kelp should be the taller plant');
  assert.ok(kelp.height > 1, `kelp is ${kelp.height} m tall`);
  assert.ok(kelp.width < kelp.height, 'kelp should be taller than it is wide');
});

test('a kind this build does not carry leaves the bed standing', () => {
  const prototypes = createAquaticFloraPrototypes({
    proceduralVariants: {
      coral: { kind: 'coral' },
      seagrass: { kind: 'seagrass' },
    },
  });
  assert.deepEqual(prototypes.map((prototype) => prototype.id), ['seagrass']);
});

test('every kind in the table is reachable from config by name', () => {
  // The kinds and the config are two lists that have to agree; a rename in one is
  // a species that silently stops existing.
  const configured = Object.keys(shippedAquaticPlants().proceduralVariants)
    .map((id) => shippedAquaticPlants().proceduralVariants[id].kind ?? id);
  for (const kind of AQUATIC_FLORA_KINDS) {
    assert.ok(configured.includes(kind), `${kind} is not in the shipped config`);
  }
});
