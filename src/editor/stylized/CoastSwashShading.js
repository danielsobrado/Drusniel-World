import {
  abs,
  cos,
  float,
  max,
  mix,
  oneMinus,
  sin,
  smoothstep,
  time,
  vec3,
} from 'three/tsl';
import * as THREE from 'three/webgpu';
import { seaStateUniforms } from '../water/seaState.js';
import { periodicFbm } from './PeriodicNoiseNodes.js';
import { PatternOrigins } from './PatternOrigins.js';

/**
 * Swash on the ground at the sea's edge (after grass-test's coast field).
 *
 * grass-test learned to express the swash as a height above still water, not
 * a distance from the coast: the front forms `breakDepth` down in the
 * shallows, crosses the waterline and runs up the sand, and follows the actual
 * ground wherever the coast is. That is the only form that works here, where
 * coasts come from Azgaar rather than an analytic curve.
 *
 *   film     a thin sheet of water behind the front, glossy and faintly tinted;
 *   foam     a broken line riding the front;
 *   wet      wash memory (the last few fronts, decaying) plus a permanently
 *            damp band just above the waterline: darker and far less rough.
 *
 * A beach has one front per wave. Its timing drifts slowly along the shore
 * with a low-frequency noise, since there is no along-shore coordinate.
 * Everything is gated to ground within `band` of sea level, so inland ground
 * costs a few ALU ops and nothing changes there.
 *
 * Coasts lie millions of metres from the origin, so the drift noise and the
 * two breakup waves are addressed through per-chunk PatternOrigins rather than
 * canonical positions (`createCoastPatternOrigins`).
 */

export const DEFAULT_COAST_SWASH = Object.freeze({
  enabled: true,
  period: 7.5,
  runupHeight: 1.1,
  breakDepth: 0.5,
  frontBand: 0.08,
  foamCore: 0.02,
  foamWidth: 0.12,
  breakupStrength: 0.3,
  washDecay: 4,
  dampHeight: 0.9,
  wetDarkening: 0.5,
  wetRoughness: 0.28,
  filmRoughness: 0.08,
  filmTint: '#8ccad0',
  filmTintStrength: 0.18,
  foamColor: '#edf8fb',
  foamStrength: 0.85,
});

const TAU = Math.PI * 2;
const MEMORY_CYCLES = Object.freeze([0.15, 0.3, 0.45, 0.6]);
const DRIFT_SCALE = 0.021;
const FRONT_BREAKUP_WAVE = Object.freeze([0.13, 0.09]);
const FOAM_BREAKUP_WAVE = Object.freeze([0.27, -0.21]);

/** The per-chunk pattern origins the swash reads; re-centre them with the terrain chunk. */
export function createCoastPatternOrigins() {
  return new PatternOrigins({
    drift: { scale: DRIFT_SCALE },
    frontBreakup: { wave: FRONT_BREAKUP_WAVE },
    foamBreakup: { wave: FOAM_BREAKUP_WAVE },
  });
}

function colorNode(value) {
  const color = new THREE.Color(value);
  return vec3(color.r, color.g, color.b);
}

/**
 * @param {object} options
 * @param {object} options.localXZ vec2 node: metres from the chunk centre, canonical axes
 * @param {PatternOrigins} options.patternOrigins from `createCoastPatternOrigins`
 * @param {object} options.groundHeight float node, world height of the ground
 * @param {object} [options.config] `stylizedSurface.water.coast`
 * @returns {{ apply: (color: object, roughness: object) => { color: object, roughness: object } } | null}
 */
export function createCoastSwashNodes({
  localXZ,
  patternOrigins,
  groundHeight,
  config = DEFAULT_COAST_SWASH,
}) {
  if (!config.enabled) return null;
  const height = groundHeight.sub(seaStateUniforms.seaLevel);
  const band = smoothstep(-config.breakDepth - 0.2, -config.breakDepth, height)
    .mul(oneMinus(smoothstep(config.runupHeight + 0.2, config.runupHeight + config.dampHeight + 0.4, height)));
  // Slow drift of the wave timing along the shore.
  const drift = periodicFbm(patternOrigins.latticePoint('drift', localXZ)).mul(TAU * 1.6);
  const frontBreakupPhase = patternOrigins.wavePhase('frontBreakup', localXZ);
  const foamBreakupPhase = patternOrigins.wavePhase('foamBreakup', localXZ);
  const phase = time.mul(TAU / config.period).add(drift);
  const frontAt = (samplePhase) => {
    const excursion = oneMinus(cos(samplePhase)).mul(0.5);
    const breakup = sin(frontBreakupPhase.add(samplePhase.mul(0.17)))
      .mul(config.breakupStrength * config.frontBand);
    return excursion.mul(config.runupHeight + config.breakDepth).sub(config.breakDepth).add(breakup);
  };
  const coverageAt = (samplePhase) => {
    const front = frontAt(samplePhase);
    return oneMinus(smoothstep(front.sub(config.frontBand), front.add(config.frontBand), height));
  };
  const front = frontAt(phase);
  const film = coverageAt(phase).mul(band);
  const foamBreakup = smoothstep(0.2, 0.8, sin(foamBreakupPhase.add(phase))
    .mul(0.5).add(0.5));
  const foam = oneMinus(smoothstep(config.foamCore, config.foamWidth, abs(height.sub(front))))
    .mul(float(1 - config.breakupStrength).add(foamBreakup.mul(config.breakupStrength)))
    .mul(film.max(0.3))
    .mul(band);
  let memory = film;
  for (const cyclesAgo of MEMORY_CYCLES) {
    memory = max(memory, coverageAt(phase.sub(TAU * cyclesAgo)).mul(Math.exp(-cyclesAgo * config.washDecay)));
  }
  const damp = oneMinus(smoothstep(0, config.dampHeight, height));
  const wet = max(memory, damp).mul(band);
  const filmTint = colorNode(config.filmTint);
  const foamColor = colorNode(config.foamColor);

  return {
    apply(color, roughness) {
      let result = color.mul(mix(float(1), float(config.wetDarkening), wet));
      result = mix(result, result.mul(filmTint).mul(1.6), film.mul(config.filmTintStrength));
      result = mix(result, foamColor, foam.mul(config.foamStrength));
      let resultRoughness = mix(roughness, float(config.wetRoughness), wet);
      resultRoughness = mix(resultRoughness, float(config.filmRoughness), film);
      resultRoughness = mix(resultRoughness, float(0.72), foam);
      return { color: result, roughness: resultRoughness };
    },
  };
}
