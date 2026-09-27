import {
  float,
  max,
  mix,
  oneMinus,
  smoothstep,
  vec2,
  vec3,
} from 'three/tsl';
import { seaStateUniforms } from '../../water/seaState.js';
import { groundDeformationNode } from './groundDeformationNode.js';

/** Height above the sea that still counts as beach sand for prints. */
const BEACH_TOP = 1.8;

/**
 * Footprints on the terrain: pressed snow goes a shade darker and cooler, sand
 * a shade darker and wetter-looking. Only where the ground is snow (the baked
 * snow weight) or beach (just above the sea); elsewhere nothing shows.
 *
 * @param {object} options
 * @param {object} options.terrainUv chunk uv
 * @param {number} options.chunkWorldSize metres
 * @param {object} options.chunkCenter vec2 uniform, canonical chunk centre (whole metres)
 * @param {object} options.groundHeight world height of the ground
 * @param {object} options.snow 0..1 baked snow weight
 */
export function createFootprintShading({ terrainUv, chunkWorldSize, chunkCenter, groundHeight, snow }) {
  const localMeters = vec2(terrainUv.x, terrainUv.y).mul(chunkWorldSize);
  // The chunk's corner in whole metres on cell axes (canonical z runs the other way).
  const originMeters = vec2(
    chunkCenter.x.sub(chunkWorldSize * 0.5),
    chunkCenter.y.negate().sub(chunkWorldSize * 0.5),
  ).round();
  const depth = groundDeformationNode(originMeters, localMeters);
  const above = groundHeight.sub(seaStateUniforms.seaLevel);
  const beach = smoothstep(-0.2, 0.1, above).mul(oneMinus(smoothstep(BEACH_TOP - 0.4, BEACH_TOP, above)));
  const surface = max(snow, beach);
  const pressed = depth.mul(surface);
  return {
    apply(color) {
      const tint = mix(vec3(0.72, 0.68, 0.64), vec3(0.8, 0.88, 1), snow);
      return mix(color, color.mul(tint), pressed.mul(float(0.85)));
    },
  };
}
