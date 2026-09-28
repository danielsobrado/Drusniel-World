/**
 * The maths of a wake cut through deep snow (after grass-test's `SnowSurfWake`
 * and its `snowWakeSpine`, itself after Snowflow's `surfWake.js`, MIT, Maksymilian
 * Dendura).
 *
 * A footprint presses one point; a walker or rider presses a *path*. This module
 * is the path: a spine, a cross-section across it, and the two rules that make
 * the mark read as something dragged through powder rather than painted on it —
 * it grows with speed and it settles flat with age.
 *
 * Everything here is pure: no Three.js, no DOM, no clock of its own. The shader
 * module (`SnowWakeShading.js`) packs the spine into uniforms and re-evaluates
 * the same cross-section per fragment, so this file is both the source of truth
 * for the GPU shape and the thing tests can check without a renderer.
 */

/** Recent positions kept; the trail is bounded, so cost never grows with a run. */
export const SNOW_WAKE_CAPACITY = 24;
/** Metres of travel between committed samples; also the stamp kernel's length. */
export const SNOW_WAKE_STEP = 0.35;
/** The deepest the cut may reach, metres. Saturates here rather than growing. */
export const SNOW_WAKE_MAX_DEPTH = 0.22;
/** Outer half-width of the banks, metres: the cut plus both berms. */
export const SNOW_WAKE_MAX_WIDTH = 0.9;
/** Ground speed (m/s) at which depth and width are most of the way to their cap. */
export const SNOW_WAKE_FULL_SPEED = 6;
/** Seconds a mark takes to settle back to flat. */
export const SNOW_WAKE_LIFETIME = 25;
/**
 * Where the cut runs out, as a fraction of the outer half-width: the floor is
 * flat to here, then the berms rise. Past the outer edge is untouched snow, so
 * the trail has no cut lip of its own — a moving body displaces the snow it
 * crosses and piles the rest at the sides, and the sides are the whole profile.
 */
export const SNOW_WAKE_CUT_FRACTION = 0.5;
/** Berm height as a share of the cut depth, so banks stay tied to the trench. */
export const SNOW_WAKE_BERM_SHARE = 0.5;

