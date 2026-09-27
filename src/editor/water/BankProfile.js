/**
 * Ground beside standing or running water, as a function of the distance from
 * the water's edge. Shared by lakes and river valleys.
 *
 *   bank      within `bankWidth` the land rises to `bankHeight` above the
 *             water, so the water can never spill over a low edge;
 *   falloff   past the bank it falls away at BANK_FALLOFF_SLOPE until it meets
 *             the base terrain again;
 *   ceiling   higher land rises from the edge no steeper than `ceilingSlope`,
 *             which turns cliffs left by coarse source data into slopes;
 *   handover  the ceiling fades out over the last BANK_HANDOVER share of `reach`,
 *             so the shaping ends without a seam.
 */

/** Rise over run of the outer face of a bank. */
export const BANK_FALLOFF_SLOPE = 0.15;
/** Share of the reach over which the ceiling hands back to the base terrain. */
export const BANK_HANDOVER = 0.4;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** The bank floor alone: how high the ground must be `distance` metres from the edge. */
export function bankFloor(level, distance, { bankHeight, bankWidth }) {
  return distance <= bankWidth
    ? level + bankHeight * smoothstep(0, bankWidth, distance)
    : level + bankHeight - BANK_FALLOFF_SLOPE * (distance - bankWidth);
}

/** The slope ceiling alone, blended back to `height` over the handover. */
export function bankCeiling(height, level, distance, { bankHeight, ceilingSlope, reach }) {
  const ceiling = level + bankHeight + ceilingSlope * distance;
  const limit = 1 - smoothstep(reach * (1 - BANK_HANDOVER), reach, distance);
  return height + (Math.min(height, ceiling) - height) * limit;
}

/**
 * Base terrain `distance` metres (≥ 0) outside the edge of water at `level`,
 * held above the bank floor and under the slope ceiling.
 */
export function shapeBank(baseHeight, level, distance, profile) {
  return bankCeiling(Math.max(baseHeight, bankFloor(level, distance, profile)), level, distance, profile);
}

/** How far from the edge a bank profile can change anything, in metres. */
export function bankReach(profile, maximumDepth = 0) {
  return Math.max(
    profile.reach,
    profile.bankWidth + (profile.bankHeight + maximumDepth) / BANK_FALLOFF_SLOPE,
  );
}
