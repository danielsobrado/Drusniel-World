/**
 * A procedural star field for the WebGPU sky.
 *
 * Two clearly separated halves:
 *
 *   1. PURE MATHS (no Three.js) — a deterministic hash, a direction on the dome,
 *      a magnitude distribution and a rotation. This is what tests and any CPU
 *      caller use; it needs no GPU and no renderer.
 *   2. TSL (three/tsl) — the same idea expressed as a node graph the sky material
 *      can add on top of its gradient. The GPU hash is a polynomial hash over
 *      lattice cells, matching the family already used in StylizedNoiseNodes; it
 *      is deliberately *not* the CPU integer hash, because the two run in
 *      different number spaces and a star field does not need them to agree
 *      exactly (unlike wind, which does).
 *
 * Stars are laid out on a 3D lattice over the dome rather than in latitude and
 * longitude: a lat/long grid crowds into a pole and stretches at the equator,
 * which would show as a bright knot overhead and banding near the horizon. A 3D
 * cell has the same area everywhere, so a magnitude distribution reads evenly
 * wherever you look.
 *
 * No Math.random: every star is a function of its index and a seed, so the field
 * is identical run to run and replayable in a test.
 */

import {
  clamp,
  color,
  cos,
  cross,
  dot,
  float,
  floor,
  fract,
  length,
  mix,
  normalize,
  oneMinus,
  pow,
  sin,
  smoothstep,
  step,
  vec3,
} from 'three/tsl';

// ---------------------------------------------------------------------------
// 1. Pure maths — deterministic, no Three.js, no DOM.
// ---------------------------------------------------------------------------

const TWO_PI = Math.PI * 2;
const DEG_TO_RAD = Math.PI / 180;

