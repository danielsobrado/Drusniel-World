import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';

/**
 * Light for unlit materials (water, mist) that paint their own colours: how
 * bright the sky's light is, and the tint its reflection takes, both relative
 * to the configured look so that look renders exactly as authored. Written by
 * the sky whenever its look changes.
 */
export const skyLightUniforms = {
  brightness: uniform(1),
  reflectionTint: uniform(new THREE.Color(1, 1, 1)),
};

const base = new THREE.Color();
const current = new THREE.Color();

function channelRatio(to, from) {
  return from > 1e-4 ? Math.min(2, to / from) : 1;
}

/** Brightness and reflection tint of `look` against the configured `baseLook`. */
export function skyLightFor(look, baseLook) {
  const baseLight = baseLook.ambientIntensity + baseLook.directionalIntensity;
  const light = look.ambientIntensity + look.directionalIntensity;
  base.set(baseLook.lowColor);
  current.set(look.lowColor);
  return {
    brightness: baseLight > 0 ? Math.min(1.5, light / baseLight) : 1,
    tint: [
      channelRatio(current.r, base.r),
      channelRatio(current.g, base.g),
      channelRatio(current.b, base.b),
    ],
  };
}

export function updateSkyLight(look, baseLook) {
  const { brightness, tint } = skyLightFor(look, baseLook);
  skyLightUniforms.brightness.value = brightness;
  skyLightUniforms.reflectionTint.value.setRGB(tint[0], tint[1], tint[2]);
}
