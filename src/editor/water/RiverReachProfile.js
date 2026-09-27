/**
 * The water level along one river reach, and the falls in it.
 *
 * Azgaar river points sit about a hundred kilometres apart on a planet-scale
 * map. A straight surface between two of them floats hundreds of metres over
 * the valleys in between, so the level is traced densely instead (see
 * RiverSurfaceProfile): one sample per `profileStepMeters`, each the lower of
 * the terrain there and the level upstream. The river therefore never runs
 * uphill and never floats, and where the ground rises again it cuts a gorge.
 *
 * Where that trace drops at least `falls.minimumHeight` within one step, the
 * drop is a waterfall: the water runs level to the face and falls over
 * `height / faceSlope` metres — so the carved bed makes a cliff — with drops
 * above `maximumHeight` split into a cascade. Everywhere else the level ramps
 * linearly between samples. Everything is a pure function of the samples, so
 * chunk workers, collision and rendering agree on every fall.
 *
 * Positions `t` are fractions of the reach, 0 upstream and 1 downstream.
 */

/** Plunge churn is ignored past this many decay lengths. */
const PLUNGE_REACH = 5;
/** Soft shoulder, as a share of the face, over which a fall's weight fades in and out. */
const FACE_SHOULDER = 0.25;
/** A face never takes more than this share of its step, so each fall keeps a pool. */
const MAXIMUM_FACE_SHARE = 0.9;
/** Upstream steps whose plunge can still reach a point. */
const PLUNGE_LOOKBACK = 3;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function smoothstep(edge0, edge1, value) {
  if (edge1 <= edge0) return value < edge0 ? 0 : 1;
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * @param {ArrayLike<number>} levels water level at each of `steps + 1` evenly spaced samples
 * @param {number} lengthMeters
 * @param {object} config `waterDomain.falls`
 */
export function createReachProfile(levels, lengthMeters, config) {
  const steps = levels.length - 1;
  if (steps < 1 || !(lengthMeters > 0)) {
    throw new Error('A river reach profile needs at least two samples and a positive length.');
  }
  const stepMeters = lengthMeters / steps;
  const fallCounts = new Uint8Array(steps);
  const halfWidths = new Float32Array(steps);
  const fallSteps = [];
  if (config?.enabled) {
    for (let step = 0; step < steps; step += 1) {
      const drop = levels[step] - levels[step + 1];
      if (!(drop >= config.minimumHeight)) continue;
      const count = Math.min(255, Math.ceil(drop / config.maximumHeight));
      const faceMeters = drop / count / config.faceSlope;
      fallCounts[step] = count;
      halfWidths[step] = Math.min(MAXIMUM_FACE_SHARE / count, faceMeters / stepMeters) * 0.5;
      fallSteps.push(step);
    }
  }
  return Object.freeze({
    steps,
    stepMeters,
    levels: Float32Array.from(levels),
    fallCounts,
    halfWidths,
    fallSteps: Int32Array.from(fallSteps),
    plungeScale: config?.plungeDecayMeters ? stepMeters / config.plungeDecayMeters : 0,
  });
}

function locate(profile, t) {
  const position = clamp(t, 0, 1) * profile.steps;
  const step = Math.min(profile.steps - 1, Math.floor(position));
  return { step, u: position - step };
}

/** Water level at fraction `t` along a reach. */
export function reachSurfaceAt(profile, t) {
  const { step, u } = locate(profile, t);
  const start = profile.levels[step];
  const end = profile.levels[step + 1];
  const count = profile.fallCounts[step];
  if (count === 0) return start + (end - start) * u;
  const halfWidth = profile.halfWidths[step];
  const height = (start - end) / count;
  let level = start;
  for (let index = 0; index < count; index += 1) {
    const center = (index + 0.5) / count;
    level -= height * smoothstep(center - halfWidth, center + halfWidth, u);
  }
  return level;
}

/** 0..1: how much of the point at `t` is a falling face. */
export function reachFallAt(profile, t) {
  const { step, u } = locate(profile, t);
  const count = profile.fallCounts[step];
  let weight = 0;
  for (let index = 0; index < count; index += 1) {
    const center = (index + 0.5) / count;
    const halfWidth = profile.halfWidths[step];
    const shoulder = halfWidth * FACE_SHOULDER;
    const inside = smoothstep(center - halfWidth - shoulder, center - halfWidth + shoulder, u)
      * (1 - smoothstep(center + halfWidth - shoulder, center + halfWidth + shoulder, u));
    weight = Math.max(weight, inside);
  }
  return weight;
}

/** 0..1: churn in the plunge pool below the nearest upstream fall. */
export function reachPlungeAt(profile, t) {
  const position = clamp(t, 0, 1) * profile.steps;
  const current = Math.min(profile.steps - 1, Math.floor(position));
  let weight = 0;
  for (let step = current; step >= Math.max(0, current - PLUNGE_LOOKBACK); step -= 1) {
    const count = profile.fallCounts[step];
    for (let index = 0; index < count; index += 1) {
      const foot = step + (index + 0.5) / count + profile.halfWidths[step];
      const decays = (position - foot) * profile.plungeScale;
      if (decays < 0 || decays > PLUNGE_REACH) continue;
      weight = Math.max(weight, Math.exp(-decays));
    }
  }
  return weight;
}

/** Every fall on a reach: lip and foot as fractions of the reach, and its drop in metres. */
export function reachFalls(profile) {
  const falls = [];
  for (const step of profile.fallSteps) {
    const count = profile.fallCounts[step];
    const halfWidth = profile.halfWidths[step];
    const drop = (profile.levels[step] - profile.levels[step + 1]) / count;
    for (let index = 0; index < count; index += 1) {
      const center = step + (index + 0.5) / count;
      falls.push({
        lip: (center - halfWidth) / profile.steps,
        foot: (center + halfWidth) / profile.steps,
        drop,
      });
    }
  }
  return falls;
}
