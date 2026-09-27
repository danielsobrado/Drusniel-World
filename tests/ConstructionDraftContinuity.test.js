import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { executeConstructionCommand } from '../src/editor/construction/ConstructionCommands.js';
import { ConstructionStore } from '../src/editor/construction/ConstructionStore.js';
import { normalizeConstructionRecord } from '../src/editor/construction/ConstructionSchema.js';
import {
  createCubicBezierPathFromStroke,
  moveCubicBezierAnchor,
} from '../src/editor/construction/curve/CubicBezierPath.js';
import { planConstruction } from '../src/editor/construction/planning/ConstructionPlanner.js';
import { disposeConstructionMaterials } from '../src/editor/construction/render/ConstructionMaterials.js';
import { ConstructionView } from '../src/editor/construction/render/ConstructionView.js';

/**
 * Continuity of a drag preview (phase 11 §8, finding 4, the W3 gate).
 *
 * The defect: `setDraft` hid the record's group and allocated a fresh mesh and
 * ribbon on every pointer move, so reshaping blinked the whole wall out and
 * back. These tests hold the replacement policy to what the plan promises — the
 * wall stays on screen, the preview product is allocated once, cancel is exact,
 * and a commit neither rerolls the masonry nor lets a stale result land.
 *
 * `document.hidden` is true in the in-app browser pane, so
 * `requestAnimationFrame` never fires: the frame loop is driven by calling
 * `update()` and `updateLod()` directly.
 */

const VIEWPORT_HEIGHT = 600;

/**
 * A bent 40 m wall: six anchors, five segments, five modules. The straight
 * stroke in the older fixtures collapses to a single segment, which makes every
 * anchor drag a whole-wall change and cannot exercise a local replaced arc.
 */
