import { valueNoise } from './valueNoise2d.js';

/**
 * Ridged mountain relief for high ground (after grass-test's MountainNoise):
 * crests, spurs and the gullies between them, where Azgaar's smooth height
 * field and the rolling local detail leave mountains as domes.
 *
 * A ridged multifractal: each octave folds value noise into sharp crests,
 * and a crest in one octave strengthens the next, so detail gathers along
 * ridgelines instead of spreading evenly. Wavelengths stay well above the 2 m
 * cell, so no octave aliases on the terrain grid.
 */
const OCTAVES = Object.freeze([
  { cells: 384, amplitude: 1, seed: 7919 },
  { cells: 160, amplitude: 0.45, seed: 8123 },
  { cells: 64, amplitude: 0.18, seed: 8429 },
]);
/** The largest sum OCTAVES can reach, for normalizing to 0..1. */
const PEAK = OCTAVES.reduce((sum, octave) => sum + octave.amplitude, 0);

export const DEFAULT_MOUNTAIN_RIDGES = Object.freeze({
  /** Crest height over the gullies at full strength, metres. */
  heightMeters: 90,
  /** Land relief fraction (0 coast … 1 highest peak) where ridges begin and reach full strength. */
  startRelief: 0.3,
  fullRelief: 0.65,
});

function smoothstep(edge0, edge1, value) {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** 0 at the gully floor … 1 on the sharpest crest. */
export function ridgedField(x, z, seed) {
  let sum = 0;
  let weight = 1;
  for (const octave of OCTAVES) {
    const folded = 1 - Math.abs(valueNoise(x / octave.cells, z / octave.cells, seed + octave.seed));
    const crest = folded * folded * weight;
    sum += crest * octave.amplitude;
    weight = Math.min(1, crest * 2);
  }
  return sum / PEAK;
}

/** How strongly ridges rise at a relief fraction, 0..1. Zero skips the noise entirely. */
export function ridgeStrength(reliefFraction, ridges) {
  return smoothstep(ridges.startRelief, ridges.fullRelief, reliefFraction);
}

/**
 * Metres of ridge relief at a vertex, centred so the mean ground stays where
 * Azgaar put it: crests rise, gullies sink.
 */
export function ridgeHeight(x, z, seed, reliefFraction, ridges, scale = 1) {
  const strength = ridgeStrength(reliefFraction, ridges) * scale;
  if (strength <= 0) return 0;
  return (ridgedField(x, z, seed) - 0.35) * ridges.heightMeters * strength;
}

/** The import setting, resolved; null keeps ridges off. */
export function resolveMountainRidges(source) {
  if (source == null || source === false) return null;
  const ridges = { ...DEFAULT_MOUNTAIN_RIDGES, ...(source === true ? {} : source) };
  validateMountainRidges(ridges, 'import.azgaarRidges');
  return ridges;
}

export function validateMountainRidges(ridges, path) {
  if (!ridges || !Number.isFinite(ridges.heightMeters) || ridges.heightMeters < 0
      || !Number.isFinite(ridges.startRelief) || !Number.isFinite(ridges.fullRelief)
      || ridges.fullRelief <= ridges.startRelief) {
    throw new Error(`${path} needs heightMeters ≥ 0 and startRelief < fullRelief.`);
  }
}
