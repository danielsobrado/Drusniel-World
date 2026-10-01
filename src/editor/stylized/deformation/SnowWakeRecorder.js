import { createSnowWakeState } from './SnowWakeShading.js';

/** Speed smoothing rate, 1/s: enough to ride out a frame spike, not a stride. */
const SPEED_RATE = 6;
/** Below this travel in a frame the body is standing and keeps its last heading. */
const STILL_METRES = 1e-4;

/**
 * The player's walk laid into the deep-snow wake (after grass-test's
 * `SnowSurfWake`): once a frame the body's canonical position goes to the spine,
 * with the heading it is moving along and its ground speed, so the banks bank
 * with the path and a sprint cuts wider and deeper than a walk. Off the ground or
 * in water a sample carries no profile, which leaves a gap rather than a trench
 * across a jump. The terrain gates the wake on baked snow, so walking elsewhere
 * records a trail that simply never draws.
 */
export class SnowWakeRecorder {
  /** @param {object} [state] a `createSnowWakeState` state; one is made if absent */
  constructor(state = createSnowWakeState()) {
    this.state = state;
    this.lastX = 0;
    this.lastZ = 0;
    this.lastClock = null;
    this.rightX = 1;
    this.rightZ = 0;
    this.speed = 0;
  }

  /**
   * @param {number} clock seconds
   * @param {object | null} body canonical `x`, `y`, `z`, plus `grounded` and
   *   `inWater`; null while nobody walks, which only ages the trail
   */
  update(clock, body) {
    if (body) this.#record(clock, body);
    else this.lastClock = null;
    return this.state.sync(clock);
  }

  clear() {
    this.state.clear();
    this.lastClock = null;
    this.speed = 0;
  }

  #record(clock, { x, y, z, grounded, inWater }) {
    if (this.lastClock !== null) {
      const dt = clock - this.lastClock;
      const dx = x - this.lastX;
      const dz = z - this.lastZ;
      const travel = Math.hypot(dx, dz);
      if (dt > 0) {
        const blend = 1 - Math.exp(-SPEED_RATE * dt);
        this.speed += (travel / dt - this.speed) * blend;
      }
      if (travel > STILL_METRES) {
        this.rightX = dz / travel;
        this.rightZ = -dx / travel;
      }
    }
    this.lastX = x;
    this.lastZ = z;
    this.lastClock = clock;
    this.state.record(clock, x, y, z, {
      rightX: this.rightX,
      rightZ: this.rightZ,
      strength: grounded && !inWater ? 1 : 0,
      speed: this.speed,
    });
  }
}

/** The one trail the terrain materials read and the player loop writes. */
export const snowWakeRecorder = new SnowWakeRecorder();
