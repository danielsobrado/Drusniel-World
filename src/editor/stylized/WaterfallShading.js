import {
  dot,
  float,
  length,
  max,
  oneMinus,
  smoothstep,
  texture,
  vec2,
} from 'three/tsl';
import { getWaterfallStrandTexture } from './waterfallStrandTexture.js';

/** Half-width of the threshold band that turns strand detail into whitewater. */
const STRAND_EDGE = 0.08;
const CHURN_EDGE = 0.12;
/** The strand texture is four times wider than tall, with square lattice cells. */
const TEXTURE_ASPECT = 4;

/**
 * Strands are centimetre-scale texture detail (a 10 m tile over 256 texels), so
 * their coordinates never come from raw canonical metres: on a planet-scale
 * world float32 steps those by a quarter to half a metre, eight or more
 * texels, and the strands stair-step. Instead a water chunk's centre is wrapped
 * to this period in double precision (`waterfallPatternOrigin`) and the shader
 * adds only the chunk-local offset, which keeps every coordinate below 2^17 m
 * and within a centimetre.
 *
 * Where a wrap falls between two chunks the pattern shifts once. The period is
 * a whole number of the default strand and churn tiles (10 m and 4 m, 12 m and
 * 3 m) and of the chunk, so a fall flowing along an axis carries straight over
 * it; any other one shows a seam there, one line every 123 km.
 */
export const WATERFALL_PATTERN_PERIOD_METERS = 122_880;

function wrapPattern(value) {
  const period = WATERFALL_PATTERN_PERIOD_METERS;
  return value - Math.floor(value / period) * period;
}

/**
 * A water chunk's pattern origin: its canonical centre wrapped to the pattern
 * period, computed here in double precision for the chunk's uniform.
 */
export function waterfallPatternOrigin(centerX, centerZ) {
  return [wrapPattern(centerX), wrapPattern(centerZ)];
}

/**
 * Whitewater on a river fall and the churn in its plunge pool.
 *
 * A fall here is the water sheet itself stepping down across the face (see
 * RiverFalls), so there is no separate waterfall mesh: the sheet's own flow
 * gives the fall a direction, the strand texture streaks along it and
 * scrolls at `fallSpeed`, and the flow texture's fall weight decides how much
 * of it turns white. Below the face the plunge weight whitens slow, drifting
 * patches instead. Two texture samples of one shared 256×64 texture, built
 * only into materials that draw foam.
 *
 * @param {object} options
 * @param {object} options.fallPlunge vec2 node: fall and plunge weights, 0..1
 * @param {object} options.flow vec2 node: the current, any length
 * @param {object} options.patternXZ vec2 node: metres on canonical axes, from the
 *   chunk's `waterfallPatternOrigin` plus its local offset
 * @param {object} options.time seconds uniform
 * @param {object} options.config `stylizedSurface.water.waterfall`
 * @returns {object} foam amount node, 0..1
 */
export function createWaterfallFoamNode({ fallPlunge, flow, patternXZ, time, config }) {
  const strandTexture = getWaterfallStrandTexture();
  const direction = flow.div(max(length(flow), 1e-4));
  const along = dot(patternXZ, direction);
  const across = dot(patternXZ, vec2(direction.y.negate(), direction.x));

  const fall = fallPlunge.x;
  const face = texture(strandTexture, vec2(
    across.div(config.strandWidthMeters),
    along.sub(time.mul(config.fallSpeed)).div(config.strandLengthMeters),
  ));
  const faceDetail = face.r.mul(0.6).add(face.g.mul(0.4));
  const faceThreshold = oneMinus(fall.mul(config.faceCoverage));
  const strands = smoothstep(
    faceThreshold.sub(STRAND_EDGE),
    faceThreshold.add(STRAND_EDGE),
    faceDetail,
  ).mul(smoothstep(0, 0.2, fall));
  const faceFoam = max(strands, fall.mul(config.faceAeration));

  const plunge = fallPlunge.y;
  const churnScale = float(config.plungeScaleMeters);
  const churn = texture(strandTexture, vec2(
    across.div(churnScale.mul(TEXTURE_ASPECT)),
    along.sub(time.mul(config.plungeSpeed)).div(churnScale),
  )).b;
  const churnThreshold = oneMinus(plunge.mul(config.plungeCoverage));
  const plungeFoam = smoothstep(
    churnThreshold.sub(CHURN_EDGE),
    churnThreshold.add(CHURN_EDGE),
    churn,
  ).mul(smoothstep(0, 0.15, plunge));

  return max(faceFoam, plungeFoam);
}
