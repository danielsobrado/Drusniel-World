/**
 * Rain wetness settings (`stylizedSurface.wetness`): how fast ground soaks and
 * dries, and how a soaked surface looks. See surfaceWetness.js.
 */

export const DEFAULT_SURFACE_WETNESS = Object.freeze({
  /** Seconds of full rain to soak dry ground. */
  wetSeconds: 40,
  /** Seconds for soaked ground to dry once the rain stops. */
  drySeconds: 240,
  /** Share of colour lost at full wetness. */
  darkening: 0.3,
  /** Roughness a soaked surface falls to (never raised). */
  wetRoughness: 0.55,
  /** How much a full canopy keeps the ground under it dry. */
  canopyShelter: 0.7,
});

export function resolveSurfaceWetnessConfig(source = {}) {
  const config = { ...DEFAULT_SURFACE_WETNESS, ...source };
  for (const [key, value] of Object.entries(config)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Invalid editor configuration: stylizedSurface.wetness.${key} must be a non-negative number.`);
    }
  }
  if (config.wetSeconds <= 0 || config.drySeconds <= 0) {
    throw new Error('Invalid editor configuration: stylizedSurface.wetness wetSeconds and drySeconds must be positive.');
  }
  for (const key of ['darkening', 'wetRoughness', 'canopyShelter']) {
    if (config[key] > 1) throw new Error(`Invalid editor configuration: stylizedSurface.wetness.${key} must be within [0, 1].`);
  }
  return Object.freeze(config);
}
