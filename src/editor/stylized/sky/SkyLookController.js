import { DEFAULT_SKY_PRESET, SKY_PRESETS } from './SkyPresets.js';
import { mixSkyLooks, overcastSkyLook, resolveSkyLook } from './SkyLook.js';
import { snowCountryLook } from './snowCountryLook.js';

/** Seconds a change of time of day takes to settle. */
const PRESET_TRANSITION_SECONDS = 2.5;
/** Overcast units per second: rain clouds gather and clear over a few seconds. */
const OVERCAST_RATE = 0.25;
/** Snow-country units per second: the air changes over a few seconds' walk. */
const SNOW_COUNTRY_RATE = 0.15;

function approach(value, target, maximumStep) {
  const delta = target - value;
  return value + Math.sign(delta) * Math.min(Math.abs(delta), maximumStep);
}

/**
 * Chooses the sky's look: a time-of-day preset, eased into over a couple of
 * seconds, greyed by the weather's overcast and cooled in snow country. The
 * sky is written only while something is changing, so capture tools that set
 * the lights directly keep their settings.
 */
export class SkyLookController {
  /**
   * @param {object} options
   * @param {{ config: object, applyLook: Function }} options.skyView
   * @param {string} [options.preset]
   * @param {(look: object) => void} [options.onLook] after each applied look
   */
  constructor({ skyView, preset = DEFAULT_SKY_PRESET, onLook = null }) {
    this.skyView = skyView;
    this.onLook = onLook;
    this.preset = SKY_PRESETS[preset] ? preset : DEFAULT_SKY_PRESET;
    this.from = resolveSkyLook(skyView.config.sky, this.preset);
    this.to = this.from;
    this.progress = 1;
    this.overcast = 0;
    this.overcastTarget = 0;
    this.snowCountry = 0;
    this.snowCountryTarget = 0;
    this.dirty = this.preset !== DEFAULT_SKY_PRESET;
    this.current = this.from;
  }

  get night() {
    return this.current.night;
  }

  setPreset(name) {
    if (!SKY_PRESETS[name] || name === this.preset) return;
    this.preset = name;
    this.from = mixSkyLooks(this.from, this.to, this.progress);
    this.to = resolveSkyLook(this.skyView.config.sky, name);
    this.progress = 0;
  }

  /** @param {number} amount 0 clear … 1 full overcast */
  setOvercast(amount) {
    this.overcastTarget = Math.max(0, Math.min(1, amount));
  }

  /** @param {number} weight 0 lowland … 1 deep in snow country (SnowCountryWeight) */
  setSnowCountry(weight) {
    this.snowCountryTarget = Math.max(0, Math.min(1, weight));
  }

  /** @param {number} dt seconds */
  update(dt) {
    const step = Math.max(0, Math.min(dt, 0.25));
    let changed = this.dirty;
    this.dirty = false;
    if (this.progress < 1) {
      this.progress = Math.min(1, this.progress + step / PRESET_TRANSITION_SECONDS);
      changed = true;
    }
    if (this.overcast !== this.overcastTarget) {
      this.overcast = approach(this.overcast, this.overcastTarget, step * OVERCAST_RATE);
      changed = true;
    }
    if (this.snowCountry !== this.snowCountryTarget) {
      this.snowCountry = approach(this.snowCountry, this.snowCountryTarget, step * SNOW_COUNTRY_RATE);
      changed = true;
    }
    if (!changed) return false;
    const eased = this.progress * this.progress * (3 - 2 * this.progress);
    this.current = snowCountryLook(
      overcastSkyLook(mixSkyLooks(this.from, this.to, eased), this.overcast),
      this.snowCountry,
    );
    this.skyView.applyLook(this.current);
    this.onLook?.(this.current);
    return true;
  }
}