function clamp01(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function smoothstep01(edge0, edge1, value) {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * The surface offset across the trail, in metres: negative inside the cut,
 * positive over the two berms, zero past the banks. Symmetric in `lateral`, and
 * evaluated from |lateral| so the two berms are the same shape mirrored — a
 * symmetric profile needs no side and no normal.
 *
 * @param {number} lateral signed distance from the spine, metres
 * @param {number} depth cut depth, metres (already speed-scaled)
 * @param {number} width outer half-width of the banks, metres
 */
export function wakeCrossSection(lateral, depth, width) {
  if (!(depth > 0) || !(width > 0)) return 0;
  const t = Math.min(Math.abs(lateral) / width, 1);
  // The cut is full at the spine and runs out at CUT_FRACTION; the berm is a hump
  // peaking midway between the cut edge and the outer edge, zero either side.
  const cut = 1 - smoothstep01(0, SNOW_WAKE_CUT_FRACTION, t);
  const peak = (SNOW_WAKE_CUT_FRACTION + 1) * 0.5;
  const berm = smoothstep01(SNOW_WAKE_CUT_FRACTION, peak, t)
    * (1 - smoothstep01(peak, 1, t));
  return depth * (berm * SNOW_WAKE_BERM_SHARE - cut);
}

/**
 * Cut depth for a ground speed. Exponential approach to the cap: a walk barely
 * scratches, a sprint digs nearly the full depth, and a runaway speed cannot
 * tunnel through the world because the value is bounded by `maxDepth`.
 */
export function wakeDepthForSpeed(speed, {
  maxDepth = SNOW_WAKE_MAX_DEPTH,
  fullSpeed = SNOW_WAKE_FULL_SPEED,
} = {}) {
  if (!(speed > 0)) return 0;
  return maxDepth * (1 - Math.exp(-speed / fullSpeed));
}

/** Outer half-width for a ground speed: the faster the body, the wider it ploughs. */
export function wakeWidthForSpeed(speed, {
  maxWidth = SNOW_WAKE_MAX_WIDTH,
  fullSpeed = SNOW_WAKE_FULL_SPEED,
} = {}) {
  if (!(speed > 0)) return 0;
  return maxWidth * (1 - Math.exp(-speed / fullSpeed));
}

/**
 * How much of the profile is left after `ageSeconds`: 1 when just laid, easing
 * to 0 (flat) at the lifetime and held at 0 after it. The square makes the
 * collapse quickest at the end, matching snow slumping as it settles, and the
 * clamp keeps it from ever going past flat — a wake must not lift the ground it
 * has stopped marking.
 */
export function wakeFade(ageSeconds, lifetime = SNOW_WAKE_LIFETIME) {
  const t = clamp01(ageSeconds / lifetime);
  const remaining = 1 - t;
  return remaining * remaining;
}

/**
 * The trail of recent positions, as a ring. Samples are committed every `step`
 * metres of horizontal travel, placed exactly on the segment from the last
 * sample to the body so spacing stays uniform however large the frame step is.
 *
 * The count is bounded by the capacity and the head wraps, so the oldest sample
 * falls off the back: a body can run forever without the trail growing, and a
 * teleport longer than the whole ring starts a new trail instead of sweeping a
 * wall of snow across the gap between the two places.
 */
export class SnowWakeSpine {
  constructor({ capacity = SNOW_WAKE_CAPACITY, step = SNOW_WAKE_STEP } = {}) {
    if (!(capacity >= 2)) throw new Error('A wake spine needs capacity for at least a segment.');
    if (!(step > 0)) throw new Error('A wake spine needs a positive sample step.');
    this.capacity = capacity;
    this.step = step;
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.z = new Float32Array(capacity);
    this.rightX = new Float32Array(capacity);
    this.rightZ = new Float32Array(capacity);
    this.laid = new Float32Array(capacity);
    this.strength = new Float32Array(capacity);
    this.speed = new Float32Array(capacity);
    this.head = 0;
    this.count = 0;
  }

  reset() {
    this.count = 0;
  }

  /**
   * @param {number} clock seconds the sample is being laid at
   * @param {object} [motion]
   * @param {number} [motion.rightX] the body's right axis, so banks bank with it
   * @param {number} [motion.rightZ]
   * @param {number} [motion.strength] 0..1 how much of the profile this sample carries
   * @param {number} [motion.speed] ground speed, metres/second
   * @returns {number} how many samples were committed this call
   */
  update(clock, x, y, z, {
    rightX = 0,
    rightZ = 1,
    strength = 1,
    speed = 0,
  } = {}) {
    if (this.count > 0) {
      let lastX = this.x[this.head];
      let lastY = this.y[this.head];
      let lastZ = this.z[this.head];
      let dx = x - lastX;
      let dz = z - lastZ;
      let distance = Math.hypot(dx, dz);
      if (distance <= this.step * this.capacity) {
        let committed = 0;
        while (distance >= this.step) {
          const t = this.step / distance;
          lastX += dx * t;
          lastY += (y - lastY) * t;
          lastZ += dz * t;
          this.#commit(clock, lastX, lastY, lastZ, rightX, rightZ, strength, speed);
          committed += 1;
          dx = x - lastX;
          dz = z - lastZ;
          distance = Math.hypot(dx, dz);
        }
        return committed;
      }
      // A jump longer than the ring is a teleport, not travel: begin again.
      this.reset();
    }
    this.#commit(clock, x, y, z, rightX, rightZ, strength, speed);
    return 1;
  }

  /** Slot index in trail order, 0 oldest → count-1 newest. */
  indexAt(order) {
    return (this.head - this.count + 1 + order + this.capacity) % this.capacity;
  }

  #commit(clock, x, y, z, rightX, rightZ, strength, speed) {
    this.head = (this.head + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
    this.x[this.head] = x;
    this.y[this.head] = y;
    this.z[this.head] = z;
    this.rightX[this.head] = rightX;
    this.rightZ[this.head] = rightZ;
    this.laid[this.head] = clock;
    this.strength[this.head] = strength;
    this.speed[this.head] = speed;
  }
}

/**
 * The signed surface offset the trail leaves at a point, for CPU tests and for
 * callers that want the profile the shader draws. A point is placed against the
 * nearest segment of the spine and the cross-section is read at that lateral
 * distance, aged by how long ago that segment was laid.
 *
 * A spine of fewer than two samples is a body that has not moved: there is no
 * segment to be beside, so the offset is exactly zero. It returns the value of
 * largest magnitude across segments rather than a sum — overlapping segments
 * would otherwise multiply the depth and a walk would cut deeper than a sprint.
 *
 * @param {SnowWakeSpine} spine
 * @param {number} x canonical metres
 * @param {number} z canonical metres
 * @param {object} [options]
 * @param {number} [options.speed] ground speed the depth/width come from
 * @param {number} [options.clock] seconds, for ageing
 * @param {number} [options.life] seconds a mark lasts
 * @param {number} [options.depth] override the speed-derived cut depth
 * @param {number} [options.width] override the speed-derived half-width
 */
export function wakeSurfaceAt(spine, x, z, {
  speed = 0,
  clock = 0,
  life = SNOW_WAKE_LIFETIME,
  depth = wakeDepthForSpeed(speed),
  width = wakeWidthForSpeed(speed),
} = {}) {
  if (spine.count < 2 || !(depth > 0) || !(width > 0)) return 0;
  let best = 0;
  for (let order = 0; order < spine.count - 1; order += 1) {
    const a = spine.indexAt(order);
    const b = spine.indexAt(order + 1);
    const ax = spine.x[a];
    const az = spine.z[a];
    const dx = spine.x[b] - ax;
    const dz = spine.z[b] - az;
    const lengthSquared = dx * dx + dz * dz;
    const t = lengthSquared > 1e-12
      ? clamp01(((x - ax) * dx + (z - az) * dz) / lengthSquared)
      : 0;
    const closestX = ax + dx * t;
    const closestZ = az + dz * t;
    const lateral = Math.hypot(x - closestX, z - closestZ);
    const laid = spine.laid[a] + (spine.laid[b] - spine.laid[a]) * t;
    const strength = spine.strength[a] + (spine.strength[b] - spine.strength[a]) * t;
    const fade = wakeFade(Math.max(0, clock - laid), life);
    const offset = wakeCrossSection(lateral, depth, width) * fade * strength;
    if (Math.abs(offset) > Math.abs(best)) best = offset;
  }
  return best;
}
