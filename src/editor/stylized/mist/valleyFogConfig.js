/**
 * Configuration for the valley mist (see ValleyFogShading.js), after
 * grass-test's resolveValleyFogConfig.
 *
 * The donor keys its mist off the snow layer (`ground.snow.atmosphere.valleyFog`)
 * because its gorges are snow-country gorges. This world's gorges are wherever
 * the Azgaar relief happens to be, so the region gate is a weight the caller
 * supplies rather than a fixed snow flag; the rest of the numbers are the
 * donor's shape adapted to a camera-local height patch.
 *
 * `steps` is a per-pixel raymarch count and is deliberately small: the mist is
 * soft and low-frequency, and every extra step is a texture fetch and a noise
 * evaluation on every shaded ground pixel. `maxDistance` must stay inside the
 * LocalGroundHeight patch (extent / 2, 64 m by default) because the march reads
 * its terrain from that patch.
 */
const PREFIX = 'stylizedSurface.sky.valleyFog';

export const DEFAULT_VALLEY_FOG = Object.freeze({
  enabled: true,
  // Fixed march steps. Quality scales the region weight, never this count, so
  // the shader's loop bound stays a compile-time constant.
  steps: 6,
  // Metres. The mist fades out by here; keep this within half the height patch.
  maxDistance: 56,
  // Metres along the ray: the first span stays clear so a wall beside the camera
  // is not washed out, and the mist reaches full density by the second.
  nearClear: Object.freeze([3, 10]),
  // Fraction of maxDistance at which the distance fade begins, hiding the patch edge.
  farFade: 0.72,
  // Metres above the terrain at which the mist's density has fallen by 1/e.
  height: 8,
  // Metres above the terrain beyond which no mist forms at all.
  ceiling: 20,
  // Optical depth per metre at full density, before the region weight.
  density: 0.05,
  // 1/m: the scale of the drifting pocket noise that breaks the sheet into banks.
  pocketScale: 0.05,
  // 0..1: how much the pockets vary the sheet from empty gaps to thick banks.
  pocketStrength: 0.5,
  // m/s: how fast the pockets slide downwind.
  drift: 1.2,
  // Degrees: the bearing the pockets drift along.
  windAngleDegrees: 35,
  // Henyey-Greenstein asymmetry of the forward-scatter lobe toward the sun.
  scatter: 0.6,
  // How much sun colour the forward lobe adds.
  sunScatter: 0.6,
  // The cool shade the mist falls to away from the sun.
  shadeColor: '#8fa7b8',
});

function finite(value, name, { min = -Infinity, max = Infinity, exclusiveMin = false } = {}) {
  const number = Number(value);
  const belowMin = exclusiveMin ? !(number > min) : number < min;
  if (!Number.isFinite(number) || belowMin || number > max) {
    throw new Error(`Invalid editor configuration: ${PREFIX}.${name} must be a finite number in range.`);
  }
  return number;
}

function within(value, name, { min = -Infinity, max = Infinity } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`Invalid editor configuration: ${PREFIX}.${name} must be within [${min}, ${max}].`);
  }
  return number;
}

/**
 * @param {object} [configured] `stylizedSurface.sky.valleyFog`
 * @returns {object | null} resolved settings, or `null` when switched off
 */
export function resolveValleyFogConfig(configured) {
  if (configured?.enabled === false) return null;
  const settings = { ...DEFAULT_VALLEY_FOG, ...(configured ?? {}) };

  const nearClear = settings.nearClear;
  if (!Array.isArray(nearClear) || nearClear.length !== 2) {
    throw new Error(`Invalid editor configuration: ${PREFIX}.nearClear must be a [start, end] pair.`);
  }
  const nearStart = finite(nearClear[0], 'nearClear[0]', { min: 0 });
  const nearEnd = finite(nearClear[1], 'nearClear[1]', { min: 0 });
  if (!(nearEnd > nearStart)) {
    throw new Error(`Invalid editor configuration: ${PREFIX}.nearClear must rise from its first value to its second.`);
  }
  const maxDistance = finite(settings.maxDistance, 'maxDistance', { min: 0, exclusiveMin: true });
  // A clear span that reaches past the march would make the near window and the
  // distance fade fight, so the clear span has to fit inside the march.
  if (nearEnd > maxDistance) {
    throw new Error(`Invalid editor configuration: ${PREFIX}.nearClear must end within ${PREFIX}.maxDistance.`);
  }

  const shadeColor = settings.shadeColor;
  if (typeof shadeColor !== 'string' || shadeColor.length === 0) {
    throw new Error(`Invalid editor configuration: ${PREFIX}.shadeColor must be a color string.`);
  }

  return {
    enabled: true,
    steps: Math.round(finite(settings.steps, 'steps', { min: 1, max: 12 })),
    maxDistance,
    nearClear: [nearStart, nearEnd],
    farFade: within(settings.farFade, 'farFade', { min: 0, max: 1 }),
    height: finite(settings.height, 'height', { min: 0, exclusiveMin: true }),
    ceiling: finite(settings.ceiling, 'ceiling', { min: 0, exclusiveMin: true }),
    density: finite(settings.density, 'density', { min: 0 }),
    pocketScale: finite(settings.pocketScale, 'pocketScale', { min: 0, exclusiveMin: true }),
    pocketStrength: within(settings.pocketStrength, 'pocketStrength', { min: 0, max: 1 }),
    drift: finite(settings.drift, 'drift', { min: 0 }),
    windAngleDegrees: finite(settings.windAngleDegrees, 'windAngleDegrees'),
    scatter: within(settings.scatter, 'scatter', { min: 0, max: 0.95 }),
    sunScatter: finite(settings.sunScatter, 'sunScatter', { min: 0 }),
    shadeColor,
  };
}
