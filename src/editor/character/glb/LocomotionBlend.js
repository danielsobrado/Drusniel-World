/**
 * Speed → how much standing, walking and running to show, and where in the
 * stride the legs are.
 *
 * The phase follows the rule the procedural drow was built on (`gait.js`): it
 * advances by *distance travelled over the stride*, not by time. Each authored
 * clip covers a fixed stride per cycle (its calibrated ground speed times its
 * duration), so advancing the phase by distance ÷ stride plants the feet for
 * any speed, at any frame rate, and walk and run can blend at one shared phase.
 *
 * This game moves far faster than the clips were authored for — a 9 m/s walk
 * and a 16.2 m/s sprint against a 4.4 m/s run — so the playback multiple is
 * capped (`maxTimeScale`). Beyond it the cadence would blur into vibration;
 * the feet slide a little instead, which reads as a sprinter's glide.
 *
 * Pure arithmetic: no three.js, no allocation per update.
 */

/** Below this ground speed the figure is standing. Matches `CharacterMotionState`. */
export const STANDING_SPEED = 0.2;

/** Walking fills in by this share of the walk clip's own speed. */
const WALK_FULL_SHARE = 0.5;
/** Running begins past this multiple of the walk clip's speed... */
const RUN_START_SHARE = 1.3;
/** ...and has taken over by this share of the run clip's speed. */
const RUN_FULL_SHARE = 0.8;
/** Per-second rate at which the blend weights follow their targets. */
const WEIGHT_RATE = 10;

function clamp(value, minimum, maximum) {
  return value < minimum ? minimum : value > maximum ? maximum : value;
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function approach(current, target, dt) {
  return target + (current - target) * Math.exp(-WEIGHT_RATE * dt);
}

export class LocomotionBlend {
  /**
   * @param {object} options
   * @param {number} options.height character height, metres
   * @param {{ walk: number, run: number }} options.clipSpeedInHeights
   * @param {{ walk: number, run: number }} options.durations clip lengths, seconds
   * @param {{ maxTimeScale: number, minTimeScale: number }} options.limits
   */
  constructor({ height, clipSpeedInHeights, durations, limits }) {
    this.walkSpeed = height * clipSpeedInHeights.walk;
    this.runSpeed = height * clipSpeedInHeights.run;
    this.walkDuration = durations.walk;
    this.runDuration = durations.run;
    this.walkStride = this.walkSpeed * this.walkDuration;
    this.runStride = this.runSpeed * this.runDuration;
    this.maxTimeScale = limits.maxTimeScale;
    this.minTimeScale = limits.minTimeScale;

    this.walkFullSpeed = Math.max(STANDING_SPEED + 0.01, this.walkSpeed * WALK_FULL_SHARE);
    this.runStartSpeed = this.walkSpeed * RUN_START_SHARE;
    this.runFullSpeed = Math.max(this.runStartSpeed + 0.1, this.runSpeed * RUN_FULL_SHARE);

    this.idle = 1;
    this.walk = 0;
    this.run = 0;
    /** Shared cycle position of walk and run, 0..1. */
    this.phase = 0;
    /** Playback multiple the legs are actually shown at. */
    this.timeScale = 0;
  }

  reset() {
    this.idle = 1;
    this.walk = 0;
    this.run = 0;
    this.timeScale = 0;
  }

  /**
   * @param {number} dt seconds
   * @param {number} speed ground speed, m/s
   * @param {boolean} grounded
   * @param {boolean} swimming
   */
  update(dt, speed, grounded, swimming) {
    const h = clamp(dt, 0, 1 / 15);
    if (swimming) {
      // The swim layer poses every limb; underneath it the figure stands, so a
      // stride frozen mid-step never shows through as the layer fades in.
      this._settle(h, 1, 0, 0);
      this.timeScale = 0;
      return this;
    }
    if (!grounded) {
      // Airborne: hold the stride where the jump left it rather than
      // cycling the legs through thin air or dropping into a stand.
      this.timeScale = 0;
      return this;
    }

    const moving = smoothstep(STANDING_SPEED, this.walkFullSpeed, speed);
    const running = smoothstep(this.runStartSpeed, this.runFullSpeed, speed);
    this._settle(h, 1 - moving, moving * (1 - running), moving * running);

    const travelling = this.walk + this.run;
    if (speed < STANDING_SPEED || travelling < 1e-4) {
      this.timeScale = 0;
      return this;
    }
    const runShare = this.run / travelling;
    const stride = this.walkStride + (this.runStride - this.walkStride) * runShare;
    const duration = this.walkDuration + (this.runDuration - this.walkDuration) * runShare;
    this.timeScale = clamp(speed * duration / stride, this.minTimeScale, this.maxTimeScale);
    this._advance(h, this.timeScale / duration);
    return this;
  }

  _settle(h, idle, walk, run) {
    this.idle = approach(this.idle, idle, h);
    this.walk = approach(this.walk, walk, h);
    this.run = approach(this.run, run, h);
    // Keep the three summing to one: the mixer fills any shortfall with the
    // bind pose, which is exactly the A-pose the standing clip exists to hide.
    const total = this.idle + this.walk + this.run;
    if (total > 1e-6) {
      this.idle /= total;
      this.walk /= total;
      this.run /= total;
    }
  }

  _advance(h, cyclesPerSecond) {
    this.phase = (this.phase + cyclesPerSecond * h) % 1;
  }
}
