import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';

import {
  CLOUD_WRAP_UNITS,
  applyCloudShadow,
  cloudShadowUniforms,
  updateCloudShadows,
  wrapCloudCoordinate,
} from '../src/editor/stylized/CloudShadow.js';

const SKY = {
  sunElevation: 10,
  sunAzimuth: 258,
  cloudSpeed: 0.035,
  cloudScale: 10.5,
  cloudWorldScale: 180,
  cloudDensity: 0.56,
  cloudSharpness: 0.16,
  cloudFloor: -0.03,
  cloudCeiling: 0.75,
  cloudShadows: { enabled: true, strength: 0.45 },
};

test('cloud coordinates wrap into a float32-safe range by whole periods', () => {
  const period = CLOUD_WRAP_UNITS * SKY.cloudWorldScale;
  for (const canonical of [0, 1234.5, -1234.5, 8_300_000.25, -16_600_000.75]) {
    const wrapped = wrapCloudCoordinate(canonical, SKY.cloudWorldScale);
    assert.ok(wrapped >= 0 && wrapped < period, `${canonical} → ${wrapped}`);
    const periods = (canonical - wrapped) / period;
    assert.ok(Math.abs(periods - Math.round(periods)) < 1e-9);
    // The shader works in cloud units: small enough that fract(x × 311.7) keeps detail.
    assert.ok((wrapped / SKY.cloudWorldScale) * 311.7 < 2 ** 18);
  }
});

test('a surface under the camera samples the cloud the dome samples', () => {
  const cameraRender = { x: 812.4, z: -377.9 };
  const cameraCanonical = { x: 8_300_812.4, z: -6_100_377.9 };
  updateCloudShadows({ timeSeconds: 12, cameraRender, cameraCanonical, worldScale: SKY.cloudWorldScale, strength: 0.45 });
  const origin = cloudShadowUniforms.origin.value;
  assert.ok(Math.abs(origin.x + cameraRender.x - wrapCloudCoordinate(cameraCanonical.x, SKY.cloudWorldScale)) < 1e-6);
  assert.ok(Math.abs(origin.y + cameraRender.z - wrapCloudCoordinate(cameraCanonical.z, SKY.cloudWorldScale)) < 1e-6);
  assert.equal(cloudShadowUniforms.strength.value, 0.45);
});

test('cloud shadows scale the sun shadow term once, and only when enabled', () => {
  const off = applyCloudShadow(new THREE.MeshStandardNodeMaterial(), { ...SKY, cloudShadows: { enabled: false, strength: 0.45 } });
  assert.equal(off.receivedShadowNode, null);

  const material = applyCloudShadow(new THREE.MeshStandardNodeMaterial(), SKY);
  const hook = material.receivedShadowNode;
  assert.equal(typeof hook, 'function');
  applyCloudShadow(material, SKY);
  assert.equal(material.receivedShadowNode, hook, 'applying twice does not chain the shadow');
  assert.equal(material.clone().receivedShadowNode, hook, 'LOD clones inherit it');
});
