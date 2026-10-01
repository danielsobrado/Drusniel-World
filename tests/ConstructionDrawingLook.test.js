import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorController } from '../src/editor/EditorController.js';
import { ConstructionStore } from '../src/editor/construction/ConstructionStore.js';
import { createConstructionDraft } from '../src/editor/construction/ConstructionDrawingLook.js';
import { createCubicBezierPathFromStroke } from '../src/editor/construction/curve/CubicBezierPath.js';
import { ConstructionGizmoController } from '../src/editor/construction/ui/ConstructionGizmoController.js';
import { ConstructionInspector } from '../src/editor/construction/ui/ConstructionInspector.js';

const path = () => createCubicBezierPathFromStroke([[0, 0], [7, 0]]);

test('fresh drawn walls use sandstone in preview and in the stored record', () => {
  const editor = Object.create(EditorController.prototype);
  Object.assign(editor, { constructionHeight: 2.4, constructionThickness: 0.6 });
  const draft = editor.constructionDraftRecord(path(), 'construction-1');
  assert.equal(draft.style.key, 'glade-sandstone');
  assert.equal(draft.top.style, 'flat');
  const record = new ConstructionStore().add(draft);
  assert.equal(record.style.key, draft.style.key);
  assert.equal(record.top.style, draft.top.style);
});

test('matching a wall copies appearance and size, then draws independent walls without changing the source', () => {
  const store = new ConstructionStore();
  const source = store.add({
    ...createConstructionDraft(path(), 'construction-1', { height: 2.7, thickness: 0.65 }),
    style: { key: 'rounded-fieldstone', version: 1, materials: { stone: 'limestone' } },
    top: { style: 'crenellated', base: 2.7, profile: [] },
    features: [{ id: 'door', kind: 'door', segmentId: path().segments[0].id, arcFraction: 0.5,
      width: 1, height: 2, sill: 0, profile: 'round', dressed: true }],
  });
  const snapshot = JSON.stringify(store.get(source.id));
  const editor = Object.create(EditorController.prototype);
  Object.assign(editor, {
    constructionStore: store, constructionView: { clearDraft() {}, setSelection() {} },
    undoStack: [], redoStack: [], pendingTopEdit: null,
    constructionMode: 'edit', tool: 'select', selectedConstructionId: source.id,
    constructionCutArmed: true, emitState() {}, updatePreviews() {}, setSelectedObject() {},
  });
  assert.equal(editor.drawMatchingConstruction(source.id), true);
  assert.equal(editor.tool, 'construction');
  assert.equal(editor.constructionMode, 'draw');
  assert.equal(editor.constructionCutArmed, false);
  assert.equal(editor.selectedConstructionId, null);
  for (const id of ['construction-2', 'construction-3']) {
    const draft = editor.constructionDraftRecord(path(), id);
    assert.deepEqual(draft.style, source.style);
    assert.deepEqual(draft.dimensions, source.dimensions);
    assert.equal(draft.top.style, source.top.style);
    assert.ok(!draft.features?.length, 'matching does not duplicate a doorway');
    assert.notEqual(draft.seed, source.seed);
    assert.notEqual(draft.style.materials, source.style.materials);
  }
  assert.equal(JSON.stringify(store.get(source.id)), snapshot);
  assert.equal(editor.undoStack.length, 0, 'choosing a drawing look is not a wall edit');
  assert.equal(editor.drawMatchingConstruction('missing-wall'), false);
});

test('both nearby actions start drawing from the wall they belong to', () => {
  for (const prototype of [ConstructionGizmoController.prototype, ConstructionInspector.prototype]) {
    const ui = Object.create(prototype);
    const calls = [];
    Object.assign(ui, { constructionId: 'construction-7', close() {},
      controller: { drawMatchingConstruction(id) { calls.push(id); return true; } } });
    if (ui.action) ui.action('match');
    else ui.handleClick({ target: { closest: selector => selector.includes('match') } });
    assert.deepEqual(calls, ['construction-7']);
  }
});
