import { uniform } from 'three/tsl';

import { DEFAULT_SURFACE_WETNESS } from './surfaceWetnessConfig.js';

/**
 * How wet exposed ground is, 0..1, shared by every material that darkens and
 * glistens in the rain. Rain wets quickly; the ground dries slowly after it
 * stops (after grass-test's EnvironmentState accumulators).
 */
export const surfaceWetnessUniform = uniform(0);

export class SurfaceWetness {
  constructor(config = DEFAULT_SURFACE_WETNESS, target = surfaceWetnessUniform) {
    this.config = config;
    this.target = target;
    this.value = 0;
  }

  /**
   * @param {number} dt seconds
   * @param {number} rain 0..1 rain intensity now
   */
  update(dt, rain) {
    if (!(dt > 0)) return this.value;
    const goal = Math.max(0, Math.min(1, rain));
    if (this.value < goal) {
      this.value = Math.min(goal, this.value + dt / this.config.wetSeconds);
    } else {
      this.value = Math.max(goal, this.value - dt / this.config.drySeconds);
    }
    this.target.value = this.value;
    return this.value;
  }
}
