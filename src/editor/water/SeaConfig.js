function assertFiniteRange(value, fieldName, minimum, maximum) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${fieldName} must be within [${minimum}, ${maximum}].`);
  }
}

/**
 * `stylizedSurface.water.sea`: the open-sea swell (SeaSwell) and how it reads.
 * Visual only: the sea's geography is the water domain, so this can change
 * without re-importing a world.
 */
export function validateSeaConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('stylizedSurface.water.sea must be an object.');
  }
  if (typeof config.enabled !== 'boolean') {
    throw new Error('stylizedSurface.water.sea.enabled must be a boolean.');
  }
  const field = (name) => `stylizedSurface.water.sea.${name}`;
  assertFiniteRange(config.amplitude, field('amplitude'), 0, 4);
  assertFiniteRange(config.stormScale, field('stormScale'), 1, 4);
  assertFiniteRange(config.choppiness, field('choppiness'), 0, 6);
  assertFiniteRange(config.shallowDepth, field('shallowDepth'), 0.01, 20);
  assertFiniteRange(config.depthRatio, field('depthRatio'), 0.01, 1);
  assertFiniteRange(config.slopeShading, field('slopeShading'), 0, 2);
  assertFiniteRange(config.crestLift, field('crestLift'), 0, 1);
  assertFiniteRange(config.whitecapThreshold, field('whitecapThreshold'), 0, 1);
  assertFiniteRange(config.stormWhitecapThreshold, field('stormWhitecapThreshold'), 0, 1);
  return config;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** `stylizedSurface.water.rainRipples`: rain rings on every water surface. */
export function validateRainRipplesConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('stylizedSurface.water.rainRipples must be an object.');
  }
  if (typeof config.enabled !== 'boolean') {
    throw new Error('stylizedSurface.water.rainRipples.enabled must be a boolean.');
  }
  assertFiniteRange(config.strength, 'stylizedSurface.water.rainRipples.strength', 0, 2);
  return config;
}

/**
 * `stylizedSurface.water.coast`: the swash film, foam line and wet sand the
 * terrain draws where the ground meets the sea (CoastSwashShading).
 */
export function validateCoastConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('stylizedSurface.water.coast must be an object.');
  }
  if (typeof config.enabled !== 'boolean') {
    throw new Error('stylizedSurface.water.coast.enabled must be a boolean.');
  }
  const field = (name) => `stylizedSurface.water.coast.${name}`;
  assertFiniteRange(config.period, field('period'), 1, 60);
  assertFiniteRange(config.runupHeight, field('runupHeight'), 0.05, 5);
  assertFiniteRange(config.breakDepth, field('breakDepth'), 0, 3);
  assertFiniteRange(config.frontBand, field('frontBand'), 0.005, 1);
  assertFiniteRange(config.foamCore, field('foamCore'), 0, 1);
  assertFiniteRange(config.foamWidth, field('foamWidth'), 0.01, 2);
  if (config.foamCore >= config.foamWidth) {
    throw new Error('stylizedSurface.water.coast.foamWidth must exceed foamCore.');
  }
  assertFiniteRange(config.breakupStrength, field('breakupStrength'), 0, 1);
  assertFiniteRange(config.washDecay, field('washDecay'), 0, 20);
  assertFiniteRange(config.dampHeight, field('dampHeight'), 0.01, 5);
  assertFiniteRange(config.wetDarkening, field('wetDarkening'), 0, 1);
  assertFiniteRange(config.wetRoughness, field('wetRoughness'), 0, 1);
  assertFiniteRange(config.filmRoughness, field('filmRoughness'), 0, 1);
  assertFiniteRange(config.filmTintStrength, field('filmTintStrength'), 0, 1);
  assertFiniteRange(config.foamStrength, field('foamStrength'), 0, 1);
  for (const name of ['filmTint', 'foamColor']) {
    if (typeof config[name] !== 'string' || !HEX_COLOR.test(config[name])) {
      throw new Error(`${field(name)} must be a six-digit hex colour.`);
    }
  }
  return config;
}
