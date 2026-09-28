/**
 * Pure clock and astronomy for the sky: a time of day in hours plus a
 * latitude-ish tilt gives the sun's zenith and azimuth, the moon's position and
 * phase, and the weights that say which existing time-of-day preset the hour is
 * nearest. No Three.js, no DOM, no clocks of its own: every function is a pure
 * function of its arguments, so a cycle is replayable, testable and cheap to
 * feed from the frame loop.
 *
 * This module is *not* a second lighting authority. It only decides *when* and
 * *which look*; `SkyLookController.setPreset` still owns the change and
 * `StylizedSkyView.applyLook` still writes the lights. Keeping the maths pure is
 * what makes "a paused cycle is a no-op" true: a paused clock reports the same
 * preset every frame, `setPreset` ignores a repeat, and the sky is never
 * touched.
 *
 * The dome's own convention is `directionFromAngles(elevation, azimuth)`
 * (StylizedGodRaysPostProcess): x = cos(elevation) cos(azimuth),
 * y = sin(elevation), z = cos(elevation) sin(azimuth). The presets read it the
 * same way, so morning sits near azimuth 110 and golden hour near 262 and
 * azimuth rises through the day. This module keeps that: east is azimuth 90
 * (sunrise), south is 180 (noon), west is 270 (sunset).
 */

export const HOURS_PER_DAY = 24;
/** Mean synodic month, in days: new moon to the next new moon. */
export const SYNODIC_MONTH_DAYS = 29.530588853;
/** East on the dome's azimuth ring: the sun rises here. */
export const EAST_AZIMUTH_DEGREES = 90;
/** West on the dome's azimuth ring: the sun sets here. */
export const WEST_AZIMUTH_DEGREES = 270;
/**
 * The moon's orbit is inclined to the ecliptic. That inclination, not a random
 * offset, is what keeps the moon off the sun's path so it is never drawn as a
 * second sun even at conjunction.
 */
export const MOON_ORBIT_INCLINATION_DEGREES = 5.145;
/** Real seconds a full 24 h turn takes by default: ten minutes. */
export const DEFAULT_DAY_LENGTH_SECONDS = 600;

export function wrap360(degrees) {
  return ((degrees % 360) + 360) % 360;
}

