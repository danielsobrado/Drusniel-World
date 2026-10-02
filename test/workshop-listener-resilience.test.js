import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkshopCommandBus, WorkshopPreviewTransaction } from '../src/editor/workshop/kernel/index.js';
import { WorkshopHistory } from '../src/editor/workshop/history/WorkshopHistory.js';
import { WorkshopToolController } from '../src/editor/workshop/interaction/WorkshopToolController.js';

function createBus() {
  return new WorkshopCommandBus({
    entities: [{ id: 'root', type: 'structure', properties: { width: 8 } }],
  });
}

const resize = { type: 'entity.set-properties', id: 'root', properties: { width: 12 } };

test('observer failures cannot strand committed workshop edits outside undo history', (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const bus = createBus();
  bus.subscribe(() => { throw new Error('derived view failed'); });
  const history = new WorkshopHistory(bus);
  const revisions = [];
  bus.subscribe((event) => revisions.push(event.document.revision));
  const preview = new WorkshopPreviewTransaction(bus);
  preview.dispatch(resize);

  assert.doesNotThrow(() => preview.commit());
  assert.equal(preview.isClosed, true);
  assert.equal(history.undoDepth, 1);
  assert.equal(bus.document.getEntity('root').properties.width, 12);
  assert.doesNotThrow(() => history.undo());
  assert.equal(bus.document.getEntity('root').properties.width, 8);
  assert.equal(history.redoDepth, 1);
  assert.doesNotThrow(() => history.redo());
  assert.equal(bus.document.getEntity('root').properties.width, 12);
  assert.deepEqual(revisions, [1, 2, 3]);
  assert.equal(logged.mock.callCount(), 3);
  history.dispose();
});

test('a failed preview listener cannot reopen an already committed gesture', (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const bus = createBus();
  const history = new WorkshopHistory(bus);
  const tools = new WorkshopToolController({ bus });
  const notifications = [];
  tools.subscribePreview(({ reason }) => {
    if (reason === 'commit') throw new Error('preview renderer failed');
  });
  tools.subscribePreview(({ reason }) => notifications.push(reason));
  tools.beginGesture('resize');
  tools.updateGesture(resize);
  assert.doesNotThrow(() => tools.commitGesture());
  assert.equal(tools.isGestureActive, false);
  assert.equal(history.undoDepth, 1);
  assert.doesNotThrow(() => tools.beginGesture('resize'));
  assert.equal(tools.cancelGesture(), true);
  assert.deepEqual(notifications, ['begin', 'update', 'commit', 'begin', 'cancel']);
  assert.equal(logged.mock.callCount(), 1);
  history.dispose();
});
