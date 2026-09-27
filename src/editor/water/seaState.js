import { uniform } from 'three/tsl';
import { sampleSeaSwellCpu } from './SeaSwell.js';

/**
 * The sea's shared, per-frame state, read by every water material and by
 * gameplay water queries so a swimmer rides the waves that are drawn.
 *
 * Module state like the wind field's, because the materials that read it are
 * built long before anything drives it.
 */
export const seaStateUniforms = Object.freeze({
  /** 0 calm .. 1 storm; raises the swell and lowers the whitecap threshold. */
  storm: uniform(0),
  /** The world's still-water level: only water at this level is sea. */
  seaLevel: uniform(-1.5),
  /** 0 dry .. 1 downpour: rain rings on every water surface. */
  rain: uniform(0),
});

let seaConfig = null;
let seaTime = 0;

export function configureSea(config) {
  seaConfig = config?.enabled ? config : null;
}

export function updateSeaState({ timeSeconds, storm, seaLevel, rain }) {
  if (Number.isFinite(rain)) seaStateUniforms.rain.value = Math.max(0, Math.min(1, rain));
  if (Number.isFinite(timeSeconds)) seaTime = timeSeconds;
  if (Number.isFinite(storm)) seaStateUniforms.storm.value = Math.max(0, Math.min(1, storm));
  if (Number.isFinite(seaLevel)) seaStateUniforms.seaLevel.value = seaLevel;
}

/** Swell sharpness: choppier in a storm. */
export function seaSharpness(config, storm) {
  return config.choppiness * 0.075 * (1 + storm * 0.5);
}

/** Swell amplitude in metres over water `depth` deep: none in the shallows. */
export function seaAmplitude(config, storm, depth) {
  if (!(depth > 0)) return 0;
  const offshore = config.amplitude * (1 + storm * (config.stormScale - 1));
  const shallow = Math.max(0, Math.min(1, depth / config.shallowDepth));
  return Math.min(offshore, depth * config.depthRatio) * shallow * shallow * (3 - 2 * shallow);
}

/** The drawn swell's height, in metres, over canonical sea water `depth` deep. */
export function seaSurfaceOffset(x, z, depth) {
  if (!seaConfig) return 0;
  const storm = seaStateUniforms.storm.value;
  const amplitude = seaAmplitude(seaConfig, storm, depth);
  if (amplitude <= 0) return 0;
  return amplitude * sampleSeaSwellCpu(x, z, seaTime, seaSharpness(seaConfig, storm));
}
