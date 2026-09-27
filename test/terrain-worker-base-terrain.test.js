import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AZGAAR_MACRO_SOURCE_KIND,
  decodeMacroAtlas,
} from '../src/editor/import/AzgaarMacroWorldSource.js';
import { encodeMacroField } from '../src/editor/import/MacroAtlasCodec.js';
import { createTerrainWorkerBaseTerrain } from '../src/editor/world/TerrainWorkerBaseTerrain.js';

/** The fields a terrain worker keeps, mirroring TERRAIN_FIELD_NAMES. */
const TERRAIN_WORKER_FIELDS = [
  'elevation',
  'biomeId',
  'mountainness',
  'ruggedness',
  'valleyness',
];

function source() {
  return {
    kind: AZGAAR_MACRO_SOURCE_KIND,
    version: 2,
    source: { mapId: 7 },
    atlas: {
      width: 1,
      height: 1,
      fields: {
        elevation: encodeMacroField(Uint8Array.of(42), 'u8'),
        biomeId: encodeMacroField(Uint8Array.of(4), 'u8'),
        mountainness: encodeMacroField(Uint8Array.of(200), 'u8'),
        ruggedness: encodeMacroField(Uint8Array.of(30), 'u8'),
        valleyness: encodeMacroField(Uint8Array.of(90), 'u8'),
        // Guidance outside the terrain profile stays on the main world source.
        featureId: encodeMacroField(Uint16Array.of(9), 'u16'),
        simulationOnly: {
          type: 'u8',
          encoding: 'base64-u8-v1',
          data: 'AA==',
          length: 1,
        },
      },
    },
    physical: { widthMeters: 1000, heightMeters: 1000 },
    bounds: { minCellX: 0, minCellZ: 0, widthCells: 10, heightCells: 10 },
    oceanTransitionCells: 4,
    terrain: { minHeight: -20, maxHeight: 80, seaLevel: 0 },
    biomes: [],
    rivers: [{ id: 1, widthAtlas: 0.1, points: [[0, 0], [1, 1]] }],
  };
}

test('v2 guidance sources are compacted to terrain-only terrain-worker payloads', () => {
  const original = source();
  const compact = createTerrainWorkerBaseTerrain(original);

  // The worker clone keeps the current v2 source shape and declares the
  // terrain-worker profile; it is no longer projected to the legacy v1 atlas
  // (heightData/biomeData/featureData) the worker used to receive.
  assert.equal(compact.kind, AZGAAR_MACRO_SOURCE_KIND);
  assert.equal(compact.version, 2);
  assert.equal(compact.profile, 'terrain-worker');
  assert.deepEqual(Object.keys(compact.atlas.fields), TERRAIN_WORKER_FIELDS);
  assert.equal(compact.atlas.width, 1);
  assert.equal(compact.atlas.height, 1);
  assert.deepEqual(Object.keys(compact.atlas).sort(), ['fields', 'height', 'width']);

  // Only the five fields chunk morphology needs survive the compaction.
  assert.equal(compact.atlas.fields.featureId, undefined);
  assert.equal(compact.atlas.fields.simulationOnly, undefined);
  assert.equal(compact.source.mapId, 7);
  assert.equal(compact.oceanTransitionCells, 4);

  const decoded = decodeMacroAtlas(compact);
  assert.deepEqual(decoded.heights, Uint8Array.of(42));
  assert.deepEqual(decoded.biomes, Uint8Array.of(4));
  // A terrain-worker profile carries no feature ids.
  assert.equal(decoded.features, undefined);
  assert.deepEqual(Object.keys(decoded.fields), ['elevation', 'biomeId']);

  original.atlas.fields.elevation.data = 'invalid';
  original.atlas.fields.mountainness.data = 'invalid';
  original.rivers[0].points[0][0] = 99;
  assert.notEqual(compact.atlas.fields.elevation.data, 'invalid');
  assert.notEqual(compact.atlas.fields.mountainness.data, 'invalid');
  assert.equal(compact.rivers[0].points[0][0], 0);
});

test('v2 guidance sources without the terrain fields are rejected for workers', () => {
  const incomplete = source();
  delete incomplete.atlas.fields.ruggedness;
  assert.throws(
    () => createTerrainWorkerBaseTerrain(incomplete),
    /missing field ruggedness/,
  );
});

test('non-v2 terrain sources remain isolated structured clones', () => {
  const original = { kind: 'custom-source', version: 3, nested: { value: 1 } };
  const clone = createTerrainWorkerBaseTerrain(original);

  assert.deepEqual(clone, original);
  assert.notEqual(clone, original);
  original.nested.value = 2;
  assert.equal(clone.nested.value, 1);
});
