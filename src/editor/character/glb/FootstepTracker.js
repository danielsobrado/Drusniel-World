/**
 * Turns the stride phase into footfalls.
 *
 * Walk and run share one phase with the left foot landing at 0 in both (the
 * animator offsets each clip by its measured left landing). The right foot
 * lands where its own measured landing falls on that shared phase — about
 * halfway, but read from each clip rather than assumed. A footfall is the phase
 * crossing a landing while the figure is actually striding on the ground, so
 * the event and the visible plant are the same instant by construction.
 *
 * Pure arithmetic: no three.js, no allocation per update.
 */

export const FOOT_LEFT = 'left';
export const FOOT_RIGHT = 'right';

/** Walk + run weight below which the legs are not really striding. */
const STRIDING_WEIGHT = 0.5;

function wrap01(value) {
  return value - Math.floor(value);
}

/** Whether moving forward from `from` to `to` on the unit circle passes `mark`. */
function crossed(from, to, mark) {
  const travelled = wrap01(to - from);
  if (travelled <= 0 || travelled > 0.5) return false;
  const toMark = wrap01(mark - from);
  return toMark > 0 && toMark <= travelled;
}

export class FootstepTracker {
  /**
   * @param {{ walk: { left: number[], right: number[] }, run: { left: number[], right: number[] } }} landings
   *   measured landing times per clip, normalized
   * @param {{ walk: number, run: number }} offsets each clip's left landing, subtracted to share the phase
   */
  constructor(landings, offsets) {
    this.rightOnPhase = {
      walk: wrap01((landings.walk.right[0] ?? offsets.walk + 0.5) - offsets.walk),
      run: wrap01((landings.run.right[0] ?? offsets.run + 0.5) - offsets.run),
    };
    this.previousPhase = null;
  }

  reset() {
    this.previousPhase = null;
  }

  /**
   * @param {number} phase shared stride phase, 0..1
   * @param {{ walk: number, run: number }} weights the blend's current clip weights
   * @param {boolean} grounded on its feet and not swimming
   * @returns {typeof FOOT_LEFT | typeof FOOT_RIGHT | null} the foot that just landed
   */
  update(phase, weights, grounded) {
    const previous = this.previousPhase;
    this.previousPhase = phase;
    if (previous === null || !grounded || weights.walk + weights.run < STRIDING_WEIGHT) return null;
    if (crossed(previous, phase, 0)) return FOOT_LEFT;
    const right = weights.run > weights.walk ? this.rightOnPhase.run : this.rightOnPhase.walk;
    if (crossed(previous, phase, right)) return FOOT_RIGHT;
    return null;
  }
}
