import { cos, float, sin, vec2 } from 'three/tsl';

/**
 * Open-sea swell (after grass-test's sea waves): five long directional
 * components of a sharpened sine, spread over ~70° with unequal wavelengths so
 * they never settle into regular rows.
 *
 * The sea is planet-sized, so a wave's phase is never computed from canonical
 * coordinates in the shader: at millions of metres float32 steps a quarter
 * metre and the waves would jitter. Each water chunk instead gets its
 * components' phase at the chunk centre, computed here in double precision and
 * wrapped to [0, 2π) (`seaSwellPhaseOrigin`), and the shader only adds the
 * phase across the chunk.
 *
 * Height is in units of the local amplitude; the caller scales it by an
 * envelope that falls to zero in shallow water, so the waterline stays put.
 */

const TAU = Math.PI * 2;
const GRAVITY = 9.81;
/** Slows the swell below true deep-water speed, which reads as frantic at this scale. */
const PHASE_SPEED_SCALE = 0.55;

export const SEA_SWELL_COMPONENTS = Object.freeze([
  // wavelength m, weight, direction x, z, phase
  [42, 0.53, 1, 0.22, 0],
  [26, 0.29, 0.72, -0.69, 1.3],
  [17, 0.1, 0.58, 0.81, 3.1],
  [11, 0.05, 0.97, -0.24, 0.8],
  [7.5, 0.03, 0.26, 0.97, 4.6],
].map(([wavelength, weight, x, z, phase]) => {
  const length = Math.hypot(x, z);
  return Object.freeze({
    wavelength,
    weight,
    x: x / length,
    z: z / length,
    phase,
    waveNumber: TAU / wavelength,
    angularSpeed: Math.sqrt(GRAVITY * TAU / wavelength) * PHASE_SPEED_SCALE,
  });
}));

export const SEA_SWELL_WEIGHT_SUM = SEA_SWELL_COMPONENTS.reduce((sum, wave) => sum + wave.weight, 0);

function wrapPhase(value) {
  const wrapped = value % TAU;
  return wrapped < 0 ? wrapped + TAU : wrapped;
}

/** Each component's phase at a canonical point, wrapped, for a chunk's origin uniforms. */
export function seaSwellPhaseOrigin(x, z) {
  return SEA_SWELL_COMPONENTS.map((wave) => wrapPhase((x * wave.x + z * wave.z) * wave.waveNumber + wave.phase));
}

/** A sine sharpened toward its crests; zero mean, peak about 1. */
export function seaWaveShape(phase, sharpness) {
  const s = Math.sin(phase);
  return (s + sharpness * (s * s - 0.5)) / (1 + sharpness * 0.5);
}

/**
 * Normalised swell height (about −1..1) at a canonical point and time. The
 * shader's twin, for gameplay that should ride the same waves.
 */
export function sampleSeaSwellCpu(x, z, time, sharpness) {
  let height = 0;
  for (const wave of SEA_SWELL_COMPONENTS) {
    height += wave.weight * seaWaveShape(
      (x * wave.x + z * wave.z) * wave.waveNumber + wave.phase + wrapPhase(time * wave.angularSpeed),
      sharpness,
    );
  }
  return height / SEA_SWELL_WEIGHT_SUM;
}

/**
 * The swell as TSL nodes.
 *
 * @param {object} options
 * @param {object} options.localXZ vec2 node: metres from the chunk centre, canonical axes
 * @param {Array<object>} options.phaseOrigin one float node per component (seaSwellPhaseOrigin)
 * @param {object} options.time seconds
 * @param {object} options.sharpness float node
 * @returns {{ height: object, slope: object, phases: Array<object> }} normalised height,
 *   its gradient per metre, and each component's phase (precision-safe, for patterns)
 */
export function createSeaSwellNodes({ localXZ, phaseOrigin, time, sharpness }) {
  let height = float(0);
  let slope = vec2(0, 0);
  const phases = [];
  const norm = sharpness.mul(0.5).add(1);
  SEA_SWELL_COMPONENTS.forEach((wave, index) => {
    const phase = phaseOrigin[index]
      .add(localXZ.x.mul(wave.x * wave.waveNumber))
      .add(localXZ.y.mul(wave.z * wave.waveNumber))
      .add(time.mul(wave.angularSpeed).mod(TAU));
    phases.push(phase);
    const s = sin(phase);
    const c = cos(phase);
    const shape = s.add(sharpness.mul(s.mul(s).sub(0.5))).div(norm);
    const derivative = c.add(sharpness.mul(s.mul(c).mul(2))).div(norm);
    height = height.add(shape.mul(wave.weight / SEA_SWELL_WEIGHT_SUM));
    slope = slope.add(vec2(wave.x, wave.z).mul(derivative.mul(wave.weight * wave.waveNumber / SEA_SWELL_WEIGHT_SUM)));
  });
  return { height, slope, phases };
}
