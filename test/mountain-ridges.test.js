import assert from 'node:assert/strict';
import test from 'node:test';

import { AZGAAR_STANDARD_BIOMES } from '../src/editor/AzgaarBiomeCatalog.js';
import { encodeMacroField } from '../src/editor/import/MacroAtlasCodec.js';
import { AzgaarMacroWorldGenerator } from '../src/editor/world/AzgaarMacroWorldGenerator.js';
import {
  DEFAULT_MOUNTAIN_RIDGES,
  resolveMountainRidges,
  ridgeHeight,
  ridgedField,
} from '../src/editor/world/MountainRidges.js';
import { validateImportConfig } from '../src/config/validateImportConfig.js';

test('the ridged field folds into crests and stays in range', () => {
  let low = Infinity;
  let high = -Infinity;
  for (let i = 0; i < 4000; i += 1) {
    const value = ridgedField(i * 37.3, i * -11.9, 5);
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  assert.ok(low >= 0 && high <= 1, `${low}..${high}`);
  assert.ok(high - low > 0.5, 'crests and gullies, not a flat field');
  assert.equal(ridgedField(123.4, -567.8, 9), ridgedField(123.4, -567.8, 9));
});

test('ridges rise only on high ground, and continuously', () => {
  const ridges = DEFAULT_MOUNTAIN_RIDGES;
  assert.equal(ridgeHeight(500, 500, 1, 0.2, ridges), 0, 'foothills stay smooth');
  const peak = Array.from({ length: 64 }, (_, i) => Math.abs(ridgeHeight(i * 50, i * 31, 1, 0.9, ridges)));
  assert.ok(Math.max(...peak) > 20, 'high ground carries real relief');
  // One 2 m cell apart the ground moves a little, never a cliff step.
  for (let i = 0; i < 200; i += 1) {
    const x = 1_000_000 + i * 97;
    const step = Math.abs(ridgeHeight(x + 1, 400, 1, 0.9, ridges) - ridgeHeight(x, 400, 1, 0.9, ridges));
    assert.ok(step < 2.5, `step ${step} at ${x}`);
  }
});

test('ridges are an import setting that validates', () => {
  assert.equal(resolveMountainRidges(undefined), null);
  assert.deepEqual(resolveMountainRidges(true), DEFAULT_MOUNTAIN_RIDGES);
  assert.equal(resolveMountainRidges({ heightMeters: 40 }).heightMeters, 40);
  assert.throws(() => resolveMountainRidges({ startRelief: 0.7, fullRelief: 0.5 }), /startRelief < fullRelief/);
  assert.throws(
    () => validateImportConfig({ import: { azgaarAtlasLongEdge: 2000, azgaarRidges: { heightMeters: -1 } } }),
    /Invalid editor configuration/,
  );
});

function createSource(ridges) {
  return {
    kind: 'azgaar-macro-v2',
    version: 2,
    atlas: {
      width: 2,
      height: 2,
      fields: {
        elevation: encodeMacroField(Uint8Array.of(95, 95, 95, 95), 'u8'),
        biomeId: encodeMacroField(Uint8Array.of(10, 10, 10, 10), 'u8'),
        moisture: encodeMacroField(Uint8Array.of(128, 128, 128, 128), 'u8', { scale: 1 / 255 }),
      },
    },
    physical: { widthMeters: 8192, heightMeters: 8192 },
    bounds: { minCellX: 0, minCellZ: 0, widthCells: 4096, heightCells: 4096 },
    oceanTransitionCells: 1,
    terrain: {
      minHeight: -16,
      maxHeight: 48,
      seaLevel: -1.5,
      verticalExaggeration: 40,
      reliefExponent: 1.5,
      ...(ridges ? { ridges } : {}),
    },
    biomes: AZGAAR_STANDARD_BIOMES,
    rivers: [],
  };
}

const metadata = Object.freeze({ seed: 42, version: 1, heightScale: 12, seaLevel: -1.5 });

test('a world imported with ridges carries them near and far; one without is unchanged', () => {
  const smooth = new AzgaarMacroWorldGenerator(createSource(null), metadata);
  const ridged = new AzgaarMacroWorldGenerator(createSource(DEFAULT_MOUNTAIN_RIDGES), metadata);
  let largest = 0;
  for (let i = 0; i < 64; i += 1) {
    const x = 400 + i * 47;
    const z = 900 + i * 29;
    largest = Math.max(largest, Math.abs(ridged.sampleHeight(x, z) - smooth.sampleHeight(x, z)));
    const nearGap = ridged.sampleHeight(x, z) - smooth.sampleHeight(x, z);
    const farGap = ridged.sampleMacroColumn(x, z).height - smooth.sampleMacroColumn(x, z).height;
    assert.ok(Math.abs(nearGap - farGap) < 1e-9, 'the far backdrop carries the same crests');
  }
  assert.ok(largest > 10, `ridges change high ground (${largest} m)`);
  assert.throws(
    () => new AzgaarMacroWorldGenerator(createSource({ heightMeters: 90, startRelief: 0.5, fullRelief: 0.2 }), metadata),
    /terrain ridges/,
  );
});