function wallRecord(id = 'construction-1') {
  return normalizeConstructionRecord({
    version: 1,
    id,
    revision: 1,
    seed: 4,
    kind: 'wall',
    style: { key: 'rounded-fieldstone', version: 1 },
    dimensions: { height: 3.5, thickness: 0.8 },
    top: { style: 'flat' },
    path: createCubicBezierPathFromStroke(
      [[0, 0], [8, 2], [16, 0], [24, 2], [32, 0], [40, 0]],
      { simplifyTolerance: 0.01 },
    ),
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

function nearCamera() {
  const camera = new THREE.PerspectiveCamera(60, 800 / VIEWPORT_HEIGHT, 0.1, 1000);
  camera.position.set(20, 6, 26);
  camera.lookAt(20, 1.5, 0);
  camera.updateMatrixWorld();
  return camera;
}

/** The frame loop's order: drain one build, then classify each module's band. */
function drainBuildQueue(view, plan, camera = nearCamera()) {
  for (let frame = 0; frame < plan.modules.length + 2; frame += 1) {
    view.update();
    view.updateLod(camera, VIEWPORT_HEIGHT);
  }
}

/** A wall with its masonry resident, which is the state a reshape starts from. */
function residentWall({ compilerClient = null, id = 'construction-1' } = {}) {
  const store = new ConstructionStore();
  const view = new ConstructionView({
    terrainView: createTerrainView(),
    store,
    compilerClient,
  });
  const record = store.add(wallRecord(id));
  const plan = planConstruction(record);
  view.applyPlan(record, plan);
  drainBuildQueue(view, plan);
  const entry = view.entries.get(id);

  assert.equal(view.stats.queueDepth, 0, 'the fixture must settle before the drag');
  assert.equal(plan.modules.length, 5, 'the fixture needs several modules');
  assert.equal(entry.modules.size, plan.modules.length);
  for (const resident of entry.modules.values()) {
    assert.equal(resident.meshes.length, 2, 'stone and mortar per module');
    assert.equal(resident.shellMesh.visible, false);
  }
  assert.equal(entry.shellMesh.visible, false);
  return { store, view, entry, record, plan, camera: nearCamera() };
}

/** The draft the editor hands the view on every pointer move. */
function draftFrom(record, anchorId, offset, revision = record.revision + 1) {
  return {
    ...record,
    revision,
    path: moveCubicBezierAnchor(record.path, anchorId, offset),
  };
}

function visibilitySnapshot(entry) {
  const snapshot = new Map();
  const record = (label, object) => {
    if (object) snapshot.set(label, object.visible);
  };
  record('shell', entry.shellMesh);
  for (const [moduleId, resident] of entry.modules) {
    record(`shell:${moduleId}`, resident.shellMesh);
    resident.meshes.forEach((mesh, index) => record(`mesh:${moduleId}:${index}`, mesh));
  }
  return snapshot;
}

function visibleMeshCount(entry) {
  let count = 0;
  for (const resident of entry.modules.values()) {
    for (const mesh of resident.meshes) if (mesh.visible) count += 1;
  }
  return count;
}

function moduleHashes(entry) {
  return [...entry.modules].map(([id, resident]) => `${id}:${resident.hash}`);
}

test.afterEach(() => {
  disposeConstructionMaterials();
});

test('a draft leaves the whole record on screen instead of hiding it', () => {
  const { view, entry, record } = residentWall();
  const modulesBefore = [...entry.modules].map(([id, resident]) => ({
    id,
    resident,
    meshes: [...resident.meshes],
  }));
  const anchorId = record.path.anchors[2].id;

  view.setDraft(draftFrom(record, anchorId, { x: 16, z: 1.5 }), {
    constructionId: record.id,
    valid: true,
    anchorId,
  });

  // The reproduction: this was `false`, which took the entire wall off screen.
  assert.equal(entry.group.visible, true);
  assert.equal(entry.group.parent, view.root);
  assert.equal(entry.modules.size, modulesBefore.length, 'every module stays resident');
  for (const { id, resident, meshes } of modulesBefore) {
    assert.equal(entry.modules.get(id), resident);
    for (const [index, mesh] of meshes.entries()) {
      assert.equal(resident.meshes[index], mesh, 'the committed meshes are reused, not rebuilt');
      assert.equal(mesh.parent, entry.group);
    }
  }

  // Only the replaced arc steps aside: the two modules the dragged anchor joins.
  assert.equal(view.previewDraft.span.whole, false);
  assert.equal(view.stats.previewOccludedProducts, 4, 'two modules of masonry');
  assert.equal(visibleMeshCount(entry), 6, 'the other three modules keep drawing');
  assert.equal(view.previewMesh.visible, true);
  assert.equal(view.previewMesh.parent, view.root);
  // The preview is the only extra product: no second mesh, no second geometry.
  assert.equal(view.root.children.filter((child) => child.name === 'construction-preview').length, 1);
  view.dispose();
});

test('repeated drafts over one arc reuse the preview product by identity', () => {
  const { view, entry, record } = residentWall();
  const anchorId = record.path.anchors[2].id;

  view.setDraft(draftFrom(record, anchorId, { x: 16, z: 1 }), { constructionId: record.id, anchorId });
  const mesh = view.previewMesh;
  const geometry = view.previewMesh.geometry;
  const attributes = ['position', 'normal', 'uv'].map((name) => geometry.getAttribute(name));
  const index = geometry.getIndex();
  const allocations = view.stats.previewBufferAllocations;
  assert.equal(allocations, 4, 'position, normal, uv and the index, once');
  const vertices = geometry.getAttribute('position').count;

  for (let step = 1; step <= 40; step += 1) {
    const next = draftFrom(record, anchorId, { x: 16, z: 1 + step * 0.05 });
    view.setDraft(next, { constructionId: record.id, anchorId });
    assert.equal(view.previewMesh, mesh, 'the preview mesh is created once');
    assert.equal(view.previewMesh.geometry, geometry, 'and keeps its geometry object');
    for (const [slot, attribute] of attributes.entries()) {
      assert.equal(geometry.getAttribute(['position', 'normal', 'uv'][slot]), attribute);
      assert.equal(attribute.array.length, attributes[slot].array.length, 'no buffer grew');
    }
    assert.equal(geometry.getIndex(), index);
  }

  assert.equal(view.stats.previewBufferAllocations, allocations, 'a drag allocates no buffer');
  assert.equal(view.stats.previewBufferWrites, 41);
  assert.equal(view.previewMesh.visible, true);
  assert.ok(geometry.getAttribute('position').count > 0);
  assert.ok(vertices > 0);
  // The arc is computed once: a moving anchor inside the same segments only
  // rewrites vertex data.
  assert.equal(view.stats.previewSpanChanges, 1);
  assert.equal(entry.modules.size, 5);
  view.dispose();
});

test('cancelling a draft restores the exact pre-drag state', () => {
  const { view, entry, record } = residentWall();
  const anchorId = record.path.anchors[2].id;
  const visibleBefore = visibilitySnapshot(entry);
  const modulesBefore = [...entry.modules].map(([id, resident]) => ({
    id,
    resident,
    meshes: [...resident.meshes],
  }));

  view.setDraft(draftFrom(record, anchorId, { x: 16, z: 1.5 }), { constructionId: record.id, anchorId });
  assert.equal(visibleMeshCount(entry), 6);
  view.clearDraft();
  // A gesture that commits nothing is released on the next frame.
  view.update();

  const visibleAfter = visibilitySnapshot(entry);
  for (const [label, visible] of visibleBefore) {
    assert.equal(visibleAfter.get(label), visible, `${label} visibility must be restored`);
  }
  for (const { id, resident, meshes } of modulesBefore) {
    assert.equal(entry.modules.get(id), resident);
    for (const [index, mesh] of meshes.entries()) assert.equal(resident.meshes[index], mesh);
  }
  assert.equal(entry.group.visible, true);
  assert.equal(view.previewMesh.visible, false, 'no ghost preview after a cancel');
  assert.equal(view.previewOcclusion, null);
  assert.equal(view.stats.previewStaleDrops, 0, 'a cancel is not a stale result');
  assert.equal(entry.structuralRevision, record.revision, 'nothing committed');
  view.dispose();
});

test('a commit keeps the seed, the materials and the plan the preview promised', async () => {
  const compiler = createDeferredCompiler();
  const { store, view, entry, record, camera } = residentWall({ compilerClient: compiler });
  const anchorId = record.path.anchors[2].id;
  const seedBefore = entry.record.seed;
  const styleBefore = JSON.stringify(entry.record.style);
  const materialsBefore = entry.materials;
  const moduleIdsBefore = [...entry.modules.keys()].sort();
  const candidate = draftFrom(record, anchorId, { x: 16, z: 1.5 });
  // What the user is watching: these hashes are the stones the commit must land.
  const promised = planConstruction(candidate).modules.map((module) => module.contentHash);

  view.setDraft(candidate, { constructionId: record.id, anchorId });
  const identity = { ...view.previewDraft.identity };
  assert.equal(identity.seed, seedBefore, 'the preview carries the committed seed');
  assert.equal(identity.entityId, record.id, 'and the record it will commit to');

  // The editor's ending order: clear the draft, then run the command.
  view.clearDraft();
  assert.equal(view.previewMesh.visible, true, 'the preview is held over the swap');
  assert.ok(executeConstructionCommand(store, {
    type: 'replace',
    constructionId: record.id,
    record: candidate,
    dirtySegmentIds: [],
  }));

  assert.equal(entry.record.seed, seedBefore, 'a commit must not reroll the seed');
  assert.equal(JSON.stringify(entry.record.style), styleBefore);
  assert.equal(entry.materials, materialsBefore, 'nor rebuild the stone materials');
  assert.equal(view.previewMesh.visible, true, 'the replacement is not ready yet');

  compiler.requests.at(-1).resolve();
  await flushAsync();
  drainBuildQueue(view, planConstruction(store.get(record.id)), camera);

  assert.deepEqual(moduleHashes(entry).map((part) => part.split(':')[1]), promised);
  assert.deepEqual([...entry.modules.keys()].sort(), moduleIdsBefore, 'module lineage survives');
  assert.equal(view.previewMesh.visible, false, 'the preview retires once masonry is ready');
  assert.equal(view.stats.previewStaleDrops, 0);
  assert.equal(view.stats.queueDepth, 0);
  assert.equal(entry.group.visible, true);
  assert.equal(view.previewHold, null);
  view.dispose();
});

test('the preview covers the replaced arc at every hand-over step', async () => {
  const compiler = createDeferredCompiler();
  const { store, view, entry, record, camera } = residentWall({ compilerClient: compiler });
  const anchorId = record.path.anchors[2].id;
  const span = { ...view.draftSpan(entry, draftFrom(record, anchorId, { x: 16, z: 1.5 }), anchorId) };
  const spanProducts = () => {
    const products = view.draftSpanProducts(entry, span);
    return products.filter((object) => object.parent?.visible !== false);
  };
  const covered = () => (
    view.previewMesh.visible || spanProducts().some((object) => object.visible)
  );

  const candidate = draftFrom(record, anchorId, { x: 16, z: 1.5 });
  view.setDraft(candidate, { constructionId: record.id, anchorId });
  assert.equal(covered(), true, 'the drag shows the preview over the replaced arc');

  view.clearDraft();
  assert.equal(covered(), true, 'the hold keeps the arc covered while the wall rebuilds');
  assert.equal(spanProducts().some((object) => object.visible), false, 'and cannot double-draw it');

  executeConstructionCommand(store, {
    type: 'replace',
    constructionId: record.id,
    record: candidate,
    dirtySegmentIds: [],
  });
  view.update();
  view.updateLod(camera, VIEWPORT_HEIGHT);
  assert.equal(covered(), true, 'the commit frame shows either the preview or the new masonry');
  assert.equal(view.previewMesh.visible, true, 'the replacement plan has not landed yet');

  compiler.requests.at(-1).resolve();
  await flushAsync();
  drainBuildQueue(view, planConstruction(store.get(record.id)), camera);

  assert.equal(view.previewMesh.visible, false);
  assert.equal(covered(), true, 'the rebuilt masonry covers the same arc');
  assert.equal(view.stats.previewStaleDrops, 0);
  view.dispose();
});

test('a draft result for a record that vanished is dropped, not applied', () => {
  const { store, view, entry, record } = residentWall();
  const anchorId = record.path.anchors[2].id;
  const modulesBefore = [...entry.modules.keys()].sort();

  view.setDraft(draftFrom(record, anchorId, { x: 16, z: 1.5 }), { constructionId: record.id, anchorId });
  view.clearDraft();
  assert.equal(view.previewHold?.constructionId, record.id);
  // Undo or delete lands while the preview is parked: the record is gone.
  store.remove(record.id);

  view.update();

  assert.equal(view.previewMesh.visible, false, 'a stale draft must not resurrect the shape');
  assert.equal(view.previewHold, null);
  assert.equal(view.previewOcclusion, null);
  assert.equal(view.stats.previewStaleDrops, 1, 'the late draft result is counted as dropped');
  assert.equal(view.entries.has(record.id), false);
  assert.equal(view.root.children.some((child) => child.userData.constructionId === record.id), false);
  assert.deepEqual([...entry.modules.keys()].sort(), modulesBefore);
  assert.equal(entry.group.visible, true);
  view.dispose();
});

test('a stale compile for the pre-drag shape cannot overwrite the committed plan', async () => {
  const compiler = createDeferredCompiler();
  const { store, view, entry, record, camera } = residentWall({ compilerClient: compiler });
  const anchorId = record.path.anchors[2].id;
  const staleRequest = compiler.requests.at(0);

  const candidate = draftFrom(record, anchorId, { x: 16, z: 1.5 });
  view.setDraft(candidate, { constructionId: record.id, anchorId });
  view.clearDraft();
  executeConstructionCommand(store, {
    type: 'replace',
    constructionId: record.id,
    record: candidate,
    dirtySegmentIds: [],
  });
  const committedRequest = compiler.requests.at(-1);
  assert.notEqual(committedRequest, staleRequest);
  committedRequest.resolve();
  await flushAsync();
  drainBuildQueue(view, planConstruction(store.get(record.id)), camera);
  const committedHashes = moduleHashes(entry);

  // The worker answers the abandoned request last.
  staleRequest.resolve();
  await flushAsync();
  view.update();

  assert.deepEqual(moduleHashes(entry), committedHashes, 'the older shape must not come back');
  assert.equal(view.previewMesh.visible, false);
  assert.equal(entry.structuralRevision, store.get(record.id).revision);
  view.dispose();
});

test('a whole-record draft still leaves the record resident and cancels clean', () => {
  const { view, entry, record } = residentWall();
  const anchorId = record.path.anchors[2].id;
  const visibleBefore = visibilitySnapshot(entry);
  const thicknessDraft = {
    ...record,
    revision: record.revision + 1,
    dimensions: { ...record.dimensions, thickness: 0.95 },
  };

  view.setDraft(thicknessDraft, { constructionId: record.id, anchorId });
  // Thickness changes every module's inputs, so the replaced arc is the whole
  // wall — but the record is still on screen, still resident, still one record.
  assert.equal(view.previewDraft.span.whole, true);
  assert.equal(entry.group.visible, true);
  assert.equal(entry.modules.size, 5);
  assert.equal(view.stats.previewOccludedProducts, 10, 'the whole wall steps aside');
  assert.equal(view.previewMesh.visible, true);

  view.clearDraft();
  view.update();
  for (const [label, visible] of visibleBefore) {
    assert.equal(visibilitySnapshot(entry).get(label), visible, `${label} visibility must be restored`);
  }
  assert.equal(view.previewMesh.visible, false);
  view.dispose();
});

test('a new-wall draft previews under its own identity and retires on clear', () => {
  const store = new ConstructionStore();
  const view = new ConstructionView({
    terrainView: createTerrainView(),
    store,
    compilerClient: null,
  });
  const record = wallRecord();
  view.setDraft(record, { valid: true });

  assert.equal(view.previewDraft.identity.entityId, record.id, 'the provisional entity id');
  assert.equal(view.previewDraft.identity.seed, record.seed, 'and the seed the draft carries');
  assert.equal(view.previewMesh.visible, true);
  assert.equal(view.previewOcclusion, null, 'a draw has nothing committed to replace');
  assert.equal(view.previewHold, null);

  view.clearDraft();
  assert.equal(view.previewMesh.visible, false, 'no committed product to wait for');
  assert.equal(view.previewHold, null);
  assert.equal(view.previewDraft, null);

  // The buffers outlive the gesture: the next wall allocates nothing new.
  const allocations = view.stats.previewBufferAllocations;
  view.setDraft(record, { valid: true });
  assert.equal(view.stats.previewBufferAllocations, allocations);
  assert.equal(view.previewMesh.visible, true);
  view.dispose();
});

/** A compiler whose responses the test resolves by hand. */
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