/** Avalanching 32-bit integer hash. Integer-only so it is exact and portable. */
function hashUint(value) {
  let h = value | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** A hash in [0, 1) for an index and seed. */
export function hash01(index, seed = 0) {
  const key = Math.imul(index | 0, 0x9e3779b1) ^ Math.imul(seed | 0, 0x85ebca6b);
  return hashUint(key) / 4294967296;
}

/**
 * A unit direction on the dome for a star index. Uniform over the sphere: the
 * y component is unrolled uniformly and the ring angle spun from a second hash,
 * which is exactly Archimedes' hat-box — equal area per y band, no pole knot.
 */
export function starDirection(index, seed = 0) {
  const u1 = hash01(index, seed + 11);
  const u2 = hash01(index, seed + 23);
  const y = 1 - 2 * u1; // [-1, 1]
  const radius = Math.sqrt(Math.max(0, 1 - y * y));
  const phi = TWO_PI * u2;
  return { x: radius * Math.cos(phi), y, z: radius * Math.sin(phi) };
}

/** Elevation of a star direction, in degrees (matches the sky's y = sin(el)). */
export function starElevationDegrees(direction) {
  return Math.asin(Math.max(-1, Math.min(1, direction.y))) / DEG_TO_RAD;
}

/**
 * Star brightness in [0, 1]. Real skies have many faint stars and few bright
 * ones, so a uniformly hashed draw is raised to a power: brightness is
 * `u ** magnitudePower`, and only the top slice of `u` reads as a bright star.
 */
export function starMagnitude(index, seed = 0, magnitudePower = 3) {
  return hash01(index, seed + 41) ** magnitudePower;
}

/** Whether a lattice cell holds a star, from its share `presence` in [0, 1]. */
export function starPresence(index, seed, presence) {
  return hash01(index, seed + 17) < presence;
}

/**
 * Rotate a direction about the celestial pole (the dome's y axis). The inverse
 * of this is what the shader applies, so sampling the lattice at the rotated
 * direction makes the rendered field turn by +`angleDegrees`.
 */
export function rotateStarDirection(direction, angleDegrees) {
  const angle = angleDegrees * DEG_TO_RAD;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return {
    x: direction.x * c + direction.z * s,
    y: direction.y,
    z: -direction.x * s + direction.z * c,
  };
}

/**
 * A testable, CPU list of `count` stars. Deterministic for a given count and
 * seed; `directions` lie on the unit dome and magnitudes in [0, 1].
 */
export function starList(count, seed = 0, { presence = 1, magnitudePower = 3 } = {}) {
  const stars = [];
  for (let index = 0; index < count; index += 1) {
    if (!starPresence(index, seed, presence)) continue;
    stars.push({
      index,
      direction: starDirection(index, seed),
      magnitude: starMagnitude(index, seed, magnitudePower),
    });
  }
  return stars;
}

/** Rotation of the whole field in degrees, from elapsed seconds and a rate. */
export function starRotationDegrees(timeSeconds, degreesPerSecond) {
  return timeSeconds * degreesPerSecond;
}

export const STAR_FIELD_DEFAULTS = Object.freeze({
  density: 160,
  presence: 0.4,
  magnitudePower: 3,
  rotationDegreesPerSecond: 0.5,
  brightness: 1,
});

// ---------------------------------------------------------------------------
// 2. TSL — the same field as a node graph for the sky material.
// ---------------------------------------------------------------------------

/**
 * A polynomial hash over a lattice cell, mirroring StylizedNoiseNodes' `hash2`
 * in 3D. Cell coordinates here are small (a unit direction times a density of a
 * few hundred), so `fract` has plenty of float32 bits and the planet-scale
 * precision trap that hits world-space noise does not apply.
 */
function tslHash3(cell, seed) {
  const seeded = cell.add(vec3(seed));
  let p = fract(seeded.mul(vec3(127.1, 311.7, 74.7)));
  p = p.add(dot(p, p.add(19.19)));
  return fract(p.mul(vec3(127.1, 311.7, 74.7)));
}

/**
 * Star radiance for a view direction, as a vec3 node the sky adds over its
 * gradient (dimmed by night, before clouds).
 *
 * How it works, and why it needs no neighbour sampling: the direction is snapped
 * into a lattice cell, the cell hashes to one star, and the pixel's distance to
 * that star lights it. A cell's star is kept within +/-0.2 of the centre and its
 * glow radius below 0.28, so the whole disc always fits inside its own cell — the
 * field is drawn whole without reading adjacent cells.
 *
 * @param {object} options
 * @param {object} options.direction unit view direction node (e.g. normalize(positionLocal))
 * @param {object|null} [options.time] seconds node; the field turns slowly with it
 * @param {number} [options.density] lattice cells across the dome
 * @param {number} [options.presence] share of cells that hold a star, 0..1
 * @param {number} [options.magnitudePower] higher = fewer bright stars
 * @param {number} [options.rotationDegreesPerSecond] slow drift of the whole field
 * @param {number} [options.brightness] overall gain
 */
export function createStarFieldNode({
  direction,
  time = null,
  density = STAR_FIELD_DEFAULTS.density,
  presence = STAR_FIELD_DEFAULTS.presence,
  magnitudePower = STAR_FIELD_DEFAULTS.magnitudePower,
  rotationDegreesPerSecond = STAR_FIELD_DEFAULTS.rotationDegreesPerSecond,
  brightness = STAR_FIELD_DEFAULTS.brightness,
} = {}) {
  const rotation = time ? time.mul(rotationDegreesPerSecond * DEG_TO_RAD) : float(0);
  const c = cos(rotation);
  const s = sin(rotation);
  // Sampling the lattice at the inverse rotation makes the rendered field turn by +rotation.
  const p = vec3(
    direction.x.mul(c).add(direction.z.mul(s)),
    direction.y,
    direction.z.mul(c).sub(direction.x.mul(s)),
  ).mul(float(density));

  const cell = floor(p);
  const local = fract(p);

  const jitter = tslHash3(cell, 0);
  const starPoint = jitter.mul(0.4).add(0.3); // inside +/-0.2 of the cell centre
  const distance = length(local.sub(starPoint));

  const exists = oneMinus(step(float(presence), tslHash3(cell, 17).x));
  const magnitude = pow(tslHash3(cell, 31).x, float(magnitudePower));
  // A brighter star is a slightly bigger one; 0.2 offset + 0.28 radius stays
  // inside the half-cell, so the glow is never cut off at a cell edge.
  const radius = magnitude.mul(0.26).add(0.02);
  const core = pow(oneMinus(clamp(distance.div(radius), float(0), float(1))), float(2));

  const intensity = core.mul(exists).mul(magnitude).mul(float(brightness));
  // Dim stars lean blue-white, bright ones warm-white: a little colour without a palette.
  const tint = mix(vec3(0.72, 0.8, 1.0), vec3(1.0, 0.95, 0.86), tslHash3(cell, 53).x);
  return tint.mul(intensity);
}

/**
 * The moon's disc as a vec3 radiance node the sky adds over its gradient, so a
 * night has two bodies in it and they never read as the same one.
 *
 * It is deliberately not a second sun: a cooler colour, a softer edge, and a
 * phase. The phase is a terminator across the disc's own horizontal axis — the
 * share lit is `illumination`, so a new moon draws nothing, a full moon the whole
 * disc, and the lit limb swaps as the share crosses half. The tangential
 * coordinate is normalised with a floored length so the terminator is a clean
 * line and a fragment dead-on the moon cannot divide by zero.
 *
 * @param {object} options
 * @param {object} options.direction unit view direction node
 * @param {object} options.moonDirection unit direction toward the moon
 * @param {object} [options.illumination] 0..1 share of the disc lit
 * @param {object} [options.mask] 0..1 of the sky that is clear (clouds hide it)
 * @param {number} [options.size] radians: the disc's angular radius
 * @param {number} [options.softness] radians of edge softening
 * @param {number} [options.emission] overall gain
 * @param {string} [options.color] body colour
 */
export function createMoonDiscNode({
  direction,
  moonDirection,
  illumination = float(1),
  mask = float(1),
  size = 0.012,
  softness = 0.02,
  emission = 0.6,
  color: bodyColor = '#dfe6ff',
} = {}) {
  const alignment = dot(direction, moonDirection);
  const disc = smoothstep(Math.cos(size + softness), Math.cos(size), alignment);
  // A right axis across the disc, so the terminator runs up it like a phase.
  const right = normalize(cross(vec3(0, 1, 0), moonDirection));
  const relative = direction.sub(moonDirection.mul(alignment));
  const phaseX = dot(relative, right).div(relative.length().max(1e-4));
  const terminator = float(1).sub(illumination.clamp(0, 1).mul(2));
  const lit = smoothstep(terminator.sub(0.5), terminator.add(0.5), phaseX);
  // Even a thin crescent keeps a faint body so the moon does not vanish mid-month.
  const radiance = color(bodyColor).mul(float(0.1).add(lit.mul(0.9))).mul(float(emission));
  return radiance.mul(disc).mul(mask);
}
