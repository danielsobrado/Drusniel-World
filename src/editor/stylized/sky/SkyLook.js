import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';

import { DEFAULT_SKY_PRESET, SKY_PRESETS } from './SkyPresets.js';

/**
 * A sky look: every value a time of day or the weather changes, resolved from
 * `stylizedSurface.sky` plus a preset. Colours are hex strings, the rest
 * numbers; `night` is a flag for listeners (crickets, not birds).
 */
export const SKY_LOOK_COLORS = Object.freeze([
  'lowColor', 'highColor', 'sunColor', 'sunGlowColor',
  'cloudCore', 'cloudEdge', 'cloudRim',
  'fogColor', 'groundLightColor', 'directionalColor',
]);
export const SKY_LOOK_NUMBERS = Object.freeze([
  'sunElevation', 'sunAzimuth', 'sunEmission', 'sunGlowIntensity',
  'cloudOpacity', 'cloudDensity',
  'ambientIntensity', 'ambientSaturation', 'directionalIntensity', 'fogDensityScale',
  'cloudShadowStrength',
]);
/** The look values the sky material reads, which become its uniforms. */
const MATERIAL_COLORS = Object.freeze(['lowColor', 'highColor', 'sunColor', 'sunGlowColor', 'cloudCore', 'cloudEdge', 'cloudRim']);
const MATERIAL_NUMBERS = Object.freeze(['sunEmission', 'sunGlowIntensity', 'cloudOpacity', 'cloudDensity']);

export function skyPresetNames() {
  return Object.keys(SKY_PRESETS);
}

/** The configured sky with a preset's overrides laid over it. */
export function resolveSkyLook(sky, presetName = DEFAULT_SKY_PRESET) {
  const preset = SKY_PRESETS[presetName] ?? SKY_PRESETS[DEFAULT_SKY_PRESET];
  const look = { night: Boolean(preset.night) };
  for (const key of SKY_LOOK_COLORS) look[key] = preset[key] ?? sky[key];
  for (const key of SKY_LOOK_NUMBERS) look[key] = preset[key] ?? sky[key];
  look.ambientSaturation = preset.ambientSaturation ?? sky.ambientSaturation ?? 1;
  look.fogDensityScale = preset.fogDensityScale ?? 1;
  look.cloudShadowStrength = preset.cloudShadowStrength ?? sky.cloudShadows?.strength ?? 0;
  return look;
}

const mixA = new THREE.Color();
const mixB = new THREE.Color();

function lerpAngle(from, to, t) {
  const delta = ((((to - from) % 360) + 540) % 360) - 180;
  return from + delta * t;
}

/** Between two looks; colours blend in linear space, the sun takes the short way round. */
export function mixSkyLooks(from, to, t) {
  const look = { night: t < 0.5 ? from.night : to.night };
  for (const key of SKY_LOOK_COLORS) {
    look[key] = `#${mixA.set(from[key]).lerp(mixB.set(to[key]), t).getHexString()}`;
  }
  for (const key of SKY_LOOK_NUMBERS) look[key] = from[key] * (1 - t) + to[key] * t;
  look.sunAzimuth = t >= 1 ? to.sunAzimuth : lerpAngle(from.sunAzimuth, to.sunAzimuth, t);
  return look;
}

function greyed(hex, amount, dim) {
  mixA.set(hex);
  const luminance = mixA.r * 0.2126 + mixA.g * 0.7152 + mixA.b * 0.0722;
  mixB.setRGB(luminance, luminance * 1.02, luminance * 1.06);
  return `#${mixA.lerp(mixB, amount).multiplyScalar(1 - dim * amount).getHexString()}`;
}

/** How much each colour darkens under full cover: rain clouds read grey, not white. */
const OVERCAST_DIMMING = Object.freeze({ highColor: 0.35, cloudCore: 0.5, cloudEdge: 0.4, cloudRim: 0.5 });

/**
 * The look under cloud cover: colours drain toward a cool grey, the sun
 * weakens, clouds close up and stop casting distinct shadows, fog thickens.
 * Works for any time of day, so rain at night stays dark.
 *
 * @param {number} amount 0 clear … 1 full overcast
 */
export function overcastSkyLook(look, amount) {
  const t = Math.max(0, Math.min(1, amount));
  if (t === 0) return look;
  const result = { ...look };
  for (const key of SKY_LOOK_COLORS) result[key] = greyed(look[key], t * 0.75, OVERCAST_DIMMING[key] ?? 0.15);
  result.directionalIntensity = look.directionalIntensity * (1 - 0.65 * t);
  result.sunEmission = look.sunEmission * (1 - 0.8 * t);
  result.sunGlowIntensity = look.sunGlowIntensity * (1 - 0.8 * t);
  result.cloudDensity = look.cloudDensity - 0.3 * t;
  result.cloudOpacity = Math.min(1, look.cloudOpacity + 0.3 * t);
  result.cloudShadowStrength = look.cloudShadowStrength * (1 - 0.7 * t);
  result.fogDensityScale = look.fogDensityScale * (1 + 0.6 * t);
  return result;
}

/** Uniforms for the look values the sky material reads. */
export function createSkyLookUniforms(look) {
  const uniforms = {};
  for (const key of MATERIAL_COLORS) uniforms[key] = uniform(new THREE.Color(look[key]));
  for (const key of MATERIAL_NUMBERS) uniforms[key] = uniform(look[key]);
  return uniforms;
}

export function writeSkyLookUniforms(uniforms, look) {
  for (const key of MATERIAL_COLORS) uniforms[key].value.set(look[key]);
  for (const key of MATERIAL_NUMBERS) uniforms[key].value = look[key];
}
