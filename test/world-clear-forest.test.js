import assert from 'node:assert/strict';
import test from 'node:test';
import { TerrainAwareEditorController } from '../src/editor/TerrainAwareEditorController.js';
import { normalizeForestEditDocument } from '../src/editor/forest/ForestEditDocument.js';
import { InfiniteWorldStore } from '../src/editor/world/InfiniteWorldStore.js';

function createController(worldStore) {
  const controller = Object.create(TerrainAwareEditorController.prototype);
  Object.assign(controller, {
    worldStore,
    objectMap: { clear: () => [], replaceAll() {} },
    terrainView: { refreshAll() {} },
    campaign: null,
    importWarnings: [],
    undoStack: [],
    redoStack: [],
    setSelectedObject() {},
    setSelectedConstruction() {},
    refreshObjects() {},
    flushTopEdit() {},
    emitState() {},
    emitMap() {},
  });
  return controller;
}

for (const [kind, edit] of Object.entries({
  felled: ['tree:1'],
  planted: [{ stableId: 'planted:1', x: 2, z: -3 }],
  patches: [{ patchId: 'patch:1', state: 'cleared', progress: 1 }],
})) {
  test(`Clear World removes ${kind} forest edits and preserves them through undo/redo`, () => {
    const world = new InfiniteWorldStore({ chunkSize: 8, tileSize: 2 });
    const edits = normalizeForestEditDocument({ [kind]: edit });
    world.forestEdits = edits;
    const controller = createController(world);

    controller.clearWorld();
    assert.deepEqual(world.toDocument().forestEdits, normalizeForestEditDocument());
    assert.equal(controller.undoStack.length, 1);
    controller.clearWorld();
    assert.equal(controller.undoStack.length, 1);

    controller.undo();
    assert.deepEqual(world.toDocument().forestEdits, edits);
    controller.redo();
    assert.deepEqual(world.toDocument().forestEdits, normalizeForestEditDocument());
  });
}
