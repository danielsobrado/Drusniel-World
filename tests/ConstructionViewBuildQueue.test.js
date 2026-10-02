import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { ConstructionStore } from '../src/editor/construction/ConstructionStore.js';
import { normalizeConstructionRecord } from '../src/editor/construction/ConstructionSchema.js';
import { createCubicBezierPathFromStroke } from '../src/editor/construction/curve/CubicBezierPath.js';
import { planConstruction } from '../src/editor/construction/planning/ConstructionPlanner.js';
import { disposeConstructionMaterials } from '../src/editor/construction/render/ConstructionMaterials.js';
import { ConstructionView } from '../src/editor/construction/render/ConstructionView.js';
import { CONSTRUCTION_MATERIAL_SLOT } from '../src/editor/construction/render/ConstructionMaterialSlots.js';

const VIEWPORT_HEIGHT = 600;

function wallRecord() {
  return normalizeConstructionRecord({
    version: 1,
    id: 'construction-1',
    revision: 1,
    seed: 4,
    kind: 'wall',
    style: { key: 'rounded-fieldstone', version: 1 },
    dimensions: { height: 3.5, thickness: 0.8 },
    top: { style: 'flat' },
    path: createCubicBezierPathFromStroke([[0, 0], [12, 0], [24, 0], [36, 0]], {
      simplifyTolerance: 0.01,
    }),
    features: [],
  });
}

function createTerrainView() {
  return {
    scene: new THREE.Scene(),
    floatingOrigin: {
      toRender: (x, z) => ({ x, z }),
      toCanonical: (x, z) => ({ x, z }),
    },
    getCanonicalHeight: () => 0,
    renderer: {
      domElement: {
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: VIEWPORT_HEIGHT }),
      },
    },
  };
}

/** A camera at medium range: the middle module is near, the outer ones coarse. */
function coarseCamera() {
  const camera = new THREE.PerspectiveCamera(60, 800 / VIEWPORT_HEIGHT, 0.1, 1000);
  camera.position.set(18, 2, 30);
  camera.lookAt(18, 1.5, 0);
  camera.updateMatrixWorld();
  return camera;
}

test.afterEach(() => {
  disposeConstructionMaterials();
});

test('modules the LOD sends to another band while queued still get built', () => {
  const store = new ConstructionStore();
  const view = new ConstructionView({ terrainView: createTerrainView(), store, compilerClient: null });
  const record = wallRecord();
  store.add(record);
  const plan = planConstruction(record);
  assert.ok(plan.modules.length >= 3, 'fixture needs several modules');
  view.applyPlan(record, plan);

  const camera = coarseCamera();
  // The frame loop's order: drain one build, then classify.
  for (let frame = 0; frame < plan.modules.length * 4; frame += 1) {
    view.update();
    view.updateLod(camera, VIEWPORT_HEIGHT);
  }

  const residents = [...view.entries.get(record.id).modules.values()];
  // The scenario: jobs queued as `near` that the LOD reclassified before
  // their turn came.
  assert.ok(residents.some((resident) => resident.requestedBand === 'coarse'));
  for (const resident of residents) {
    assert.equal(resident.builtBand, resident.requestedBand);
    assert.equal(resident.meshes.length, 2);
    assert.ok(resident.meshes.every((mesh) => mesh.visible));
  }
  assert.equal(view.stats.queueDepth, 0);
  view.dispose();
});

test('a wall first seen from afar gets its masonry when the camera comes close', () => {
  const store = new ConstructionStore();
  const view = new ConstructionView({ terrainView: createTerrainView(), store, compilerClient: null });
  const record = wallRecord();
  store.add(record);
  const plan = planConstruction(record);
  view.applyPlan(record, plan);

  const distant = new THREE.PerspectiveCamera(60, 800 / VIEWPORT_HEIGHT, 0.1, 5000);
  distant.position.set(18, 20, 900);
  distant.lookAt(18, 1.5, 0);
  distant.updateMatrixWorld();
  for (let frame = 0; frame < plan.modules.length * 3; frame += 1) {
    view.update();
    view.updateLod(distant, VIEWPORT_HEIGHT);
  }
  const residents = [...view.entries.get(record.id).modules.values()];
  // The frame loop builds before it classifies, so the first queued module is
  // built before the LOD has seen it (and its minimum residence then holds it
  // in the near band); every later one is skipped while it is far.
  const far = residents.filter((resident) => resident.requestedBand === 'shell');
  assert.ok(far.length >= 2);
  assert.ok(far.every((resident) => resident.meshes.length === 0));

  const near = coarseCamera();
  for (let frame = 0; frame < plan.modules.length * 4; frame += 1) {
    view.update();
    view.updateLod(near, VIEWPORT_HEIGHT);
  }
  for (const resident of residents) {
    assert.notEqual(resident.requestedBand, 'shell');
    assert.equal(resident.builtBand, resident.requestedBand);
    assert.equal(resident.meshes.length, 2);
    assert.equal(resident.shellMesh.visible, false);
  }
  view.dispose();
});

test('pure LOD changes retain ivy while terrain and authored changes rebuild it', () => {
  const store = new ConstructionStore();
  const terrainView = createTerrainView();
  terrainView.worldStore = { revision: 1 };
  const view = new ConstructionView({ terrainView, store, compilerClient: null });
  const record = normalizeConstructionRecord({ ...wallRecord(), seed: 3141,
    style: { key: 'glade-sandstone', version: 1 } });
  store.add(record);
  const plan = planConstruction(record);
  view.applyPlan(record, plan);
  const entry = view.entries.get(record.id);
  for (const module of plan.modules) view.buildModule(entry, module);
  const module = plan.modules.find(m => entry.modules.get(m.id).meshes.some(mesh =>
    mesh.userData.constructionMaterialSlot === CONSTRUCTION_MATERIAL_SLOT.GROWTH));
  assert.ok(module, 'fixture includes an occupied growth patch');
  const resident = entry.modules.get(module.id);
  const growth = () => resident.meshes.find(mesh => mesh.userData.constructionMaterialSlot === CONSTRUCTION_MATERIAL_SLOT.GROWTH);
  const original = growth();
  let disposals = 0;
  original.geometry.addEventListener('dispose', () => { disposals += 1; });
  resident.requestedBand = 'coarse';
  view.buildModule(entry, module);
  assert.equal(growth(), original);
  assert.equal(disposals, 0);
  assert.equal(original.castShadow, false);
  assert.equal(resident.stats.totalTriangles, resident.stats.stoneTriangles + resident.stats.mortarTriangles + resident.stats.growthTriangles);
  resident.requestedBand = 'near';
  view.buildModule(entry, module);
  assert.equal(growth(), original);
  assert.equal(original.castShadow, true);
  terrainView.worldStore.revision += 1;
  resident.requestedBand = 'coarse';
  view.buildModule(entry, module);
  assert.notEqual(growth(), original);
  assert.equal(disposals, 1);
  const afterTerrain = growth();
  entry.record = normalizeConstructionRecord({ ...record, seed: 456, revision: 2 });
  resident.requestedBand = 'near';
  view.buildModule(entry, module);
  assert.notEqual(growth(), afterTerrain);
  view.dispose();
});
