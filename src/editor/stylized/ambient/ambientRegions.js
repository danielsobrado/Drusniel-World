import { ringPoints } from '../../world/sampleTilesAround.js';

/**
 * Where the focus is, as the ambient layer's regions (after grass-test's
 * ambientRegions): 0..1 weights for snow, sand, surf, jungle, water (lake or
 * river nearby), lake (on a lake) and meadow (open ground, none of the
 * others), plus the water levels fields can float on.
 *
 * Tiles are the Azgaar biome ids; water kinds as WaterConstants numbers them.
 */
// The donor's jungle is closed rainforest: mist, spores and canopy shafts. A
// tropical seasonal forest (5) is open, dry woodland over grass, so it reads as
// meadow — the soundscape keeps its jungle calls (soundscape_weights.js).
const JUNGLE = new Set([7]);
const MEADOW = new Set([3, 4, 5, 6, 8, 14]);
const HOT_DESERT = 1;
const WATER_OCEAN = 1;
const WATER_LAKE = 2;
const WATER_RIVER = 3;

const RINGS = Object.freeze([0, 12, 40, 110, 220]);
const DIRECTIONS = 8;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

/**
 * @param {object} surroundings
 * @param {number[]} surroundings.tiles biome ids at `ringPoints`
 * @param {number[]} surroundings.water water kinds at the same points
 * @param {number} surroundings.heightAboveSea focus ground, metres
 * @param {number} surroundings.snow 0..1 snow-country weight
 */
export function ambientRegionWeights({ tiles, water, heightAboveSea, snow }) {
  const count = Math.max(1, tiles.length);
  const shareOf = (values, test) => values.reduce((total, value) => total + (test(value) ? 1 : 0), 0) / count;
  const snowWeight = clamp01(snow);
  const ocean = shareOf(water, (kind) => kind === WATER_OCEAN);
  const fresh = shareOf(water, (kind) => kind === WATER_LAKE || kind === WATER_RIVER);
  // The first ring (the focus plus 12 m) decides whether you are on a lake.
  const inner = 1 + DIRECTIONS;
  const onLake = water.slice(0, inner).filter((kind) => kind === WATER_LAKE).length / inner;
  const jungle = shareOf(tiles, (tile) => JUNGLE.has(tile));
  const surf = clamp01(Math.sqrt(ocean) * 1.3);
  // Open sand: by the sea on low ground, or a hot desert.
  const beach = surf * clamp01(1 - (heightAboveSea - 3) / 8);
  const desert = clamp01(shareOf(tiles, (tile) => tile === HOT_DESERT) * 1.2) * (1 - snowWeight);
  const sand = clamp01(Math.max(beach, desert)) * (1 - snowWeight);
  const lowland = (1 - snowWeight) * (1 - jungle) * (1 - sand);
  return {
    any: 1,
    snow: snowWeight,
    sand,
    surf,
    jungle: clamp01(jungle * 1.4) * (1 - snowWeight),
    water: clamp01(Math.sqrt(fresh) * 1.2),
    lake: clamp01(onLake * 1.5),
    meadow: clamp01(shareOf(tiles, (tile) => MEADOW.has(tile)) * 1.3) * lowland,
    /** Inland sand, which the per-particle beach mask would otherwise hide. */
    desert,
  };
}

/** A field's weight: the strongest of the regions it lives in. */
export function regionWeight(weights, regions) {
  let best = 0;
  for (const region of regions) best = Math.max(best, weights?.[region] ?? 0);
  return best;
}

/**
 * Samples the world around a canonical point for `ambientRegionWeights`, and
 * the nearest lake's surface for fields floating on it.
 */
export function sampleAmbientSurroundings({ x, z, getTile, tileSize, getWater }) {
  const points = ringPoints({ x, z, rings: RINGS, directions: DIRECTIONS });
  const tiles = [];
  const water = [];
  let lakeLevel = null;
  let lakeDistance = Infinity;
  for (const point of points) {
    tiles.push(getTile(Math.floor(point.x / tileSize), Math.floor(-point.z / tileSize)));
    const sample = getWater(point.x, point.z);
    water.push(sample?.kind ?? 0);
    if (sample?.kind === WATER_LAKE) {
      const distance = Math.hypot(point.dx, point.dz);
      if (distance < lakeDistance) {
        lakeDistance = distance;
        lakeLevel = sample.surfaceHeight;
      }
    }
  }
  return { tiles, water, lakeLevel };
}
