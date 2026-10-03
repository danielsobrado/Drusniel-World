import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
import { installBrowserStorage } from './fixtures/browser-storage.js';
import { createSceneSettingsDocument } from '../src/editor/settings/SceneSettings.js';
import { LoadingTracker } from '../src/editor/ui/LoadingTracker.js';

// CSS has no behavior in these controller tests; keep the real UI methods.
register('./fixtures/css-loader.mjs', import.meta.url);
const { EditorUi } = await import('../src/editor/EditorUi.js');

function createUi() {
  const ui = Object.create(EditorUi.prototype);
  ui.loading = new LoadingTracker();
  ui.sceneSettingsPreset = { value: 'browser:look' };
  ui.confirmSceneReload = () => true;
  ui.notices = [];
  ui.showToast = (message, isError) => ui.notices.push({ message, isError });
  return ui;
}

test('browser look activation failures reach the UI and release the reload overlay', async (t) => {
  const { primary } = installBrowserStorage(t);
  primary.set('look', createSceneSettingsDocument({ name: 'Saved look' }));
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ui = createUi();
  ui.sceneSettingsRuntime = {
    activate: async () => { throw new Error('session storage full'); },
  };
  await ui.handleAction('load-scene-settings');
  assert.deepEqual(ui.notices, [{ message: 'session storage full', isError: true }]);
  assert.equal(ui.loading.session.error, 'session storage full');
  t.mock.timers.tick(2600);
  assert.equal(ui.loading.session, null);
});

test('browser look action waits for activation instead of returning early', async (t) => {
  const { primary } = installBrowserStorage(t);
  primary.set('look', createSceneSettingsDocument({ name: 'Saved look' }));
  const ui = createUi();
  let complete;
  let activated;
  const started = new Promise((resolve) => { activated = resolve; });
  ui.sceneSettingsRuntime = {
    activate() {
      activated();
      return new Promise((resolve) => { complete = resolve; });
    },
  };
  let done = false;
  const action = ui.handleAction('load-scene-settings').then(() => { done = true; });
  await started;
  await Promise.resolve();
  assert.equal(done, false);
  complete();
  await action;
  assert.equal(done, true);
  assert.equal(ui.loading.session.error, null);
});

test('failed nested reload releases its notice during a map loading flow', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ui = createUi();
  await assert.rejects(ui.withLoading({ title: 'Map', steps: ['apply'] }, async () => {
    ui.showSceneReload('Reloading for the world look');
    throw new Error('world handoff failed');
  }), /world handoff failed/);
  assert.equal(ui.loading.session.error, 'world handoff failed');
  t.mock.timers.tick(2600);
  assert.equal(ui.loading.session, null);
});

test('an old reload failure timer cannot close a newer loading session', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ui = createUi();
  ui.showSceneReload('Reload');
  ui.failSceneReload(new Error('reload failed'));
  const next = ui.loading.begin({ title: 'Next map' });
  t.mock.timers.tick(2600);
  assert.equal(ui.loading.session, next);
});