/** Fold any hour — negative, past a day — back into [0, 24). */
export function wrapHours(hours) {
  return ((hours % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY;
}

/** Fold any number into [0, 1); 0 and 1 are the same phase. */
export function wrap01(value) {
  const wrapped = value % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
}

/**
 * Noon elevation is the whole of "latitude-ish tilt": a world tilted toward the
 * sun has a high noon and a world near the pole has a low one. 90 - |latitude|
 * is the equinox value, which is all a single tilt can say without inventing a
 * season the task did not ask for. The floor keeps a polar day from flattening
 * the sun onto the horizon for the entire cycle.
 */
export function noonElevationDegrees(latitudeDegrees = 40) {
  return Math.max(5, Math.min(90, 90 - Math.abs(Number(latitudeDegrees) || 0)));
}

/**
 * The sun's `{ elevation, azimuth }` in degrees at `hour`.
 *
 * Azimuth is 15 deg/hour, so it is monotone through the day and its slope is
 * independent of the tilt: sunrise is due east at 06:00, noon due south, sunset
 * due west at 18:00, and the markers do not slide with latitude. Elevation is a
 * half-sine that peaks at noon and troughs at midnight, so noon is the peak and
 * midnight is the deepest negative — the shape a horizon test needs.
 */
export function sunPosition(hour, { latitudeDegrees = 40 } = {}) {
  const h = wrapHours(hour);
  const noon = noonElevationDegrees(latitudeDegrees);
  const dayAngle = (Math.PI * (h - 6)) / 12; // -pi/2 at midnight, +pi/2 at noon
  return {
    elevation: noon * Math.sin(dayAngle),
    azimuth: wrap360(15 * h),
  };
}

/** New moon = 0, full moon = 0.5, from a running day count. */
export function moonPhase(dayCount) {
  return wrap01(Number(dayCount) / SYNODIC_MONTH_DAYS);
}

/** Share of the moon's disc lit: 0 at new moon, 1 at full. */
export function moonIllumination(phase) {
  return (1 - Math.cos(2 * Math.PI * wrap01(phase))) / 2;
}

/** Sun–moon elongation in degrees: 0 at new moon, 90 at quarter, 180 at full. */
export function moonElongationDegrees(phase) {
  return wrap360(360 * wrap01(phase));
}

export const MOON_PHASE_NAMES = Object.freeze([
  'new',
  'waxing crescent',
  'first quarter',
  'waxing gibbous',
  'full',
  'waning gibbous',
  'last quarter',
  'waning crescent',
]);

/** Nearest of the eight conventional phase names. */
export function moonPhaseName(phase) {
  return MOON_PHASE_NAMES[Math.round(wrap01(phase) * 8) % 8];
}

/**
 * The moon's `{ elevation, azimuth }` in degrees.
 *
 * The moon lags the sun by the elongation angle, expressed here as an hour
 * offset: at new moon (phase 0) it rides with the sun, at full moon (phase 0.5)
 * it is exactly half a day behind it, and it rises and sets on the same path a
 * moon should rather than tracking the sun. The inclined orbit then lifts and
 * drops it off the sun's path through the month, which is what stops a new moon
 * from sitting exactly on the sun: the two are never co-located, and the moon's
 * culmination height genuinely differs from the sun's.
 */
export function moonPosition(
  hour,
  dayCount,
  { latitudeDegrees = 40, inclinationDegrees = MOON_ORBIT_INCLINATION_DEGREES } = {},
) {
  const phase = moonPhase(dayCount);
  const noon = noonElevationDegrees(latitudeDegrees);
  const moonHour = Number(hour) - HOURS_PER_DAY * phase;
  const dayAngle = (Math.PI * (wrapHours(moonHour) - 6)) / 12;
  const incline = inclinationDegrees * Math.cos(2 * Math.PI * phase);
  return {
    elevation: noon * Math.sin(dayAngle) + incline,
    azimuth: wrap360(15 * wrapHours(moonHour)),
  };
}

/** Unit vector for `{ elevation, azimuth }` in the sky's own convention. */
export function bodyDirection({ elevation, azimuth }) {
  const e = (Math.PI * elevation) / 180;
  const a = (Math.PI * azimuth) / 180;
  const ce = Math.cos(e);
  return { x: ce * Math.cos(a), y: Math.sin(e), z: ce * Math.sin(a) };
}

/** Angle between two bodies, in degrees — the co-location test. */
export function angularSeparationDegrees(a, b) {
  const da = bodyDirection(a);
  const db = bodyDirection(b);
  const dot = Math.max(-1, Math.min(1, da.x * db.x + da.y * db.y + da.z * db.z));
  return (Math.acos(dot) * 180) / Math.PI;
}

/**
 * The hour each existing time-of-day preset stands for. `configured` — the sky
 * exactly as `editor.config.yaml` tunes it — is deliberately absent: it answers
 * "as tuned", not "at this hour", so the cycle never selects it and it stays the
 * manual base look. Every entry here is a preset that already exists and was
 * authored to look right, so the cycle drives those rather than inventing looks.
 */
export const TIME_PRESET_ANCHORS = Object.freeze([
  Object.freeze({ preset: 'moonrise', hour: 0 }), // night
  Object.freeze({ preset: 'stillmeadow', hour: 7 }), // soft morning
  Object.freeze({ preset: 'highfield', hour: 12 }), // full day
  Object.freeze({ preset: 'galewind', hour: 14.5 }), // bright, windy afternoon
  Object.freeze({ preset: 'lowsway', hour: 16.5 }), // low sun
  Object.freeze({ preset: 'emberfall', hour: 19 }), // golden hour
]);

export const TIME_PRESET_NAMES = Object.freeze(TIME_PRESET_ANCHORS.map((a) => a.preset));

/** The pair of anchors an hour sits between, and how far across it is. */
function segmentFor(hour) {
  const h = wrapHours(hour);
  const anchors = TIME_PRESET_ANCHORS;
  for (let i = 0; i < anchors.length; i += 1) {
    const from = anchors[i];
    const to = anchors[(i + 1) % anchors.length];
    const span = to.hour > from.hour ? to.hour - from.hour : to.hour + HOURS_PER_DAY - from.hour;
    const local = h >= from.hour ? h - from.hour : h + HOURS_PER_DAY - from.hour;
    if (local <= span + 1e-9) {
      return { from: from.preset, to: to.preset, t: span > 0 ? Math.min(1, local / span) : 0 };
    }
  }
  // Unreachable with the anchors above (they cover the whole ring), but a
  // missing segment must not throw inside a frame loop.
  return { from: anchors[0].preset, to: anchors[0].preset, t: 0 };
}

/**
 * Weights over the time presets, summing to 1. The hour is blended linearly
 * between the two anchors it lies between, so the cycle cross-fades between
 * authored looks and the nearest anchor always carries the most weight. Every
 * anchored preset is a key, zero when not active, so callers get a stable shape.
 */
export function presetWeights(hour) {
  const { from, to, t } = segmentFor(hour);
  const weights = {};
  for (const name of TIME_PRESET_NAMES) weights[name] = 0;
  weights[from] += 1 - t;
  weights[to] += t;
  const total = TIME_PRESET_NAMES.reduce((sum, name) => sum + weights[name], 0);
  if (total > 0 && Math.abs(total - 1) > 1e-12) {
    for (const name of TIME_PRESET_NAMES) weights[name] /= total;
  }
  return weights;
}

/** The preset the hour is nearest — the single name the cycle pushes at the sky. */
export function nearestPreset(hour) {
  const weights = presetWeights(hour);
  let best = TIME_PRESET_NAMES[0];
  for (const name of TIME_PRESET_NAMES) if (weights[name] > weights[best]) best = name;
  return best;
}

/** Everything about a moment, for a caller that wants it in one call. */
export function evaluateSkyClock(hour, {
  dayCount = 0,
  latitudeDegrees = 40,
  inclinationDegrees = MOON_ORBIT_INCLINATION_DEGREES,
} = {}) {
  const sun = sunPosition(hour, { latitudeDegrees });
  const moon = moonPosition(hour, dayCount, { latitudeDegrees, inclinationDegrees });
  const phase = moonPhase(dayCount);
  return {
    hour: wrapHours(hour),
    dayCount,
    sun,
    moon,
    moonPhase: phase,
    moonPhaseName: moonPhaseName(phase),
    moonIllumination: moonIllumination(phase),
    elongationDegrees: moonElongationDegrees(phase),
    separationDegrees: angularSeparationDegrees(sun, moon),
    night: sun.elevation < 0,
    preset: nearestPreset(hour),
    weights: presetWeights(hour),
  };
}

/**
 * A stateful clock over the pure functions above. It owns exactly one changing
 * number, the time of day, and advances it by real seconds; everything else is
 * derived. `update` returns the nearest preset name, which is the value the
 * frame loop pushes at `SkyLookController.setPreset`.
 */
export class DayNightCycle {
  constructor({
    hour = 6,
    dayCount = 0,
    latitudeDegrees = 40,
    inclinationDegrees = MOON_ORBIT_INCLINATION_DEGREES,
    dayLengthSeconds = DEFAULT_DAY_LENGTH_SECONDS,
    paused = false,
  } = {}) {
    this.hour = wrapHours(Number.isFinite(hour) ? hour : 6);
    this.dayCount = Number.isFinite(dayCount) ? dayCount : 0;
    this.latitudeDegrees = latitudeDegrees;
    this.inclinationDegrees = inclinationDegrees;
    this.dayLengthSeconds = dayLengthSeconds > 0 ? dayLengthSeconds : DEFAULT_DAY_LENGTH_SECONDS;
    this.paused = Boolean(paused);
  }

  get sun() {
    return sunPosition(this.hour, { latitudeDegrees: this.latitudeDegrees });
  }

  get moon() {
    return moonPosition(this.hour, this.dayCount, {
      latitudeDegrees: this.latitudeDegrees,
      inclinationDegrees: this.inclinationDegrees,
    });
  }

  get moonPhase() {
    return moonPhase(this.dayCount);
  }

  get night() {
    return this.sun.elevation < 0;
  }

  get preset() {
    return nearestPreset(this.hour);
  }

  get weights() {
    return presetWeights(this.hour);
  }

  setHour(hour) {
    if (Number.isFinite(hour)) this.hour = wrapHours(hour);
    return this.hour;
  }

  setDayCount(dayCount) {
    if (Number.isFinite(dayCount)) this.dayCount = dayCount;
    return this.dayCount;
  }

  setPaused(paused) {
    this.paused = Boolean(paused);
    return this.paused;
  }

  /**
   * Advance by `dtSeconds` and report the nearest preset.
   *
   * While paused this is a deliberate no-op that still reports the current
   * preset: the caller pushes that name at the sky every frame, `setPreset`
   * ignores a repeat, so a paused cycle never restarts the sky's eased
   * transition and never writes the lights. That is the whole contract with the
   * sky's "written only while changing" rule.
   */
  update(dtSeconds) {
    if (!this.paused && Number.isFinite(dtSeconds) && dtSeconds > 0) {
      const days = dtSeconds / this.dayLengthSeconds;
      this.hour = wrapHours(this.hour + days * HOURS_PER_DAY);
      this.dayCount += days;
    }
    return this.preset;
  }

  evaluate() {
    return evaluateSkyClock(this.hour, {
      dayCount: this.dayCount,
      latitudeDegrees: this.latitudeDegrees,
      inclinationDegrees: this.inclinationDegrees,
    });
  }
}
