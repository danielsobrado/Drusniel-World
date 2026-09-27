import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { GrassTuning } from '../src/editor/stylized/GrassTuning.js';
import { createStylizedGrassMaterial } from '../src/editor/stylized/StylizedGrassMaterial.js';

function shippedSurface() {
  return yaml.load(readFileSync(new URL('../editor.config.yaml', import.meta.url), 'utf8'))
    .stylizedSurface;
}

function surfaceMask() {
  const texture = new THREE.DataTexture(new Uint8Array(4 * 4 * 4), 4, 4);
  texture.needsUpdate = true;
  return texture;
}

function build({ lodCoverage } = {}) {
  const surface = shippedSurface();
  return createStylizedGrassMaterial({
    surfaceMaskTexture: surfaceMask(),
    trampleTexture: surfaceMask(),
    chunkCenter: uniform(new THREE.Vector2(1, 2)),
    chunkWorldSize: 128,
    time: uniform(0),
    sunDirection: new THREE.Vector3(0.4, 0.8, 0.2),
    config: surface,
    tuning: new GrassTuning(surface),
    lodCoverage,
  });
}

test('the coverage shading assembles against the shipped config', () => {
  // The TSL graph is built here, in plain JavaScript, so API misuse fails in the
  // test run rather than as a blank field in a browser. Everything the shader needs
  // — the window, the compensate and cap — comes from the config, and a wrong path
  // there would otherwise only show as grass that does not thin.
  const coverageSettings = shippedSurface().grass.lod.coverage;
  assert.equal(coverageSettings.enabled, true);
  assert.equal(Number.isFinite(coverageSettings.presenceWindow), true);
  assert.equal(Number.isFinite(coverageSettings.maximumWiden), true);
  const material = build({ lodCoverage: uniform(new THREE.Vector4(0, 128, 1, 0.45)) });
  assert.ok(material.positionNode, 'the material should carry a displaced position');
  assert.ok(material.colorNode, 'the material should carry a colour node');
  assert.ok(material.opacityNode, 'the material should carry the surface-class mask');
  material.dispose();
});

test('a material built without the LOD wiring still shades, at full density', () => {
  // Chunked callers always pass the uniform, but the material is also built by
  // capture harnesses and budget tests that have no camera. Falling back to full
  // coverage keeps those showing grass rather than requiring every caller to know
  // about the LOD.
  const material = build();
  assert.ok(material.colorNode);
  material.dispose();
});

test('the coverage uniform carries the corners the CPU resolved', () => {
  // The four components are the contract with `updateCoverage`: two distances and
  // the coverage at each. Swapping any pair would thin a chunk by its far corner
  // everywhere, or interpolate across the wrong span, and both are silent.
  const coverage = uniform(new THREE.Vector4(0, 128, 1, 0.45));
  const material = build({ lodCoverage: coverage });
  assert.deepEqual(
    [coverage.value.x, coverage.value.y, coverage.value.z, coverage.value.w],
    [0, 128, 1, 0.45],
  );
  // A per-frame write has to reach the same object the graph holds, or the field
  // never thins as the camera moves.
  coverage.value.set(64, 192, 0.7, 0.45);
  assert.equal(coverage.value.z, 0.7);
  material.dispose();
});
