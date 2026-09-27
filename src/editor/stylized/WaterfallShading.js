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
 * @param {object} options.worldXZ vec2 node: canonical world position
 * @param {object} options.time seconds uniform
 * @param {object} options.config `stylizedSurface.water.waterfall`
 * @returns {object} foam amount node, 0..1
 */
export function createWaterfallFoamNode({ fallPlunge, flow, worldXZ, time, config }) {
  const strandTexture = getWaterfallStrandTexture();
  const direction = flow.div(max(length(flow), 1e-4));
  const along = dot(worldXZ, direction);
  const across = dot(worldXZ, vec2(direction.y.negate(), direction.x));

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
