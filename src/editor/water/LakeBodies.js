import { WATER_BODY_ID_LAKE_BASE, WATER_BODY_ID_RIVER_BASE } from './WaterConstants.js';
import { valueNoise } from './WaterNoise.js';
import { bankReach, shapeBank } from './BankProfile.js';
import { atlasToWorldCell } from './WaterSourceCoordinates.js';

/**
 * Imported lakes at their own surface level.
 *
 * Each lake is its Azgaar outline in world cells, wobbled by shoreline noise
 * (the outline's edges are tens of kilometres long), and the level its source
 * height maps to. Around that shoreline the terrain is shaped:
 *
 *   inside    the bed deepens from the shore to `maximumDepth` over
 *             `shoreDepthMeters`, never above what the base terrain already is;
 *   outside   a bank (see BankProfile): at least `bankHeight` above the
 *             water within `bankWidthMeters`, and no steeper than `shoreSlope`
 *             up to `shoreReachMeters`. Azgaar outlines follow cells, not the
 *             terrain's own dip, so hills can stand right at the water; the
 *             slope limit turns that cliff into a valley side.
 */

/** The shoreline noise's second octave: frequency multiple and weight. */
const NOISE_DETAIL_FREQUENCY = 2.7;
const NOISE_DETAIL_WEIGHT = 0.35;
const MAXIMUM_LAKES = WATER_BODY_ID_RIVER_BASE - WATER_BODY_ID_LAKE_BASE;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Unsigned distance to the outline and whether the point is inside it, in cells. */
function outlineDistance(xs, zs, x, z) {
  let distanceSquared = Infinity;
  let inside = false;
  for (let index = 0, previous = xs.length - 1; index < xs.length; previous = index, index += 1) {
    const ax = xs[previous];
    const az = zs[previous];
    const dx = xs[index] - ax;
    const dz = zs[index] - az;
    const lengthSquared = dx * dx + dz * dz;
    const t = lengthSquared > 0 ? clamp(((x - ax) * dx + (z - az) * dz) / lengthSquared, 0, 1) : 0;
    const ex = x - (ax + dx * t);
    const ez = z - (az + dz * t);
    distanceSquared = Math.min(distanceSquared, ex * ex + ez * ez);
    if ((az > z) !== (zs[index] > z) && x < ax + (z - az) / dz * dx) inside = !inside;
  }
  return { distance: Math.sqrt(distanceSquared), inside };
}

function createLake(source, lake, index, level, config) {
  const points = lake.outline.map((point) => atlasToWorldCell(source, point)).filter(Boolean);
  if (points.length < 3 || !Number.isFinite(level)) return null;
  const xs = Float64Array.from(points, (point) => point.x);
  const zs = Float64Array.from(points, (point) => point.z);
  const reachMeters = config.shorelineNoiseMeters * (1 + NOISE_DETAIL_WEIGHT)
    + bankReach(config.bank, config.maximumDepth);
  const margin = reachMeters / config.cellSizeMeters;
  return Object.freeze({
    id: lake.id,
    name: lake.name ?? null,
    bodyId: WATER_BODY_ID_LAKE_BASE + index,
    level,
    xs,
    zs,
    minX: Math.min(...xs) - margin,
    maxX: Math.max(...xs) + margin,
    minZ: Math.min(...zs) - margin,
    maxZ: Math.max(...zs) + margin,
    noiseSeed: 0x51ed ^ Math.imul(lake.id + 1, 0x9e3779b1),
  });
}

export class LakeBodies {
  /**
   * @param {object} options
   * @param {object} options.source imported world source with `lakes`, `atlas` and `bounds`
   * @param {(lake: object) => number} options.resolveLevel a lake's surface height in metres
   * @param {object} options.config the water domain
   */
  constructor({ source, resolveLevel, config }) {
    this.config = {
      ...config.lake,
      cellSizeMeters: config.cellSizeMeters,
      bank: Object.freeze({
        bankHeight: config.lake.bankHeight,
        bankWidth: config.lake.bankWidthMeters,
        ceilingSlope: config.lake.shoreSlope,
        reach: config.lake.shoreReachMeters,
      }),
    };
    const lakes = [...(source?.lakes ?? [])].sort((left, right) => left.id - right.id)
      .slice(0, MAXIMUM_LAKES);
    this.lakes = Object.freeze(lakes
      .map((lake, index) => createLake(source, lake, index, resolveLevel(lake), this.config))
      .filter(Boolean));
  }

  get size() {
    return this.lakes.length;
  }

  /**
   * The lake nearest a point among those whose influence reaches it, with the
   * signed shoreline distance in metres (negative inside the water), or null.
   */
  locate(cellX, cellZ) {
    let selected = null;
    for (const lake of this.lakes) {
      if (cellX < lake.minX || cellX > lake.maxX || cellZ < lake.minZ || cellZ > lake.maxZ) continue;
      const { distance, inside } = outlineDistance(lake.xs, lake.zs, cellX, cellZ);
      const signed = (inside ? -distance : distance) * this.config.cellSizeMeters
        + this.shorelineNoise(lake, cellX, cellZ);
      if (!selected || signed < selected.distanceMeters) {
        selected = { lake, distanceMeters: signed };
      }
    }
    return selected;
  }

  shorelineNoise(lake, cellX, cellZ) {
    const amplitude = this.config.shorelineNoiseMeters;
    if (amplitude <= 0) return 0;
    const frequency = this.config.cellSizeMeters / this.config.shorelineNoiseScaleMeters;
    const x = cellX * frequency;
    const z = cellZ * frequency;
    return amplitude * (
      valueNoise(x, z, lake.noiseSeed)
      + valueNoise(x * NOISE_DETAIL_FREQUENCY, z * NOISE_DETAIL_FREQUENCY, lake.noiseSeed + 1)
        * NOISE_DETAIL_WEIGHT
    );
  }

  /** The water level of the lake a point lies in, or null outside every lake. */
  levelAt(cellX, cellZ) {
    const located = this.locate(cellX, cellZ);
    return located && located.distanceMeters < 0 ? located.lake.level : null;
  }

  /** Base terrain height with lake basins and banks applied. */
  shapeHeight(cellX, cellZ, baseHeight) {
    const located = this.locate(cellX, cellZ);
    if (!located) return baseHeight;
    const { lake, distanceMeters } = located;
    const config = this.config;
    if (distanceMeters < 0) {
      const inward = -distanceMeters;
      const depth = config.minimumDepth * smoothstep(0, 12, inward)
        + (config.maximumDepth - config.minimumDepth) * smoothstep(0, config.shoreDepthMeters, inward);
      return Math.max(lake.level - config.maximumDepth, Math.min(baseHeight, lake.level - depth));
    }
    return shapeBank(baseHeight, lake.level, distanceMeters, config.bank);
  }

  /** The lake water at a point, or null: body, level and distance to the shore in metres. */
  sample(cellX, cellZ) {
    const located = this.locate(cellX, cellZ);
    if (!located || located.distanceMeters >= 0) return null;
    return {
      bodyId: located.lake.bodyId,
      surfaceHeight: located.lake.level,
      shoreDistance: -located.distanceMeters,
    };
  }
}
