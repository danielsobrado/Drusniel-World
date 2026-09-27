import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';
import {
  burgToNormalized,
  canonicalWorldToNormalized,
  findNearestLandCell,
  normalizedToCanonicalWorld,
} from '../src/editor/map/worldMapCoordinates.js';
import { importAzgaarFullJson } from '../src/editor/import/AzgaarJsonImporter.js';
import { AzgaarMacroWorldGenerator } from '../src/editor/world/AzgaarMacroWorldGenerator.js';
import { worldToCell } from '../src/editor/world/WorldCoordinates.js';

// The importer derives the macro world's tuning from the Azgaar guidance
// document; without it AzgaarWorldGuidance rejects the configuration.
const guidanceConfig = yaml.load(readFileSync(
  new URL('../config/azgaar-guidance.yaml', import.meta.url),
  'utf8',
));

function createConfig() {
  return {
    map: { tileSize: 2 },
    import: {
      azgaarAtlasLongEdge: 4,
      azgaarOceanTransitionKilometers: 50,
      azgaarGuidance: guidanceConfig,
    },
    world: {
      seed: 918273,
      generatorVersion: 1,
      chunkSize: 2,
      heightScale: 12,
      seaLevel: -1.5,
    },
    terrain: { minHeight: -16, maxHeight: 48 },
    voxelPrototype: { cells: [24, 16, 24] },
  };
}

function createAzgaarDocument() {
  return {
    info: {
      description: "Azgaar's Fantasy Map Generator output: azgaar.github.io/Fantasy-map-generator",
      version: '1.99',
      mapId: 'test-map',
      mapName: 'Test Realm',
      width: 1000,
      height: 800,
      seed: 'abc123',
    },
    grid: {
      cellsX: 2,
      cellsY: 2,
      seed: 'abc123',
      cells: [
        { i: 0, h: 0 },
        { i: 1, h: 35 },
        { i: 2, h: 82 },
        { i: 3, h: 45 },
      ],
    },
    pack: {
      cells: [
        { i: 0, g: 0, h: 0, biome: 0 },
        { i: 1, g: 1, h: 35, biome: 1 },
        { i: 2, g: 2, h: 82, biome: 2 },
        { i: 3, g: 3, h: 45, biome: 3 },
      ],
      states: [{ i: 1, name: 'Northreach' }],
      provinces: [],
      cultures: [],
      religions: [],
      burgs: [{ i: 1, name: 'Harborwatch', x: 700, y: 200, state: 1, capital: 1 }],
      rivers: [],
      routes: [],
      markers: [],
      zones: [],
    },
    biomesData: {
      name: ['Marine', 'Temperate deciduous forest', 'Hot desert', 'Wetland'],
    },
    notes: [],
  };
}

test('normalized <-> canonical world round-trips within one cell', () => {
  const bounds = { minCellX: -100, minCellZ: -50, widthCells: 200, heightCells: 100 };
  const tileSize = 2;
  for (const [nx, nz] of [[0, 0], [0.5, 0.5], [1, 1], [0.13, 0.87]]) {
    const world = normalizedToCanonicalWorld(nx, nz, bounds, tileSize);
    const back = canonicalWorldToNormalized(world.x, world.z, bounds, tileSize);
    assert.ok(Math.abs(back.nx - nx) < 1 / bounds.widthCells + 1e-9);
    assert.ok(Math.abs(back.nz - nz) < 1 / bounds.heightCells + 1e-9);
  }
});

test('burgToNormalized matches simple source-space division', () => {
  const source = { sourceWidth: 1000, sourceHeight: 800 };
  const burg = { x: 700, y: 200 };
  const { nx, nz } = burgToNormalized(burg, source);
  assert.equal(nx, 0.7);
  assert.equal(nz, 0.25);
});

test('a burg teleport target lands inside the imported world bounds and matches the macro generator atlas position', () => {
  const config = createConfig();
  const document = createAzgaarDocument();
  const converted = importAzgaarFullJson(document, config);
  const { campaign } = converted;
  const baseTerrain = converted.world.baseTerrain;
  const bounds = campaign.source.target;
  const burg = campaign.burgs[0];

  const { nx, nz } = burgToNormalized(burg, campaign.source);
  const world = normalizedToCanonicalWorld(nx, nz, bounds, config.map.tileSize);
  const cell = worldToCell(world.x, world.z, config.map.tileSize);

  assert.ok(cell.x >= bounds.minCellX && cell.x < bounds.minCellX + bounds.widthCells);
  assert.ok(cell.z >= bounds.minCellZ && cell.z < bounds.minCellZ + bounds.heightCells);

  const generator = new AzgaarMacroWorldGenerator(baseTerrain, {
    seed: config.world.seed,
    version: config.world.generatorVersion,
    heightScale: config.world.heightScale,
    seaLevel: config.world.seaLevel,
  });
  const atlasFromGenerator = generator.toAtlasPosition(cell.x, cell.z);
  const atlasFromBurg = { x: nx * baseTerrain.atlas.width, y: nz * baseTerrain.atlas.height };
  assert.ok(Math.abs(atlasFromGenerator.x - atlasFromBurg.x) <= 1);
  assert.ok(Math.abs(atlasFromGenerator.y - atlasFromBurg.y) <= 1);
});

test('findNearestLandCell returns the query cell unchanged when it is already land', () => {
  const isLand = () => true;
  const result = findNearestLandCell(10, -4, isLand, { stepCells: 3, maxRings: 8 });
  assert.deepEqual({ x: result.x, z: result.z, snapped: result.snapped, found: result.found }, {
    x: 10, z: -4, snapped: false, found: true,
  });
});

test('findNearestLandCell snaps a water click to the nearest land cell in atlas steps', () => {
  // Land only exists at a single cell 6 steps east of the query.
  const landX = 0 + 2 * 5; // stepCells 5, two rings east
  const isLand = (x, z) => x === landX && z === 0;
  const result = findNearestLandCell(0, 0, isLand, { stepCells: 5, maxRings: 8 });
  assert.equal(result.snapped, true);
  assert.equal(result.found, true);
  assert.equal(result.x, landX);
  assert.equal(result.z, 0);
});

test('findNearestLandCell picks the closest land when several are in range', () => {
  // Land at +1 step west and +3 steps east; nearest (west) must win.
  const isLand = (x, z) => z === 0 && (x === -4 || x === 12);
  const result = findNearestLandCell(0, 0, isLand, { stepCells: 4, maxRings: 8 });
  assert.equal(result.x, -4);
  assert.equal(result.snapped, true);
});

test('findNearestLandCell reports not found when no land is within range', () => {
  const isLand = () => false;
  const result = findNearestLandCell(0, 0, isLand, { stepCells: 4, maxRings: 3 });
  assert.deepEqual({ x: result.x, z: result.z, snapped: result.snapped, found: result.found }, {
    x: 0, z: 0, snapped: false, found: false,
  });
});
