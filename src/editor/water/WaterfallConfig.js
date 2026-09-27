function assertFiniteRange(value, fieldName, minimum, maximum) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${fieldName} must be within [${minimum}, ${maximum}].`);
  }
}

/**
 * `stylizedSurface.water.waterfall`: how river falls and their plunge pools
 * read. Where the falls are is geography (`waterDomain.falls`); this is only
 * their look, so it can change without re-importing a world.
 */
export function validateWaterfallConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('stylizedSurface.water.waterfall must be an object.');
  }
  if (typeof config.enabled !== 'boolean') {
    throw new Error('stylizedSurface.water.waterfall.enabled must be a boolean.');
  }
  const field = (name) => `stylizedSurface.water.waterfall.${name}`;
  assertFiniteRange(config.fallSpeed, field('fallSpeed'), 0, 40);
  assertFiniteRange(config.strandWidthMeters, field('strandWidthMeters'), 0.5, 100);
  assertFiniteRange(config.strandLengthMeters, field('strandLengthMeters'), 0.5, 100);
  assertFiniteRange(config.faceCoverage, field('faceCoverage'), 0, 1);
  assertFiniteRange(config.faceAeration, field('faceAeration'), 0, 1);
  assertFiniteRange(config.plungeCoverage, field('plungeCoverage'), 0, 1);
  assertFiniteRange(config.plungeSpeed, field('plungeSpeed'), 0, 10);
  assertFiniteRange(config.plungeScaleMeters, field('plungeScaleMeters'), 0.5, 100);
  if (typeof config.mistEnabled !== 'boolean') {
    throw new Error('stylizedSurface.water.waterfall.mistEnabled must be a boolean.');
  }
  assertFiniteRange(config.mistDrawDistance, field('mistDrawDistance'), 10, 5000);
  if (!Number.isInteger(config.mistMaxActive) || config.mistMaxActive < 1 || config.mistMaxActive > 32) {
    throw new Error('stylizedSurface.water.waterfall.mistMaxActive must be an integer within [1, 32].');
  }
  assertFiniteRange(config.mistIntensity, field('mistIntensity'), 0, 4);
  return config;
}
