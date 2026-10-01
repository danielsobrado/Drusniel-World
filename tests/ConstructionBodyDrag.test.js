import assert from 'node:assert/strict';
import test from 'node:test';
import { ConstructionGizmoController } from '../src/editor/construction/ui/ConstructionGizmoController.js';
import { ConstructionStore } from '../src/editor/construction/ConstructionStore.js';
import { executeConstructionCommand } from '../src/editor/construction/ConstructionCommands.js';
import { createConstructionDraft } from '../src/editor/construction/ConstructionDrawingLook.js';
import { constructionPathFromGesture } from '../src/editor/construction/ConstructionDrawingPath.js';

const event = (x = 0, overrides = {}) => ({ pointerId: 1, button: 0, detail: 1, clientX: x, clientY: 0,
  preventDefault() {}, stopImmediatePropagation() {}, ...overrides });
function fixture() {
  const store = new ConstructionStore();
  const record = store.add(createConstructionDraft(constructionPathFromGesture([{ x: 0, z: 0 }, { x: 7, z: 0 }]), 'wall', { height: 3, thickness: 0.8 }));
  const commits = [];
  const gizmo = Object.create(ConstructionGizmoController.prototype);
  Object.assign(gizmo, {
    controller: {
      tool: 'construction', constructionMode: 'edit', selectedConstructionId: record.id,
      constructionStore: store, constructionView: { pickHandle() { return null; },
        pickConstruction() { return record.id; }, setDraft() {}, clearDraft() {} },
      runConstructionCommand(command) { const result = executeConstructionCommand(store, command); commits.push(result); return result; },
      setSelectedConstruction() {},
    },
    directView: { pick() { return null; }, groundHeight() { return 0; }, setRecord() {},
      canonicalPointOnHorizontalPlane(x, y) { return { x: x * 0.1, z: y * 0.1 }; } },
    canvas: { setPointerCapture() {}, hasPointerCapture() { return true; }, releasePointerCapture() {} },
    syncDirectGizmo() {}, close() {},
  });
  return { gizmo, store, record, commits };
}

test('dragging a selected wall body previews then commits exactly one translation', () => {
  const { gizmo, store, record, commits } = fixture();
  gizmo.onDirectPointerDown(event());
  assert.equal(gizmo.directDrag.kind, 'move-all');
  gizmo.onDirectPointerMove(event(3));
  assert.equal(gizmo.directDrag.candidate, null, 'selection clicks tolerate small pointer jitter');
  gizmo.onDirectPointerMove(event(20));
  assert.deepEqual(store.get(record.id), record);
  gizmo.onDirectPointerUp(event(20));
  assert.equal(commits.length, 1);
  assert.equal(store.get(record.id).path.anchors[0].position[0], record.path.anchors[0].position[0] + 2);
});

test('cancelled body drags, clicks, nodes and Alt never commit a body move', () => {
  const { gizmo, store, record, commits } = fixture();
  gizmo.onDirectPointerDown(event()); gizmo.onDirectPointerUp(event());
  gizmo.onDirectPointerDown(event()); gizmo.onDirectPointerMove(event(20)); gizmo.cancelDirectDrag();
  gizmo.onDirectPointerUp(event(20));
  assert.deepEqual(store.get(record.id), record);
  assert.equal(commits.length, 0);
  gizmo.onDirectPointerDown(event(0, { altKey: true }));
  assert.equal(gizmo.directDrag, null);
  gizmo.controller.constructionView.pickHandle = () => ({ anchorId: 'node' });
  gizmo.onDirectPointerDown(event());
  assert.equal(gizmo.directDrag, null, 'node drag has priority over the wall surface');
});
