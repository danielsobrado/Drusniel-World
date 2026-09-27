/**
 * Player motion in water → how the body should swim.
 *
 * None of the roster rigs ships a swim clip, so swimming is posed procedurally
 * (`SwimStroke.js`). This decides the numbers that pose is driven by:
 *
 *   weight   0 on land, 1 in swimming water — eased, so wading in and out of
 *            deep water blends instead of snapping;
 *   stroke   0 treading water in place, 1 swimming a front crawl;
 *   pitch    how far the body leans from upright toward the direction of
 *            travel: flat along the surface when swimming, head-down when
 *            diving, upright again when treading or surfacing;
 *   phases   the crawl's stroke cycle and the tread's sculling cycle;
 *   lift     how far to raise the body so its chest rides just under the
 *            surface. The player floats at one depth whatever the character, so
 *            a dwarf would otherwise swim with its head under water.
 *
 * At the surface the pitch stops short of horizontal so the head stays out of
 * the water. Pure arithmetic: no three.js, no allocation per update.
 */

/** Radians. Surface swimmers keep the head up; divers may point straight down. */
const SURFACE_MAX_PITCH = 1.3;
const SUBMERGED_MAX_PITCH = 2.6;
/** Travel speed, m/s, over which treading gives way to stroking. */
const STROKE_START_SPEED = 0.4;
const STROKE_FULL_SPEED = 2;
/** Crawl stroke cycles per second: a floor for slow swimming, a cap for fast. */
const STROKE_BASE_CADENCE = 0.45;
const STROKE_CADENCE_PER_SPEED = 0.12;
const STROKE_MAX_CADENCE = 1.2;
/** Per-second rates at which the eased quantities follow their targets. */
const WEIGHT_RATE = 5;
const STROKE_RATE = 4;
const PITCH_RATE = 5;
const VERTICAL_RATE = 8;
/** Metres the swim pivot (the chest) rides under the surface. */
const PIVOT_DEPTH = 0.15;
/** The most the body is raised or lowered to meet the surface, metres. */
const MAX_LIFT = 1;
const LIFT_RATE = 5;
/** A jump of more than this in one frame is a teleport or a rebase, not motion. */
const TELEPORT_METRES = 4;

function clamp(value, minimum, maximum) {
  return value < minimum ? minimum : value > maximum ? maximum : value;
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function approach(current, target, rate, dt) {
  return target + (current - target) * Math.exp(-rate * dt);
}

export class SwimMotion {
  /**
   * @param {object} options
   * @param {number} options.treadCadence sculling cycles per second while treading water
   * @param {number} options.pivotHeight height of the swim pivot above the soles, metres
   */
  constructor({ treadCadence, pivotHeight }) {
    this.treadCadence = treadCadence;
    this.pivotHeight = pivotHeight;
    this.lift = 0;
    this.weight = 0;
    this.stroke = 0;
    this.pitch = 0;
    this.strokePhase = 0;
    this.treadPhase = 0;
    this.verticalSpeed = 0;
    this._previousFootY = null;
  }

  reset() {
    this.weight = 0;
    this.stroke = 0;
    this.pitch = 0;
    this.lift = 0;
    this.verticalSpeed = 0;
    this._previousFootY = null;
  }

  /**
   * @param {number} dt seconds, already clamped by the caller
   * @param {boolean} swimming
   * @param {boolean} submerged the whole body is under water
   * @param {number} horizontalSpeed m/s
   * @param {number} footY world height of the player's feet
   * @param {number} [surfaceHeight] world height of the water surface, if known
   */
  update(dt, swimming, submerged, horizontalSpeed, footY, surfaceHeight = Number.NaN) {
    if (dt > 0 && this._previousFootY !== null
        && Math.abs(footY - this._previousFootY) < TELEPORT_METRES) {
      this.verticalSpeed = approach(
        this.verticalSpeed,
        (footY - this._previousFootY) / dt,
        VERTICAL_RATE,
        dt,
      );
    } else {
      this.verticalSpeed = 0;
    }
    this._previousFootY = footY;

    const travel = Math.hypot(horizontalSpeed, this.verticalSpeed);
    const strokeTarget = swimming ? smoothstep(STROKE_START_SPEED, STROKE_FULL_SPEED, travel) : 0;
    this.weight = approach(this.weight, swimming ? 1 : 0, WEIGHT_RATE, dt);
    this.stroke = approach(this.stroke, strokeTarget, STROKE_RATE, dt);

    // The angle of travel measured from straight up: 0 rising, π/2 level,
    // π diving straight down. Scaled by the stroke, so a figure treading water
    // — whose speed is all noise — stays upright.
    const travelAngle = Math.atan2(horizontalSpeed, this.verticalSpeed);
    const maxPitch = submerged ? SUBMERGED_MAX_PITCH : SURFACE_MAX_PITCH;
    const pitchTarget = swimming ? clamp(travelAngle, 0, maxPitch) * strokeTarget : 0;
    this.pitch = approach(this.pitch, pitchTarget, PITCH_RATE, dt);

    const floating = swimming && !submerged && Number.isFinite(surfaceHeight);
    const liftTarget = floating
      ? clamp(surfaceHeight - PIVOT_DEPTH - (footY + this.pivotHeight), -MAX_LIFT, MAX_LIFT)
      : 0;
    this.lift = approach(this.lift, liftTarget, LIFT_RATE, dt);

    const strokeCadence = Math.min(
      STROKE_MAX_CADENCE,
      STROKE_BASE_CADENCE + STROKE_CADENCE_PER_SPEED * travel,
    );
    this.strokePhase = (this.strokePhase + strokeCadence * dt) % 1;
    this.treadPhase = (this.treadPhase + this.treadCadence * dt) % 1;
    return this;
  }
}
