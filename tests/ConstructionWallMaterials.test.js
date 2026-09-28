import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RING_MATERIAL_LIMIT,
  wallMaterialOptionsMarkup,
  wallMaterialPresets,
} from '../src/editor/construction/ui/ConstructionWallMaterials.js';

/** Phase 11 finding 11: every wall material stays reachable. */

const customDocument = {
  materialLibrary: {
    presets: {
      'custom-moss': { id: 'custom-moss', label: 'Mossy granite', family: 'stone' },
      'custom-roof': { id: 'custom-roof', label: 'Red tile', family: 'roof' },
    },
  },
};

test('the full list keeps custom wall presets and drops other families', () => {
  const presets = wallMaterialPresets(customDocument);
  assert.ok(presets.some(({ id }) => id === 'custom-moss'), 'custom stone preset listed');
  assert.ok(!presets.some(({ id }) => id === 'custom-roof'), 'roof preset excluded');
  assert.ok(presets.length > 0 && wallMaterialPresets(null).length > 0, 'built-ins on a fresh world');
});

test('a custom preset past the ring limit is still offered in full', () => {
  const presets = wallMaterialPresets(customDocument);
  const index = presets.findIndex(({ id }) => id === 'custom-moss');
  if (index >= RING_MATERIAL_LIMIT) {
    assert.ok(!presets.slice(0, RING_MATERIAL_LIMIT).some(({ id }) => id === 'custom-moss'));
  }
  const markup = wallMaterialOptionsMarkup(presets, 'custom-moss');
  assert.match(markup, /<option value="custom-moss" selected>Mossy granite<\/option>/);
  assert.equal((markup.match(/<option /g) ?? []).length, presets.length);
});

test('a wall on its style default shows a placeholder rather than a wrong selection', () => {
  const presets = wallMaterialPresets(null);
  const markup = wallMaterialOptionsMarkup(presets, null);
  assert.match(markup, /^<option value="" selected>Style default<\/option>/);
  assert.equal((markup.match(/ selected/g) ?? []).length, 1);
});
