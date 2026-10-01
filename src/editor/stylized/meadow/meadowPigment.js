import { color, dot, fract, mix, pow, smoothstep, uv, vec3 } from 'three/tsl';

import { stylizedPathWearMask } from '../StylizedNoiseNodes.js';
import { meadowNoise } from './meadowNoise.js';

const DEFAULT_PATH_FRINGE_COLOR = '#c2ad62';
const DEFAULT_PATH_FRINGE_STRENGTH = 0.55;

/**
 * The meadow pigment, after grass-test's `#configureMeadowMaterial`: a root that
 * stays dark most of the way up and a lit tip, drifting between cool and warm
 * patches across the field; contact shade and soil at the base so blades meet
 * the ground rather than float on a painted lawn; a per-blade value spread that
 * separates overlapping blades into layers instead of one flat sheet; straw tips
 * along a path's verge.
 */
export function meadowPigment({ uniforms, tuning, config, blade }) {
  const appearance = uniforms.appearance;
  const height = uv().y.clamp(0, 1);
  const patch = meadowNoise(blade.canonical.mul(appearance.patchScale)).mul(0.65)
    .add(meadowNoise(blade.canonical.mul(appearance.patchScale.mul(2.7)).add(19.3)).mul(0.35));
  const tint = mix(uniforms.patchCool, uniforms.patchWarm, smoothstep(0.15, 0.85, patch));
  const palette = uniforms.palette;
  const index = blade.palette.toInt();
  const bottom = palette ? palette.base.element(index) : tuning.colorBottom;
  const top = palette ? palette.tip.element(index) : tuning.colorTop;
  const brightness = palette?.brightness ?? tuning.brightness;
  const root = mix(bottom, top, appearance.groundTipMix).mul(tint);
  let tip = top.mul(tint);
  const fringe = config.path?.fringe ?? {};
  if (fringe.enabled !== false) {
    const wear = stylizedPathWearMask(blade.path, blade.canonical, {
      vergeWidth: config.path?.vergeWidth ?? 0.45,
      vergeCut: config.path?.vergeCut ?? 0.72,
      edgeScale: config.path?.edgeScale ?? 0.42,
      edgeWarp: config.path?.edgeWarp ?? 0.18,
    });
    const straw = color(fringe.color ?? DEFAULT_PATH_FRINGE_COLOR)
      .mul(dot(tip, vec3(0.3, 0.59, 0.11)).mul(1.6).add(0.35));
    tip = mix(tip, straw, wear.verge.mul(fringe.strength ?? DEFAULT_PATH_FRINGE_STRENGTH).clamp(0, 1));
  }
  const pigment = mix(root, tip, pow(height, appearance.gradientPower));
  const rootShade = mix(appearance.rootBrightness, 1, smoothstep(0, appearance.canopyDepth.max(0.01), height));
  const soil = root.mul(0.75);
  const based = mix(soil, pigment, smoothstep(0, 0.18, height));
  const variation = mix(vec3(0.93, 1, 0.9), vec3(1.07, 1, 0.86), blade.variation);
  const bladeValue = fract(blade.rank.mul(0.618034)).sub(0.5).mul(appearance.valueJitter).add(1);
  return {
    pigment,
    bladeValue,
    color: based.mul(rootShade).mul(variation).mul(bladeValue).mul(brightness),
    height,
  };
}
