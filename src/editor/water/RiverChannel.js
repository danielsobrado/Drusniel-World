import { createRiverSurfaceSegments } from './RiverSurfaceProfile.js';
import { reachFallAt, reachPlungeAt, reachSurfaceAt } from './RiverReachProfile.js';

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function smoothstep(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function pointSegmentSample(cellX, cellZ, segment) {
  const lengthSquared = segment.length * segment.length;
  const amount = clamp(
    ((cellX - segment.ax) * segment.dx + (cellZ - segment.az) * segment.dz) / lengthSquared,
    0,
    1,
  );
  const nearestX = segment.ax + segment.dx * amount;
  const nearestZ = segment.az + segment.dz * amount;
  return {
    amount,
    distance: Math.hypot(cellX - nearestX, cellZ - nearestZ),
  };
}

function blockCoordinate(value, blockSize) {
  return Math.floor(value / blockSize);
}

export class RiverChannel {
  constructor({
    source,
    sampleBaseHeight,
    seaLevel,
    config,
    lakeLevelAt = null,
    blockSize = 64,
  }) {
    if (!Number.isInteger(blockSize) || blockSize < 1) {
      throw new Error('River channel blockSize must be a positive integer.');
    }
    this.config = config;
    this.blockSize = blockSize;
    this.segments = createRiverSurfaceSegments({
      source,
      sampleBaseHeight,
      seaLevel,
      config,
      lakeLevelAt,
    });
    this.index = new Map();
    this.buildIndex();
  }

  /**
   * Bucket each segment into the blocks its buffered centre line crosses.
   *
   * Not its bounding box: an imported river reach runs for a hundred kilometres,
   * often diagonally, and its box holds hundreds of thousands of blocks — enough
   * across a whole Azgaar map to overflow a Map. Walking the line in half-block
   * steps touches only the blocks the channel can actually reach.
   */
  buildIndex() {
    const blockSize = this.blockSize;
    const step = blockSize * 0.5;
    for (const segment of this.segments) {
      const margin = segment.radiusCells + 1;
      // The channel's own margin plus the half step a sample can sit between walked points.
      const reach = Math.ceil((margin + step * 0.5) / blockSize);
      const keys = new Set();
      const steps = Math.max(1, Math.ceil(segment.length / step));
      for (let index = 0; index <= steps; index += 1) {
        const t = index / steps;
        const blockX = blockCoordinate(segment.ax + segment.dx * t, blockSize);
        const blockZ = blockCoordinate(segment.az + segment.dz * t, blockSize);
        for (let offsetZ = -reach; offsetZ <= reach; offsetZ += 1) {
          for (let offsetX = -reach; offsetX <= reach; offsetX += 1) {
            keys.add(`${blockX + offsetX}:${blockZ + offsetZ}`);
          }
        }
      }
      for (const key of keys) {
        const bucket = this.index.get(key);
        if (bucket) bucket.push(segment);
        else this.index.set(key, [segment]);
      }
    }
  }

  candidates(cellX, cellZ) {
    return this.index.get(
      `${blockCoordinate(cellX, this.blockSize)}:${blockCoordinate(cellZ, this.blockSize)}`,
    ) ?? [];
  }

  sample(cellX, cellZ) {
    if (!Number.isFinite(cellX) || !Number.isFinite(cellZ)) {
      throw new Error('River channel coordinates must be finite.');
    }
    let selected = null;
    let bedHeight = Number.POSITIVE_INFINITY;

    for (const segment of this.candidates(cellX, cellZ)) {
      const sample = pointSegmentSample(cellX, cellZ, segment);
      if (sample.distance > segment.radiusCells) continue;
      const radial = clamp(1 - sample.distance / segment.radiusCells, 0, 1);
      const influence = smoothstep(radial);
      if (influence <= 0) continue;
      const localSurface = reachSurfaceAt(segment.profile, sample.amount);
      const localBed = localSurface
        - segment.channelDepth * radial ** this.config.river.bankExponent;
      bedHeight = Math.min(bedHeight, localBed);
      if (!selected || influence > selected.influence
          || (influence === selected.influence && localSurface < selected.surfaceHeight)) {
        selected = {
          segment,
          amount: sample.amount,
          influence,
          surfaceHeight: localSurface,
          shoreDistance: (segment.radiusCells - sample.distance) * this.config.cellSizeMeters,
        };
      }
    }

    if (!selected) return null;
    return Object.freeze({
      bodyId: selected.segment.bodyId,
      coverage: selected.influence,
      surfaceHeight: selected.surfaceHeight,
      bedHeight,
      shoreDistance: selected.shoreDistance,
      flowX: selected.segment.flowX,
      flowZ: selected.segment.flowZ,
      fall: reachFallAt(selected.segment.profile, selected.amount),
      plunge: reachPlungeAt(selected.segment.profile, selected.amount),
    });
  }

  containsCell(cellX, cellZ) {
    return this.sample(cellX + 0.5, cellZ + 0.5) !== null;
  }
}
