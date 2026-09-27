import { valueNoise } from './WaterNoise.js';

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function lerp(left, right, amount) {
  return left + (right - left) * amount;
}

function smoothstep(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

export function oceanDepthProfile(distanceMeters, config) {
  const distance = clamp(distanceMeters, 0, config.shoreDistanceMeters);
  if (distance <= config.coastalShelfMeters) {
    return config.shelfDepth * distance / config.coastalShelfMeters;
  }
  const deepAmount = (distance - config.coastalShelfMeters)
    / (config.shoreDistanceMeters - config.coastalShelfMeters);
  return lerp(config.shelfDepth, config.maximumDepth, deepAmount);
}

export function sampleOceanBed({
  baseHeight,
  surfaceHeight,
  distanceMeters,
  cellX,
  cellZ,
  seed,
  config,
}) {
  const profileDepth = oceanDepthProfile(distanceMeters, config);
  const detailScaleCells = Math.max(1, 192 / config.cellSizeMeters);
  const detail = valueNoise(cellX / detailScaleCells, cellZ / detailScaleCells, seed + 2909)
    * config.maximumDepth
    * 0.08
    * smoothstep(distanceMeters / config.coastalShelfMeters);
  const targetDepth = clamp(profileDepth + detail, 0, config.maximumDepth);
  const baseDepth = Math.max(0, surfaceHeight - baseHeight);
  const blendedDepth = lerp(baseDepth, targetDepth, smoothstep(distanceMeters / config.cellSizeMeters));
  return surfaceHeight - clamp(blendedDepth, 0, config.maximumDepth);
}
