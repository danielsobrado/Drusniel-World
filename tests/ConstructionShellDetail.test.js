import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import {
  applyShellDetail,
  loadShellDetailTexture,
} from '../src/editor/construction/render/ConstructionShellDetail.js';

test('the detail texture is not loaded where images cannot load', () => {
  assert.equal(typeof Image, 'undefined');
  assert.equal(loadShellDetailTexture(), null);
});

test('without a texture the shell keeps its flat colour', () => {
  const material = new THREE.MeshStandardNodeMaterial({ color: '#8d8879' });
  assert.equal(applyShellDetail(material, null), material);
  assert.equal(material.colorNode, null);
  material.dispose();
});

test('the stone pattern multiplies the colour and survives cloning', () => {
  const detail = new THREE.Texture();
  const material = applyShellDetail(new THREE.MeshStandardNodeMaterial({ color: '#8d8879' }), detail);
  assert.ok(material.colorNode, 'colour node installed');
  const clone = material.clone();
  clone.color.set('#ccbea4');
  assert.equal(clone.colorNode, material.colorNode, 'clones share the node');
  assert.notEqual(clone.color.getHex(), material.color.getHex(), 'and keep their own colour');
  material.dispose();
  clone.dispose();
  detail.dispose();
});
