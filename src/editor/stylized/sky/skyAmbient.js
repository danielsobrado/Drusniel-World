import * as THREE from 'three/webgpu';

/**
 * The sky's light on the world — the hemisphere light's sky colour — for a
 * look.
 *
 * What a surface receives from the sky integrates the whole visible dome: the
 * paler band toward the horizon, the sun's aureole and the clouds, not only the
 * zenith. It is therefore much less saturated than the dome's zenith colour
 * (`highColor`), which the hemisphere used to take directly and which turned
 * every face out of the sun slate blue — worst on light, warm stone.
 * `ambientSaturation` keeps that share of the zenith colour's saturation at the
 * same luminance, so shaded surfaces keep the brightness the looks were tuned
 * with and only their hue moves. 1 is the zenith colour itself.
 *
 * @param {{ highColor: string, ambientSaturation?: number }} look
 * @param {THREE.Color} [target]
 */
export function skyAmbientColor(look, target = new THREE.Color()) {
  target.set(look.highColor);
  const saturation = Math.max(0, Math.min(1, look.ambientSaturation ?? 1));
  if (saturation === 1) return target;
  const luminance = target.r * 0.2126 + target.g * 0.7152 + target.b * 0.0722;
  return target.setRGB(
    luminance + (target.r - luminance) * saturation,
    luminance + (target.g - luminance) * saturation,
    luminance + (target.b - luminance) * saturation,
  );
}
