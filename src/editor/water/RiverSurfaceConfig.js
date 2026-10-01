function assertFiniteRange(value, fieldName, minimum, maximum) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${fieldName} must be within [${minimum}, ${maximum}].`);
  }
}

/**
 * `stylizedSurface.water.riverSurface`: grass-test's lake and river surface
 * (RiverSurfaceShading) — flow-mapped detail normals, Fresnel, sun glint and
 * shore, bank and turbulence foam. Visual only.
 */
export function validateRiverSurfaceConfig(config) {
  // Absent means off: water configs from before the river surface still load.
  if (config === undefined || config === null) return null;
  if (typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('stylizedSurface.water.riverSurface must be an object.');
  }
  if (typeof config.enabled !== 'boolean') {
    throw new Error('stylizedSurface.water.riverSurface.enabled must be a boolean.');
  }
  const field = (name) => `stylizedSurface.water.riverSurface.${name}`;
  assertFiniteRange(config.normalStrength, field('normalStrength'), 0, 4);
  assertFiniteRange(config.cycleSeconds, field('cycleSeconds'), 0.25, 30);
  assertFiniteRange(config.stillDrift, field('stillDrift'), 0, 2);
  assertFiniteRange(config.currentDrift, field('currentDrift'), 0, 8);
  assertFiniteRange(config.fullCurrentSpeed, field('fullCurrentSpeed'), 0, 10);
  assertFiniteRange(config.bankFoamWidth, field('bankFoamWidth'), 0.11, 20);
  if (config.foamStrength !== undefined) {
    assertFiniteRange(config.foamStrength, field('foamStrength'), 0, 4);
  }
  return config;
}
