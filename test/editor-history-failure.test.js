import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorController } from '../src/editor/EditorController.js';

function createEditor() {
  const editor = Object.create(EditorController.prototype);
  Object.assign(editor, {
    undoStack: [],
    redoStack: [],
    flushTopEdit() {},
    emitMap() {},
    emitState() {},
  });
  return editor;
}

for (const direction of ['undo', 'redo']) {
  test(`a failed ${direction} remains available for retry`, () => {
    const editor = createEditor();
    const entry = { kind: 'object', before: { x: 1 }, after: { x: 2 } };
    const source = direction === 'undo' ? editor.undoStack : editor.redoStack;
    const target = direction === 'undo' ? editor.redoStack : editor.undoStack;
    source.push(entry);
    editor.applyHistory = () => { throw new Error('placement rejected'); };
    assert.throws(() => editor[direction](), /placement rejected/);
    assert.deepEqual(source, [entry]);
    assert.deepEqual(target, []);

    let applied;
    editor.applyHistory = (record, action) => { applied = action === 'undo' ? record.before : record.after; };
    editor[direction]();
    assert.deepEqual(applied, direction === 'undo' ? entry.before : entry.after);
    assert.deepEqual(source, []);
    assert.deepEqual(target, [entry]);
  });
}

test('audio failures cannot discard committed edits or interrupt undo/redo', (t) => {
  t.mock.method(console, 'error', () => {});
  const editor = createEditor();
  const entry = { kind: 'construction', before: { height: 3 }, after: { height: 4 } };
  editor.constructionAudio = {
    commit() { throw new Error('audio failed'); },
    history() { throw new Error('audio failed'); },
  };
  let height = entry.after.height;
  editor.applyHistory = (record, direction) => { height = record[direction === 'undo' ? 'before' : 'after'].height; };
  assert.doesNotThrow(() => editor.commitHistory(entry));
  assert.equal(editor.undoStack.length, 1);
  assert.doesNotThrow(() => editor.undo());
  assert.equal(height, 3);
  assert.doesNotThrow(() => editor.redo());
  assert.equal(height, 4);
  assert.deepEqual(editor.undoStack, [entry]);
  assert.deepEqual(editor.redoStack, []);
});
