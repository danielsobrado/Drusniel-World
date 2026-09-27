import {
  Fn,
  If,
  cameraPosition,
  clamp,
  cross,
  dot,
  float,
  floor,
  fract,
  fwidth,
  int,
  length,
  max,
  mix,
  normalize,
  normalWorld,
  positionWorld,
  select,
  smoothstep,
  uint,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';
import { latticeHashNode } from '../weather/wind/windNoise.js';
import { directionFromAngles } from './StylizedGodRaysPostProcess.js';
import { skyLightUniforms } from './sky/skyLight.js';

/**
 * What a lit material leaves out of snow (after grass-test's snow shading,
 * itself after Snowflow, MIT):
 *
 *   backscatter  snow faces turned from the sun go cool blue instead of grey;
 *   glints       sparse facets that flash when you look across the snow into
 *                the sun and stay matte looking down, fading out (never
 *                shrinking) once a cell falls below a few pixels.
 *
 * Glint cells must be exact at planet scale, where float32 cannot hold a
 * canonical position's fraction. They are indexed from the chunk's origin in
 * whole metres (exact below 2^24 m) plus the local offset, and hashed as
 * integers; the pattern restarts at chunk borders, which sparse sparkle hides.
 */

const FINE_CELL_METERS = 0.15;
const COARSE_CELL_METERS = 0.5;
const FACET_SHARE = 0.38;

function cellHash(originMeters, cell, salt) {
  return latticeHashNode(
    uint(int(originMeters.x)).add(uint(int(cell.x)).mul(uint(0x9e3779b1))).add(uint(salt)),
    uint(int(originMeters.y)).add(uint(int(cell.y)).mul(uint(0x85ebca6b))).add(uint(salt * 7919)),
  );
}

function glintOctave({ localMeters, originMeters, cellMeters, salt, normal, halfVector, sharpness }) {
  const point = localMeters.div(cellMeters);
  const cell = floor(point);
  const local = fract(point);
  const jitter = vec2(cellHash(originMeters, cell, salt), cellHash(originMeters, cell, salt + 1));
  const centre = jitter.mul(0.72).add(0.14);
  const distance = length(local.sub(centre)).div(0.17);
  const disc = clamp(float(1).sub(distance.mul(distance)), 0, 1);
  const angle = cellHash(originMeters, cell, salt + 2).mul(Math.PI * 2);
  const tilt = cellHash(originMeters, cell, salt + 3).mul(0.26).add(0.1);
  const up = select(normal.y.abs().greaterThan(0.95), vec3(1, 0, 0), vec3(0, 1, 0));
  const tangent = normalize(cross(up, normal));
  const bitangent = cross(normal, tangent);
  const facet = normalize(normal.add(tangent.mul(angle.cos()).add(bitangent.mul(angle.sin())).mul(tilt)));
  const response = disc.mul(clamp(dot(facet, halfVector), 0, 1).pow(sharpness));
  const holds = cellHash(originMeters, cell, salt + 4).lessThan(FACET_SHARE);
  return select(holds, response, float(0));
}

/**
 * @param {object} options
 * @param {object} options.terrainUv chunk uv
 * @param {number} options.chunkWorldSize metres
 * @param {object} options.chunkCenter vec2 uniform, canonical chunk centre (whole metres)
 * @param {object} options.snow 0..1 snow weight
 * @param {object} options.stylizedConfig for the sky's sun and the snow colour
 * @param {import('three').Vector3 | null} [options.sunDirection] the live sun, turned
 *   in place as the time of day changes; without it the configured sun is fixed
 */
export function createSnowSurfaceNodes({
  terrainUv,
  chunkWorldSize,
  chunkCenter,
  snow,
  stylizedConfig,
  sunDirection = null,
}) {
  const sky = stylizedConfig?.sky;
  const sunVector = directionFromAngles(sky?.sunElevation ?? 10, sky?.sunAzimuth ?? 258);
  // Glints and backscatter follow the sun that actually lights the scene: at
  // dusk or under the moon a fixed configured sun would still flash the snow
  // from where the midday sun stands.
  const sun = sunDirection
    ? normalize(uniform(sunDirection))
    : vec3(sunVector.x, sunVector.y, sunVector.z);
  const normal = normalize(normalWorld);
  const view = normalize(cameraPosition.sub(positionWorld));
  const halfVector = normalize(view.add(sun));

  // Chunk-local metres on cell axes, and the chunk's corner in whole metres.
  const localMeters = vec2(terrainUv.x, terrainUv.y).mul(chunkWorldSize);
  const originMeters = vec2(
    chunkCenter.x.sub(chunkWorldSize * 0.5),
    chunkCenter.y.negate().sub(chunkWorldSize * 0.5),
  ).round();
  const footprint = length(fwidth(localMeters));
  const graze = float(1).sub(clamp(dot(normal, view), 0, 1)).pow(3);
  const facingSun = clamp(dot(normal, sun), 0, 1);
  const lightGate = smoothstep(0.02, 0.35, facingSun);
  // Ten integer hashes per pixel: only snow pays them, and snowless regions
  // branch coherently past the block.
  const glints = Fn(() => {
    const result = float(0).toVar();
    If(snow.greaterThan(0.02), () => {
      const fine = glintOctave({
        localMeters, originMeters, cellMeters: FINE_CELL_METERS, salt: 11, normal, halfVector, sharpness: 780,
      }).mul(float(1).sub(smoothstep(FINE_CELL_METERS * 0.55, FINE_CELL_METERS * 2.2, footprint)));
      const coarse = glintOctave({
        localMeters, originMeters, cellMeters: COARSE_CELL_METERS, salt: 53, normal, halfVector, sharpness: 1500,
      }).mul(float(1).sub(smoothstep(COARSE_CELL_METERS * 0.55, COARSE_CELL_METERS * 2.2, footprint)))
        .mul(1.35);
      result.assign(fine.add(coarse).mul(graze).mul(lightGate).mul(snow));
    });
    return result;
  })();

  const shade = float(1).sub(smoothstep(0.05, 0.6, max(dot(normal, sun), 0)));
  const backscatter = snow.mul(shade).mul(0.35);

  return {
    /** Cool blue on snow turned from the sun. */
    apply(color) {
      return mix(color, color.mul(vec3(0.78, 0.88, 1.08)), backscatter);
    },
    /**
     * Sparkle, added as emission so it survives the lit shading — and so it
     * takes the sky's light itself (1 in the configured look, dim at night).
     */
    emissive: vec3(glints.mul(2.2).mul(skyLightUniforms.brightness)),
  };
}
