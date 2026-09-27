import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { executeConstructionCommand } from '../src/editor/construction/ConstructionCommands.js';
import { ConstructionStore } from '../src/editor/construction/ConstructionStore.js';
import { normalizeConstructionRecord } from '../src/editor/construction/ConstructionSchema.js';
import { createCubicBezierPathFromStroke } from '../src/editor/construction/curve/CubicBezierPath.js';
import { planConstruction } from '../src/editor/construction/planning/ConstructionPlanner.js';
import { disposeConstructionMaterials } from '../src/editor/construction/render/ConstructionMaterials.js';
import { ConstructionView } from '../src/editor/construction/render/ConstructionView.js';
import { BUILTIN_WORKSHOP_MATERIAL_PRESETS } from '../src/editor/workshop/ProceduralWorkshopMaterialConfig.js';

function wallRecord() {
  return normalizeConstructionRecord({
    version: 1,
    id: 'construction-1',
    revision: 1,
    seed: 4,
    kind: 'wall',
    style: { key: 'coursed-rubble', version: 1, materials: {} },
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
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      },
    },
  };
}

/**
 * A compiler whose responses are resolved by the test, so an appearance change
 * can be applied while a structural compile is still in flight.
 */
function createDeferredCompiler() {
  const requests = [];
  return {
    requests,
    compile(record) {
      const request = { record, plan: planConstruction(record) };
      request.promise = new Promise((resolve, reject) => {
        request.resolve = () => resolve(request.plan);
        request.reject = reject;
      });
      requests.push(request);
      return request.promise;
    },
  };
}

function flushAsync() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** Frame-loop equivalent: `document.hidden` keeps rAF from firing in the pane. */
function drainBuildQueue(view, plan) {
  for (let frame = 0; frame < plan.modules.length + 2; frame += 1) view.update();
}

function stoneMaterialOf(entry) {
  for (const resident of entry.modules.values()) {
    for (const mesh of resident.meshes) {
      if (mesh.userData.constructionMaterialSlot !== 'mortar') return mesh.material;
    }
  }
  return null;
}

test.afterEach(() => {
  disposeConstructionMaterials();
});

test('a material-only change does not strand the in-flight structural compile', async () => {
  const store = new ConstructionStore();
  const compiler = createDeferredCompiler();
  const view = new ConstructionView({
    terrainView: createTerrainView(),
    store,
    compilerClient: compiler,
  });
  const record = wallRecord();
  store.add(record);
  assert.equal(compiler.requests.length, 1, 'the add must request a structural compile');

  // The reviewer's reproduction: paint while the structural compile is pending.
  const painted = executeConstructionCommand(store, {
    type: 'set_material',
    constructionId: record.id,
    materials: { stone: 'sandstone-masonry' },
  });
  assert.equal(painted.materialOnly, true);
  assert.equal(store.get(record.id).revision, 2);
  assert.equal(compiler.requests.length, 1, 'painting must not request a second compile');

  compiler.requests[0].resolve();
  await flushAsync();

  const entry = view.entries.get(record.id);
  assert.ok(entry.plan, 'the pending structural plan must still be accepted');
  assert.equal(entry.plan.modules.length, compiler.requests[0].plan.modules.length);
  assert.ok(entry.plan.modules.length >= 2, 'the fixture needs several modules');

  drainBuildQueue(view, entry.plan);
  assert.equal(view.stats.modulesResident, entry.plan.modules.length, 'every module must be resident');
  assert.equal(view.stats.queueDepth, 0, 'the build queue must be empty at rest');
  assert.equal(view.stats.staleBuildsDiscarded, 0);
  for (const resident of entry.modules.values()) {
    assert.ok(resident.meshes.length > 0, 'every resident module must show masonry');
  }
  view.dispose();
});

