import {
  clusterNoise,
  createStonePlacementSink,
  smoothstep,
  stoneHash01,
} from './stonePlacementSink.js';

/**
 * Boulders on the seabed in the shallows (after grass-test's seabed rocks).
 *
 * The donor places these against an authored coastline and its bathymetry: 1.2 to
 * 11 m of water, clustered seaward of the shoreline. Here a coast is just ground
 * standing below sea level, so the band becomes a depth band on the same height
 * samples the beach pebbles use, and the seaward bias becomes a bias toward the
 * shallows.
 *
 * That bias is not only aesthetic. The water is unlit and its colour saturates by
 * about six metres (`docs/plans/grass-test-merge-plan-2026-09-24.md`, P4), so a
 * boulder deeper than that is drawn and never seen. `keep` therefore falls off
 * with depth and the far end of the band is mostly empty — which is why `maxDepth`
 * sits well past the point the stones stop reading.
 *
 * Most chunks are nowhere near water: five height samples reject land before any
 * candidate is tried, and the same probes reject water too deep to show anything.
 */

export const DEFAULT_SEABED_ROCKS = Object.freeze({
  enabled: true,
  spacingMeters: 7,
  // Shallowest water a boulder sits in. Right at the waterline they would be
  // breakers rather than seabed, and the swash and foam already draw there.
  minDepth: 1.2,
  maxDepth: 11,
  keep: 0.4,
  clusterMeters: 22,
  minScale: 0.4,
  maxScale: 1.2,
});

/**
 * @param {object} options sink options (see createStonePlacementSink), plus:
 * @param {number} options.seaLevel
 * @param {object} [options.config] `rocks.seabed`
 */
export function buildSeabedRocks({ seaLevel, config = DEFAULT_SEABED_ROCKS, ...sinkOptions }) {
  if (!config.enabled) return [];
  const sink = createStonePlacementSink({ prefix: 'seabed-rock', ...sinkOptions });
  const { tileSize, heightAt } = sinkOptions;
  const { minX, minZ, maxX, maxZ } = sink.cells;
  const x0 = minX * tileSize;
  const x1 = maxX * tileSize;
  const z0 = -maxZ * tileSize;
  const z1 = -minZ * tileSize;
  // Depth is positive downwards. A chunk that is entirely dry, or entirely deeper
  // than the band, has nothing to place.
  const probes = [[x0, z0], [x1, z0], [x0, z1], [x1, z1], [(x0 + x1) / 2, (z0 + z1) / 2]]
    .map(([x, z]) => seaLevel - heightAt(x, z));
  if (Math.min(...probes) > config.maxDepth || Math.max(...probes) < config.minDepth) return [];

  const spacing = config.spacingMeters;
  // One grid row and column before the chunk as well: a candidate jitters up to a
  // whole spacing from its grid point, so one from the row before can land in this
  // chunk and no other chunk would try it. The sink keeps only the stones this
  // chunk owns, so none is placed twice.
  for (let gz = Math.ceil(z0 / spacing) - 1; gz * spacing < z1; gz += 1) {
    for (let gx = Math.ceil(x0 / spacing) - 1; gx * spacing < x1; gx += 1) {
      const rolls = [0, 1, 2, 3, 4, 5, 6].map((channel) => stoneHash01(gx, gz, channel, 0x3b9));
      const x = (gx + rolls[0]) * spacing;
      const z = (gz + rolls[1]) * spacing;
      const height = heightAt(x, z);
      const depth = seaLevel - height;
      if (depth < config.minDepth || depth > config.maxDepth) continue;
      // Densest in the shallows, fading past the depth the water still shows.
      const visible = 1 - smoothstep(config.maxDepth * 0.25, config.maxDepth, depth);
      const cluster = smoothstep(0.45, 0.8, clusterNoise(x, z, config.clusterMeters, 0x71));
      if (rolls[2] > config.keep * visible * cluster * 2) continue;
      const scale = config.minScale + rolls[3] * (config.maxScale - config.minScale);
      sink.place(`${gx}:${gz}`, x, z, scale, rolls[4], rolls[5], rolls[6], height);
    }
  }
  return sink.placements;
}
