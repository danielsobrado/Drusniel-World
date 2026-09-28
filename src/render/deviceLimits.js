/**
 * WebGPU limits worth raising past the spec defaults when the adapter offers more.
 *
 * The terrain material samples its slot data, the material bake, the layer
 * array, the valley-fog height patch, the shadow map and the cloud shadow in one
 * fragment stage — seventeen textures, one past the default of sixteen. Past the
 * default the pipeline fails validation and the terrain does not draw at all, so
 * the device asks for what the adapter can give, up to a cap that keeps the
 * request modest on hardware that reports very large numbers.
 */
export const RAISED_DEVICE_LIMITS = Object.freeze({
  maxSampledTexturesPerShaderStage: 32,
});

/**
 * Fills `requiredLimits` — the object handed to `WebGPURenderer`, which reads it
 * when `init()` requests the device — with each raised limit the adapter supports,
 * never more than it offers. Without WebGPU, or without an adapter, it leaves the
 * object untouched and the renderer keeps its own fallback path.
 *
 * @param {Record<string, number>} requiredLimits mutated in place
 * @param {object} [options]
 * @param {string} [options.powerPreference]
 * @param {object} [options.gpu] `navigator.gpu`, injectable for tests
 */
export async function raiseDeviceLimits(requiredLimits, { powerPreference, gpu = globalThis.navigator?.gpu } = {}) {
  if (!gpu) return requiredLimits;
  // The same adapter options the backend uses, so the limits read are the ones
  // the device will be requested from.
  const adapter = await gpu.requestAdapter({ powerPreference, featureLevel: 'compatibility' });
  if (!adapter) return requiredLimits;
  for (const [name, wanted] of Object.entries(RAISED_DEVICE_LIMITS)) {
    const offered = adapter.limits?.[name];
    if (Number.isFinite(offered)) requiredLimits[name] = Math.min(wanted, offered);
  }
  return requiredLimits;
}
