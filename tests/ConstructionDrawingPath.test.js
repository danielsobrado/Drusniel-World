import assert from 'node:assert/strict';
import test from 'node:test';
import { constructionPathFromGesture } from '../src/editor/construction/ConstructionDrawingPath.js';
import { sampleCubicBezierPath, findCubicBezierSelfIntersections } from '../src/editor/construction/curve/CubicBezierPath.js';
import { EditorController } from '../src/editor/EditorController.js';
import { ConstructionStore } from '../src/editor/construction/ConstructionStore.js';
import { constructionCutIntent } from '../src/editor/construction/ConstructionPointerIntent.js';

test('cut intent preserves Alt tangent editing and lets an explicit cut override handles', () => {
  const tangent = { handleKind: 'tangent' };
  assert.equal(constructionCutIntent({ altKey: true }, tangent), false);
  assert.equal(constructionCutIntent({ altKey: true }, null), true);
  assert.equal(constructionCutIntent({ altKey: false }, tangent, true), true);
});

test('circle drag makes four smooth quarters with one seam and consistent radius', () => {
  const path = constructionPathFromGesture([{ x: 12, z: -8 }, { x: 15, z: -4 }], { shape: 'circle' });
  assert.equal(path.closed, true);
  assert.equal(path.anchors.length, 4);
  assert.equal(path.segments.at(-1).endAnchorId, path.anchors[0].id);
  assert.equal(findCubicBezierSelfIntersections(path).length, 0);
  for (const point of sampleCubicBezierPath(path).points) {
    assert.ok(Math.abs(Math.hypot(point.x - 12, point.z + 8) - 5) < 0.002);
  }
});

test('line ignores intervening pointer wobble and short shapes do not build', () => {
  const stroke = [{ x: 0, z: 0 }, { x: 4, z: 7 }, { x: 8, z: 0 }];
  const path = constructionPathFromGesture(stroke, { shape: 'line' });
  assert.equal(path.anchors.length, 2);
  assert.ok(sampleCubicBezierPath(path).points.every(point => point.z === 0));
  for (const shape of ['line', 'circle', 'freehand']) {
    assert.equal(constructionPathFromGesture([{ x: 0, z: 0 }, { x: 0.1, z: 0 }], { shape }), null);
  }
});

test('freehand preview closes the same seam as commit', () => {
  const stroke = [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 0, z: 4 }, { x: 0.2, z: 0 }];
  const preview = constructionPathFromGesture(stroke);
  const committed = constructionPathFromGesture(stroke, { id: 'wall-2' });
  assert.equal(preview.closed, true);
  assert.deepEqual(sampleCubicBezierPath(preview).points.map(({ x, z }) => [x, z]),
    sampleCubicBezierPath(committed).points.map(({ x, z }) => [x, z]));
});

test('circle preview commits as one undoable semantic wall and cancel leaves no wall', () => {
  const store = new ConstructionStore();
  let preview;
  const editor = Object.create(EditorController.prototype);
  Object.assign(editor, {
    constructionStore: store, constructionShape: 'circle', constructionMode: 'draw',
    constructionHeight: 3, constructionThickness: 0.8, undoStack: [], redoStack: [],
    constructionView: { setDraft(record) { preview = record; }, clearDraft() {}, setSelection() {} },
    canvas: { setPointerCapture() {}, hasPointerCapture() { return false; } },
    pickCanonicalConstructionPoint: event => event.point,
    emitState() {}, emitMap() {}, emitNotice() {},
  });
  editor.onConstructionPointerDown({ pointerId: 1, point: { x: 0, z: 0 } });
  editor.onConstructionPointerMove({ pointerId: 1, point: { x: 4, z: 0 } });
  assert.equal(store.size, 0, 'preview must not author state');
  assert.equal(preview.path.closed, true);
  editor.onConstructionPointerUp({ pointerId: 1 });
  assert.equal(store.size, 1);
  assert.equal(editor.undoStack.length, 1);
  assert.equal(editor.constructionMode, 'draw');
  const saved = store.list()[0];
  assert.deepEqual(saved.path.anchors.map(a => a.position), preview.path.anchors.map(a => a.position));
  editor.undo();
  assert.equal(store.size, 0);
  editor.redo();
  assert.deepEqual({ ...store.list()[0], revision: saved.revision }, saved);
  editor.onConstructionPointerDown({ pointerId: 2, point: { x: 10, z: 0 } });
  editor.onConstructionPointerMove({ pointerId: 2, point: { x: 13, z: 0 } });
  editor.cancelConstructionGesture();
  editor.onConstructionPointerUp({ pointerId: 2 });
  assert.equal(store.size, 1);
  assert.equal(editor.undoStack.length, 1);
});
