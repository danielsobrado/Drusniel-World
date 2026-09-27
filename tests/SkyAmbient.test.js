import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { mixSkyLooks, resolveSkyLook } from '../src/editor/stylized/sky/SkyLook.js';
import { skyAmbientColor } from '../src/editor/stylized/sky/skyAmbient.js';

const luminance = (color) => color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
const saturation = (color) => Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b);

test('full ambient saturation is the zenith colour itself', () => {
  const zenith = new THREE.Color('#3f83c2');
  const light = skyAmbientColor({ highColor: '#3f83c2', ambientSaturation: 1 });
  assert.ok(light.equals(zenith));
  assert.ok(skyAmbientColor({ highColor: '#3f83c2' }).equals(zenith), 'missing means 1');
});

test('a paler sky light keeps the zenith luminance and only loses saturation', () => {
  const zenith = new THREE.Color('#3f83c2');
  const light = skyAmbientColor({ highColor: '#3f83c2', ambientSaturation: 0.45 });
  assert.ok(Math.abs(luminance(light) - luminance(zenith)) < 1e-6);
  assert.ok(Math.abs(saturation(light) - saturation(zenith) * 0.45) < 1e-6);
  assert.ok(light.b > light.r, 'the sky light stays cool');
  const grey = skyAmbientColor({ highColor: '#3f83c2', ambientSaturation: 0 });
  assert.ok(Math.abs(grey.r - grey.b) < 1e-9 && Math.abs(grey.g - grey.b) < 1e-9);
});

test('the sky light is written into a given colour in place', () => {
  const target = new THREE.Color();
  assert.equal(skyAmbientColor({ highColor: '#51437f', ambientSaturation: 0.5 }, target), target);
});

test('looks carry the configured ambient saturation and presets can override it', () => {
  const sky = {
    lowColor: '#9cc9e2', highColor: '#3f83c2', ambientSaturation: 0.45, ambientIntensity: 2,
  };
  assert.equal(resolveSkyLook(sky).ambientSaturation, 0.45);
  assert.equal(resolveSkyLook({ ...sky, ambientSaturation: undefined }).ambientSaturation, 1);
  const warm = { ...resolveSkyLook(sky), ambientSaturation: 0.8 };
  const halfway = mixSkyLooks(resolveSkyLook(sky), warm, 0.5);
  assert.ok(Math.abs(halfway.ambientSaturation - 0.625) < 1e-9);
});
