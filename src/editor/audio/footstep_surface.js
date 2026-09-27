/**
 * What a footfall lands on, for its sound. Terrain tiles are the Azgaar biome
 * ids (0 marine … 12 wetland); snow comes from the same accumulation the
 * terrain draws, beach sand from height just above the sea.
 */

export const FOOTSTEP_SURFACES = Object.freeze(['water', 'snow', 'mud', 'sand', 'gravel', 'leaves', 'grass']);

const WETLAND = 12;
const ROAD = 13;
const HOT_DESERT = 1;
const COLD_DESERT = 2;
const FOREST_FLOOR = new Set([5, 6, 7, 8, 9]); // tropical, temperate, taiga
const BEACH_TOP = 1.8;

/**
 * @param {object} footfall
 * @param {boolean} footfall.inWater wading
 * @param {number} footfall.tileId terrain tile under the foot
 * @param {number} footfall.heightAboveSea metres
 * @param {number} footfall.snow 0..1 snow cover
 * @returns {string} one of FOOTSTEP_SURFACES
 */
export function classifyFootstepSurface({ inWater, tileId, heightAboveSea, snow }) {
  if (inWater) return 'water';
  if (snow >= 0.5) return 'snow';
  if (tileId === WETLAND) return 'mud';
  if (tileId === HOT_DESERT) return 'sand';
  if (heightAboveSea >= 0 && heightAboveSea < BEACH_TOP) return 'sand';
  if (tileId === ROAD || tileId === COLD_DESERT) return 'gravel';
  if (FOREST_FLOOR.has(tileId)) return 'leaves';
  return 'grass';
}
