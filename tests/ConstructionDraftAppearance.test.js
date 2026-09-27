import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { ConstructionStore } from '../src/editor/construction/ConstructionStore.js';
import { normalizeConstructionRecord } from '../src/editor/construction/ConstructionSchema.js';
import { createCubicBezierPathFromStroke } from '../src/editor/construction/curve/CubicBezierPath.js';
import { disposeConstructionMaterials } from '../src/editor/construction/render/ConstructionMaterials.js';
import { ConstructionView } from '../src/editor/construction/render/ConstructionView.js';

/**
 * What a draft looks like (phase 11 §4 step 2 and §8): a valid draft is the
 * wall's own opaque shell, so a new wall grows under the pointer as stone and a
 * reshaped arc matches the wall around it. Only an invalid draft gets a tool
 * colour.
 */

function wallRecord(id, key = 'rounded-fieldstone') {
  return normalizeConstructionRecord({
    version: 1,
    id,
    revision: 1,
    seed: 11,
    kind: 'wall',
    style: { key, version: 1 },
    dimensions: { height: 2.4, thickness: 0.65 },
    top: { style: 'flat' },
    path: createCubicBezierPathFromStroke([[0, 0], [4, 1], [8, 0], [12, 0]], { simplifyTolerance: 0.01 }),
    features: [],
  });
}

function createView() {
  const store = new ConstructionStore();
  const view = new ConstructionView({
    terrainView: {
      scene: new THREE.Scene(),
      floatingOrigin: { toRender: (x, z) => ({ x, z }), toCanonical: (x, z) => ({ x, z }) },
      getCanonicalHeight: () => 0,
      renderer: {
        domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) },
      },
    },
    store,
    compilerClient: null,
  });
  return { store, view };
}

test.afterEach(() => {
  disposeConstructionMaterials();
});

test('a valid new-wall draft is drawn with its style shell, opaque', () => {
  const { view } = createView();
  const record = wallRecord('draft-wall');
  view.setDraft(record, { valid: true });
  const material = view.previewMesh.material;
  assert.equal(material, view.shellMaterials.forRecord(record));
  assert.equal(material.transparent, false, 'a wall, not a ghost');
  assert.equal(view.previewMesh.visible, true);

  const soft = wallRecord('draft-soft', 'coursed-rubble');
  view.setDraft(soft, { valid: true });
  assert.equal(view.previewMesh.material, view.shellMaterials.forRecord(soft));
  view.dispose();
});

test('an invalid draft keeps the translucent warning colour', () => {
  const { view } = createView();
  view.setDraft(wallRecord('draft-wall'), { valid: false });
  assert.equal(view.previewMesh.material, view.invalidPreviewMaterial);
  assert.equal(view.previewMesh.material.transparent, true);
  view.dispose();
});

test('reshaping a selected wall previews with the selection shell it already shows', () => {
  const { store, view } = createView();
  const record = wallRecord('construction-1');
  store.add(record);
  view.setSelection(record.id);
  view.setDraft(record, { valid: true, constructionId: record.id });
  assert.equal(view.previewMesh.material, view.selectedMaterial);
  view.dispose();
});
