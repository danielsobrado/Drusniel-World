import { reachFallAt } from '../water/RiverReachProfile.js';
import { createStonePlacementSink, smoothstep, stoneHash01 as hash01 } from './stonePlacementSink.js';

/**
 * Stones placed by the rivers themselves (after grass-test's riverbank rocks):
 *
 *   bank     stones along both banks, clustered with bare gaps between runs,
 *            some stepping a little into the water; none on a fall face;
 *   lip      boulders across the top of each fall;
 *   plunge   tumbled blocks in the pool below each fall.
 *
 * Placements have the rock manifest's shape, so they draw, fade, collide and
 * block trees exactly like any other boulder. A stone belongs to the chunk its
 * own position lies in (stonePlacementSink), so every chunk considers the river
 * points near it, not only in it. Every random draw is taken whether or not the
 * stone is kept, so placement is stable.
 */

export const DEFAULT_RIVERBANK_ROCKS = Object.freeze({
  enabled: true,
  spacingMeters: 7,
  keep: 0.55,
  clusterMeters: 60,
  minScale: 0.35,
  maxScale: 0.85,
  lipBoulders: 3,
  plungeBlocks: 5,
});

/** Smooth 1D value noise over integers, 0..1, for bank clustering. */
function clusterNoise(position, seed) {
  const cell = Math.floor(position);
  const t = position - cell;
  const a = hash01(seed, cell);
  const b = hash01(seed, cell + 1);
  return a + (b - a) * t * t * (3 - 2 * t);
}

function segmentSeed(segment) {
  return Math.imul(segment.bodyId | 0, 0x9e3779b1)
    ^ Math.imul(Math.round(segment.ax * 4), 0x85ebca6b)
    ^ Math.imul(Math.round(segment.az * 4), 0xc2b2ae35);
}

/** Farthest a bank stone lands beyond the channel edge, in metres. */
const BANK_REACH_METERS = 3;

/** The t range of a segment's centre line inside a cell box, or null (Liang–Barsky). */
function clipToBox(segment, minX, minZ, maxX, maxZ) {
  let t0 = 0;
  let t1 = 1;
  const edges = [
    [-segment.dx, segment.ax - minX],
    [segment.dx, maxX - segment.ax],
    [-segment.dz, segment.az - minZ],
    [segment.dz, maxZ - segment.az],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return null;
  }
  return [t0, t1];
}

/**
 * @param {object} options
 * @param {number} options.chunkX
 * @param {number} options.chunkZ
 * @param {number} options.chunkSize cells per chunk side
 * @param {number} options.tileSize metres per cell
 * @param {Array<object>} options.segments river segments that may cross the chunk
 * @param {Array<object>} options.falls fall sites (RiverFallSites) near the chunk
 * @param {(x: number, z: number) => number} options.heightAt canonical ground height
 * @param {(roll: number, x: number, z: number) => number} options.prototypeIndexForRoll
 * @param {(scale: number) => number} options.radiusForScale
 * @param {object} [options.config] `rocks.riverbank`
 */
export function buildRiverbankRocks({
  chunkX,
  chunkZ,
  chunkSize,
  tileSize,
  segments,
  falls = [],
  heightAt,
  prototypeIndexForRoll,
  radiusForScale,
  config = DEFAULT_RIVERBANK_ROCKS,
}) {
  if (!config.enabled) return [];
  const sink = createStonePlacementSink({
    prefix: 'river-rock',
    chunkX,
    chunkZ,
    chunkSize,
    tileSize,
    heightAt,
    prototypeIndexForRoll,
    radiusForScale,
  });
  const { minX, minZ, maxX, maxZ } = sink.cells;
  const place = (...args) => sink.place(...args);
  const scaleFor = (roll, factor = 1) => (
    (config.minScale + roll * (config.maxScale - config.minScale)) * factor
  );

  for (const segment of segments) {
    const margin = segment.radiusCells + BANK_REACH_METERS / tileSize + 1;
    const range = clipToBox(segment, minX - margin, minZ - margin, maxX + margin, maxZ + margin);
    if (!range) continue;
    const lengthMeters = segment.length * tileSize;
    const seed = segmentSeed(segment);
    const first = Math.ceil(range[0] * lengthMeters / config.spacingMeters);
    const last = Math.floor(range[1] * lengthMeters / config.spacingMeters);
    const normalX = -segment.dz / segment.length;
    const normalZ = segment.dx / segment.length;
    const radiusMeters = segment.radiusCells * tileSize;
    for (let step = first; step <= last; step += 1) {
      const t = step * config.spacingMeters / lengthMeters;
      const cellX = segment.ax + segment.dx * t;
      const cellZ = segment.az + segment.dz * t;
      const onFace = reachFallAt(segment.profile, t) > 0.05;
      for (const side of [-1, 1]) {
        const rolls = [0, 1, 2, 3, 4, 5].map((channel) => hash01(seed, step, side, channel));
        const cluster = smoothstep(0.35, 0.75, clusterNoise(
          step * config.spacingMeters / config.clusterMeters,
          seed + side,
        ));
        if (onFace || rolls[0] > config.keep * cluster * 2) continue;
        // Mostly on the bank, a few stepping into the shallows.
        const offset = radiusMeters + (rolls[1] - 0.3) * (BANK_REACH_METERS / 0.7);
        const x = cellX * tileSize + normalX * side * offset;
        const z = -(cellZ * tileSize + normalZ * side * offset);
        place(`bank:${seed >>> 0}:${step}:${side}`, x, z, scaleFor(rolls[2]), rolls[3], rolls[4], rolls[5]);
      }
    }
  }

  for (const fall of falls) {
    const acrossX = -fall.dirZ;
    const acrossZ = fall.dirX;
    const half = fall.widthMeters * 0.5;
    for (let index = 0; index < config.lipBoulders; index += 1) {
      const rolls = [0, 1, 2, 3, 4].map((channel) => hash01(fall.seed, 11, index, channel));
      const across = (rolls[0] * 2 - 1) * (half + 2);
      place(
        `lip:${fall.seed}:${index}`,
        fall.lipX + acrossX * across - fall.dirX * rolls[1] * 2,
        fall.lipZ + acrossZ * across - fall.dirZ * rolls[1] * 2,
        scaleFor(rolls[2], 1.6),
        rolls[3],
        rolls[4],
        rolls[1],
      );
    }
    for (let index = 0; index < config.plungeBlocks; index += 1) {
      const rolls = [0, 1, 2, 3, 4].map((channel) => hash01(fall.seed, 29, index, channel));
      const across = (rolls[0] * 2 - 1) * half * 0.9;
      const along = 3 + rolls[1] * 14;
      place(
        `plunge:${fall.seed}:${index}`,
        fall.x + acrossX * across + fall.dirX * along,
        fall.z + acrossZ * across + fall.dirZ * along,
        scaleFor(rolls[2], 1.3),
        rolls[3],
        rolls[4],
        rolls[1],
      );
    }
  }
  return sink.placements;
}
