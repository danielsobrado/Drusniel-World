import * as THREE from 'three/webgpu';
import {
  attribute,
  cameraPosition,
  cameraWorldMatrix,
  float,
  fract,
  length,
  mix,
  positionGeometry,
  sin,
  smoothstep,
  step,
  uniform,
  uv,
  vec2,
  vec3,
} from 'three/tsl';

import { skyLightUniforms } from '../../stylized/sky/skyLight.js';

const TAU = Math.PI * 2;
/** Flakes this close to the lens vanish, and fade over the next metres. */
const LENS_COLLAPSE = 0.45;
const LENS_FADE = 1.6;

export function createSnowfallUniforms() {
  return {
    time: uniform(0),
    center: uniform(new THREE.Vector3()),
    /** Integral of the wind over time, metres, so a gust never jumps the field. */
    drift: uniform(new THREE.Vector2()),
    intensity: uniform(1),
    color: uniform(new THREE.Color(0xf2f6ff)),
    opacity: uniform(0.8),
  };
}

/**
 * Snow over a column that follows the camera (after grass-test's
 * SnowfallSystem). Every flake is a function of its seed and time: it falls
 * through its population's column and wraps back to the top, drifts with the
 * integrated wind, and swirls across it on its own phase. Horizontal wrapping
 * is anchored in world space, so a walker moves through the snow rather than
 * carrying it along.
 *
 * Flakes face the camera fully: crossed upright quads turn edge-on seen from
 * above and draw as a grid of lines. Intensity decides how many fall.
 *
 * Per flake: `snowSeed` (x, z, phase, rank) and `snowShape` (column width,
 * column height, radius, fall speed); a negative radius marks an out-of-focus
 * flake, drawn as a soft disc.
 */
export function createSnowfallMaterial(uniforms) {
  const seed = attribute('snowSeed', 'vec4');
  const shape = attribute('snowShape', 'vec4');
  const { time, center, drift, intensity } = uniforms;
  const width = shape.x;
  const height = shape.y;
  const radius = shape.z.abs();
  const bokeh = step(shape.z, 0);

  const fall = fract(seed.z.add(time.mul(shape.w).div(height)));
  const swirlPhase = seed.z.mul(TAU).add(fall.mul(3.1));
  const swirl = vec2(
    sin(time.mul(mix(0.5, 1.2, seed.x)).add(swirlPhase)),
    sin(time.mul(mix(0.4, 1.0, seed.y)).add(swirlPhase.mul(1.3))),
  ).mul(0.45);
  const anchor = vec2(seed.x, seed.y).mul(width).add(drift).add(swirl);
  const offset = fract(anchor.sub(center.xz).div(width)).sub(0.5).mul(width);
  const flake = vec3(
    center.x.add(offset.x),
    center.y.add(height.mul(float(0.55).sub(fall))),
    center.z.add(offset.y),
  );

  const lens = smoothstep(LENS_COLLAPSE, LENS_FADE, cameraPosition.distance(flake));
  const falling = step(seed.w, intensity.min(1));
  const size = radius.mul(lens).mul(falling);
  const right = cameraWorldMatrix.element(0).xyz;
  const up = cameraWorldMatrix.element(1).xyz;
  const corner = positionGeometry.xy;

  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  material.name = 'weather-snowfall-node';
  material.positionNode = flake.add(right.mul(corner.x.mul(size))).add(up.mul(corner.y.mul(size)));

  const r = length(uv().sub(0.5).mul(2));
  const crisp = float(1).sub(smoothstep(0.35, 1, r));
  const disc = float(1).sub(smoothstep(0.6, 1, r)).mul(0.26);
  const edges = smoothstep(0, 0.08, fall).mul(float(1).sub(smoothstep(0.9, 1, fall)));
  material.opacityNode = mix(crisp, disc, bokeh)
    .mul(edges)
    .mul(uniforms.opacity)
    .mul(intensity.clamp(0, 1.4));
  material.colorNode = uniforms.color.mul(skyLightUniforms.brightness);
  return material;
}