test('an appearance-only change does not rebuild layout or cancel a queued build', async () => {
  const store = new ConstructionStore();
  const compiler = createDeferredCompiler();
  const view = new ConstructionView({
    terrainView: createTerrainView(),
    store,
    compilerClient: compiler,
  });
  const record = wallRecord();
  store.add(record);
  compiler.requests[0].resolve();
  await flushAsync();

  const entry = view.entries.get(record.id);
  const plan = entry.plan;
  assert.ok(plan.modules.length >= 2, 'the fixture needs several modules');

  // Leave the rest of the modules queued, as an ordinary frame loop would.
  view.update();
  assert.ok(view.stats.queueDepth > 0, 'the fixture must leave work queued');

  const planBefore = entry.plan;
  const rebuiltBefore = view.stats.modulesRebuilt;
  const discardedBefore = view.stats.staleBuildsDiscarded;
  const builtGeometryBefore = new Map([...entry.modules].map(
    ([moduleId, resident]) => [moduleId, resident.meshes.map((mesh) => mesh.geometry)],
  ));
  assert.ok([...builtGeometryBefore.values()].some((meshes) => meshes.length > 0));

  executeConstructionCommand(store, {
    type: 'set_material',
    constructionId: record.id,
    materials: { stone: 'sandstone-masonry' },
  });

  assert.equal(compiler.requests.length, 1, 'painting must not replan the wall');
  assert.equal(entry.plan, planBefore, 'the plan must be reused, not rescheduled');

  drainBuildQueue(view, plan);

  assert.equal(view.stats.queueDepth, 0);
  assert.equal(entry.modules.size, plan.modules.length);
  assert.equal(
    view.stats.modulesRebuilt - rebuiltBefore,
    plan.modules.length - 1,
    'only the modules still queued may be built; no module may be built twice',
  );
  assert.equal(
    view.stats.staleBuildsDiscarded,
    discardedBefore,
    'a tint must not cancel a queued build',
  );
  for (const [moduleId, geometries] of builtGeometryBefore) {
    if (geometries.length === 0) continue;
    const after = entry.modules.get(moduleId).meshes.map((mesh) => mesh.geometry);
    assert.equal(after.length, geometries.length, `module ${moduleId} mesh count must not change`);
    for (let index = 0; index < geometries.length; index += 1) {
      assert.equal(after[index], geometries[index], `module ${moduleId} geometry must be reused`);
    }
  }
  view.dispose();
});

test('an appearance-only change updates the resident stone material', async () => {
  const store = new ConstructionStore();
  const compiler = createDeferredCompiler();
  const view = new ConstructionView({
    terrainView: createTerrainView(),
    store,
    compilerClient: compiler,
  });
  const record = wallRecord();
  store.add(record);
  compiler.requests[0].resolve();
  await flushAsync();

  const entry = view.entries.get(record.id);
  drainBuildQueue(view, entry.plan);
  const before = stoneMaterialOf(entry);
  assert.ok(before);
  assert.ok(before.color.equals(new THREE.Color('#ffffff')));

  executeConstructionCommand(store, {
    type: 'set_material',
    constructionId: record.id,
    materials: { stone: 'sandstone-masonry' },
  });

  const preset = BUILTIN_WORKSHOP_MATERIAL_PRESETS['sandstone-masonry'];
  const expected = new THREE.Color(preset.baseColor).multiply(new THREE.Color(preset.tint));
  const after = stoneMaterialOf(entry);
  assert.notEqual(after, before);
  assert.ok(after.color.equals(expected), 'the painted tint must reach the resident mesh');
  assert.equal(after.roughness, preset.roughness);
  view.dispose();
});

test('an older plan is not applied after a newer structural edit', async () => {
  const store = new ConstructionStore();
  const compiler = createDeferredCompiler();
  const view = new ConstructionView({
    terrainView: createTerrainView(),
    store,
    compilerClient: compiler,
  });
  const record = wallRecord();
  store.add(record);

  executeConstructionCommand(store, {
    type: 'set_dimensions',
    constructionId: record.id,
    dimensions: { height: 4.5 },
  });
  assert.equal(compiler.requests.length, 2, 'a structural edit must request a new compile');
  assert.equal(compiler.requests[1].plan.constructionRevision, 2);

  // The newer structural result lands first, then the superseded one arrives.
  compiler.requests[1].resolve();
  await flushAsync();
  const entry = view.entries.get(record.id);
  const accepted = entry.plan;
  assert.ok(accepted);
  assert.equal(accepted.constructionRevision, 2);

  compiler.requests[0].resolve();
  await flushAsync();
  assert.equal(entry.plan, accepted, 'the stale plan must not replace the accepted one');
  assert.equal(entry.plan.constructionRevision, 2);
  view.dispose();
});
