import assert from 'node:assert/strict';
import test from 'node:test';

import { RAISED_DEVICE_LIMITS, raiseDeviceLimits } from '../src/render/deviceLimits.js';

const gpuOffering = (limits) => ({
  requestAdapter: async (options) => {
    assert.equal(options.featureLevel, 'compatibility', 'the backend\'s own adapter options');
    return { limits };
  },
});

test('the device asks for what the adapter offers, up to the cap', async () => {
  const cap = RAISED_DEVICE_LIMITS.maxSampledTexturesPerShaderStage;
  assert.deepEqual(
    await raiseDeviceLimits({}, { gpu: gpuOffering({ maxSampledTexturesPerShaderStage: 48 }) }),
    { maxSampledTexturesPerShaderStage: cap },
  );
  assert.deepEqual(
    await raiseDeviceLimits({}, { gpu: gpuOffering({ maxSampledTexturesPerShaderStage: 16 }) }),
    { maxSampledTexturesPerShaderStage: 16 },
    'never more than the adapter has',
  );
});

test('without WebGPU or an adapter the limits are left alone', async () => {
  const limits = { existing: 1 };
  assert.deepEqual(await raiseDeviceLimits(limits, { gpu: null }), { existing: 1 });
  assert.deepEqual(await raiseDeviceLimits(limits, { gpu: { requestAdapter: async () => null } }), { existing: 1 });
});
