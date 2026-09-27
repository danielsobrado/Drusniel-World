import { BANK_HANDOVER, bankCeiling, bankFloor, bankReach } from './BankProfile.js';
import { reachSurfaceAt } from './RiverReachProfile.js';

/**
 * The ground on either side of a river channel.
 *
 * River levels are traced along the terrain (RiverReachProfile), so where an
 * Azgaar river path crosses a ridge the channel cuts through it. The channel
 * carve alone is only as wide as the river and would leave a slot with sheer
 * walls hundreds of metres high. Here every river point is held under a
 * slope ceiling of `river.valleySlope` from the channel edge, so a gorge opens
 * into a valley, and beside the channel a levee keeps low ground at least
 * `river.leveeHeight` above the water so the river never sits above the land
 * next to it.
 *
 * How far the ceiling reaches follows the cut: where the ground on the
 * centre line stands `cut` metres above the water, the valley reaches
 * `cut / valleySlope` (at most `river.valleyReachMeters`), so the walls climb
 * all the way out of the gorge before handing back to the terrain. Elsewhere
 * only the levee reaches out. The reach is sampled along each reach and
 * interpolated, so it is continuous along the river.
 *
 * The index is coarse (512 m blocks at 2 m cells), because a valley reaches
 * much further than its channel.
 */

const DEFAULT_BLOCK_CELLS = 256;
const SEA_LEVEL_EPSILON = 0.01;
/** Cut samples per index step; each step's reach covers the deepest of its neighbours. */
const CUT_SAMPLES_PER_STEP = 4;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function nearestOnSegment(cellX, cellZ, segment) {
  const amount = clamp(
    ((cellX - segment.ax) * segment.dx + (cellZ - segment.az) * segment.dz)
      / (segment.length * segment.length),
    0,
    1,
  );
  const distance = Math.hypot(
    cellX - (segment.ax + segment.dx * amount),
    cellZ - (segment.az + segment.dz * amount),
  );
  return { amount, distance };
}

export class RiverValley {
  constructor({ segments, config, seaLevel, sampleBaseHeight, blockCells = DEFAULT_BLOCK_CELLS }) {
    this.seaLevel = seaLevel;
    this.cellSizeMeters = config.cellSizeMeters;
    this.blockCells = blockCells;
    this.sampleBaseHeight = sampleBaseHeight;
    this.bank = Object.freeze({
      bankHeight: config.river.leveeHeight,
      bankWidth: config.river.leveeWidthMeters,
      ceilingSlope: config.river.valleySlope,
      reach: config.river.leveeWidthMeters,
    });
    this.leveeReachMeters = bankReach(this.bank);
    this.maximumReachMeters = Math.max(this.leveeReachMeters, config.river.valleyReachMeters);
    this.index = new Map();
    this.reaches = new Map();
    for (const segment of segments) this.add(segment);
  }

  /** Valley reach in metres for ground `cut` metres above the water. */
  reachForCut(cut) {
    // The ceiling must clear the cut before its handover starts, or the handover is a cliff.
    const valley = cut > 0
      ? (cut + this.bank.bankHeight) / this.bank.ceilingSlope / (1 - BANK_HANDOVER)
      : 0;
    return Math.min(this.maximumReachMeters, Math.max(this.leveeReachMeters, valley));
  }

  /**
   * Per index step along a segment, the reach its deepest nearby cut needs:
   * sampled several times per step and widened to the neighbouring steps, so a
   * narrow ridge between samples still gets its valley.
   */
  measureReaches(segment, steps) {
    const cuts = new Float32Array(steps + 1);
    const samples = steps * CUT_SAMPLES_PER_STEP;
    for (let index = 0; index <= samples; index += 1) {
      const t = index / samples;
      const cut = this.sampleBaseHeight(segment.ax + segment.dx * t, segment.az + segment.dz * t)
        - reachSurfaceAt(segment.profile, t);
      const step = Math.round(t * steps);
      cuts[step] = Math.max(cuts[step], cut);
    }
    const reaches = new Float32Array(steps + 1);
    for (let step = 0; step <= steps; step += 1) {
      const deepest = Math.max(cuts[Math.max(0, step - 1)], cuts[step], cuts[Math.min(steps, step + 1)]);
      reaches[step] = this.reachForCut(deepest);
    }
    return reaches;
  }

  /** The valley reach at fraction `t` along a segment, in metres. */
  reachAt(segment, t) {
    const reaches = this.reaches.get(segment);
    const position = t * (reaches.length - 1);
    const step = Math.min(reaches.length - 2, Math.floor(position));
    if (step < 0) return reaches[0];
    return reaches[step] + (reaches[step + 1] - reaches[step]) * (position - step);
  }

  key(blockX, blockZ) {
    return `${blockX}:${blockZ}`;
  }

  add(segment) {
    const block = this.blockCells;
    const step = block * 0.5;
    const steps = Math.max(1, Math.ceil(segment.length / step));
    const reaches = this.measureReaches(segment, steps);
    this.reaches.set(segment, reaches);
    const keys = new Set();
    for (let index = 0; index <= steps; index += 1) {
      const t = index / steps;
      const reachCells = reaches[index] / this.cellSizeMeters;
      const reach = Math.ceil((segment.radiusCells + reachCells + step * 0.5) / block);
      const blockX = Math.floor((segment.ax + segment.dx * t) / block);
      const blockZ = Math.floor((segment.az + segment.dz * t) / block);
      for (let offsetZ = -reach; offsetZ <= reach; offsetZ += 1) {
        for (let offsetX = -reach; offsetX <= reach; offsetX += 1) {
          keys.add(this.key(blockX + offsetX, blockZ + offsetZ));
        }
      }
    }
    for (const key of keys) {
      const bucket = this.index.get(key);
      if (bucket) bucket.push(segment);
      else this.index.set(key, [segment]);
    }
  }

  /** The channel whose edge is nearest, within reach, or null. */
  nearest(cellX, cellZ) {
    const candidates = this.index.get(this.key(
      Math.floor(cellX / this.blockCells),
      Math.floor(cellZ / this.blockCells),
    ));
    if (!candidates) return null;
    let selected = null;
    for (const segment of candidates) {
      const sample = nearestOnSegment(cellX, cellZ, segment);
      const outside = sample.distance - segment.radiusCells;
      if (selected && outside >= selected.outside) continue;
      const reach = this.reachAt(segment, sample.amount);
      if (outside * this.cellSizeMeters > reach) continue;
      selected = { segment, amount: sample.amount, outside, reach };
    }
    return selected;
  }

  /** Ground height with the valley walls and levee of the nearest river applied. */
  shapeHeight(cellX, cellZ, baseHeight) {
    const nearest = this.nearest(cellX, cellZ);
    if (!nearest) return baseHeight;
    const level = reachSurfaceAt(nearest.segment.profile, nearest.amount);
    const distance = Math.max(0, nearest.outside) * this.cellSizeMeters;
    // At the sea, or over ground already under it, a levee would wall off the mouth.
    const levee = nearest.outside > 0
      && level > this.seaLevel + SEA_LEVEL_EPSILON
      && baseHeight >= this.seaLevel;
    const floored = levee ? Math.max(baseHeight, bankFloor(level, distance, this.bank)) : baseHeight;
    return bankCeiling(floored, level, distance, { ...this.bank, reach: nearest.reach });
  }
}
