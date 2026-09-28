import { Fn, cos, dot, float, floor, fract, mix, sin, vec2 } from 'three/tsl';

const TWO_PI = Math.PI * 2;
const HASH_SCALE = 43758.5453;

/**
 * Gradient noise in 0..1 (centred on 0.5), grass-test's `gradientNoise2d`.
 * Smooth and cheap: four hashed gradients and a quintic-free smoothstep fade.
 * The meadow uses it for slow fields — stand height and colour patches — so the
 * point should be pre-scaled to a few cells across the effect.
 */
export const meadowNoise = Fn(([point]) => {
  const cell = floor(point).toVar();
  const local = fract(point).toVar();
  const fade = local.mul(local).mul(float(3).sub(local.mul(2)));
  const gradientDot = (offset) => {
    const lattice = cell.add(offset);
    const angle = fract(sin(dot(lattice, vec2(0.1, 0.7))).mul(HASH_SCALE)).mul(TWO_PI);
    const delta = local.sub(offset);
    return cos(angle).mul(delta.x).add(sin(angle).mul(delta.y));
  };
  return mix(
    mix(gradientDot(vec2(0, 0)), gradientDot(vec2(1, 0)), fade.x),
    mix(gradientDot(vec2(0, 1)), gradientDot(vec2(1, 1)), fade.x),
    fade.y,
  ).add(0.5);
});
