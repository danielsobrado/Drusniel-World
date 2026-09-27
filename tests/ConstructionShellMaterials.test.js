import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { constructionStoneRoundingProfile } from '../src/editor/construction/config/ConstructionStoneRoundingProfiles.generated.js';
import {
  ConstructionShellMaterials,
  constructionShellLinearRgb,
} from '../src/editor/construction/render/ConstructionShellMaterials.js';
import { STONE_PALETTES } from '../src/editor/workshop/ProceduralWorkshopMaterials.js';

test('soft styles keep the shared ribbon; rounded styles get their own stone', () => {
  for (const key of ['coursed-rubble', 'soft-limestone-rubble', 'ashlar', 'no-such-style', undefined]) {
    assert.equal(constructionShellLinearRgb(key), null, String(key));
  }
  const shade = constructionStoneRoundingProfile('rounded-fieldstone').shellShade;
  const expected = STONE_PALETTES['warm-fieldstone'].base.map((channel) => (channel / 255) * shade);
  assert.deepEqual(constructionShellLinearRgb('rounded-fieldstone'), expected);
});

test('shell materials are cached per style and only clones are disposed', () => {
  const ribbon = new THREE.MeshStandardNodeMaterial({ color: '#8d8879' });
  const shells = new ConstructionShellMaterials(ribbon);
  assert.equal(shells.forRecord({ style: { key: 'coursed-rubble' } }), ribbon);

  const rounded = shells.forStyle('rounded-fieldstone');
  assert.notEqual(rounded, ribbon);
  assert.equal(shells.forRecord({ style: { key: 'rounded-fieldstone' } }), rounded);
  const [r, g, b] = constructionShellLinearRgb('rounded-fieldstone');
  assert.ok(Math.abs(rounded.color.r - r) < 1e-6);
  assert.ok(Math.abs(rounded.color.g - g) < 1e-6);
  assert.ok(Math.abs(rounded.color.b - b) < 1e-6);

  let disposed = 0;
  rounded.addEventListener('dispose', () => { disposed += 1; });
  let ribbonDisposed = false;
  ribbon.addEventListener('dispose', () => { ribbonDisposed = true; });
  shells.dispose();
  assert.equal(disposed, 1);
  assert.equal(ribbonDisposed, false);
  ribbon.dispose();
});
