import assert from 'node:assert/strict';
import test from 'node:test';

import { SwitchableCharacterView } from '../src/editor/character/SwitchableCharacterView.js';
import {
  HERO_STORAGE_KEY,
  availableHeroIds,
  resolveHeroPreference,
  storeHeroPreference,
} from '../src/editor/character/heroPreference.js';

const character = { hero: 'drusniel', roster: { drusniel: {}, goblin: {} } };

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    values,
  };
}

test('the preference is the URL, then the stored pick, then the config, then the drow', () => {
  assert.deepEqual(availableHeroIds(character), ['drusniel', 'goblin', 'drow']);
  const storage = memoryStorage({ [HERO_STORAGE_KEY]: 'goblin' });
  assert.equal(resolveHeroPreference(character, { search: '?hero=drow', storage }), 'drow');
  assert.equal(resolveHeroPreference(character, { storage }), 'goblin');
  assert.equal(resolveHeroPreference(character, {}), 'drusniel');
  assert.equal(resolveHeroPreference({}, {}), 'drow');
});

test('stale or unknown picks fall through instead of breaking the hero', () => {
  const storage = memoryStorage({ [HERO_STORAGE_KEY]: 'retired-hero' });
  assert.equal(resolveHeroPreference(character, { search: '?hero=nobody', storage }), 'drusniel');
});

test('storage that throws is survivable both ways', () => {
  const hostile = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  };
  assert.equal(resolveHeroPreference(character, { storage: hostile }), 'drusniel');
  assert.equal(storeHeroPreference('goblin', hostile), false);
  const storage = memoryStorage();
  assert.equal(storeHeroPreference('goblin', storage), true);
  assert.equal(storage.values.get(HERO_STORAGE_KEY), 'goblin');
});

function fakeView(heroId, log) {
  let resolve;
  const view = {
    heroId,
    visible: false,
    disposed: false,
    updates: 0,
    ready: new Promise((settle) => { resolve = settle; }),
    finishLoading(ok = true) { resolve(ok); },
    setVisible(visible) { this.visible = Boolean(visible); },
    update() { this.updates += 1; },
    prewarm() { log.push(`prewarm ${heroId}`); },
    shiftWorld() {},
    beginCast() {},
    beginCastAlongCamera() {},
    handPosition(which, out) { return out; },
    dispose() { this.disposed = true; log.push(`dispose ${heroId}`); },
  };
  return view;
}

function createSwitch() {
  const log = [];
  const views = [];
  const switcher = new SwitchableCharacterView({
    createView: (heroId) => {
      const view = fakeView(heroId, log);
      views.push(view);
      return view;
    },
    heroId: 'drusniel',
  });
  views[0].finishLoading();
  return { switcher, views, log };
}

test('the current hero stays on screen until the new one is ready', async () => {
  const { switcher, views, log } = createSwitch();
  switcher.prewarm('renderer', 'camera');
  switcher.setVisible(true);
  const swapped = switcher.setHero('goblin');
  const [drusniel, goblin] = views;
  assert.equal(switcher.pendingHeroId, 'goblin');
  switcher.update(0.016, {}, 0);
  assert.equal(drusniel.updates, 1, 'the old hero keeps being driven while the new one loads');
  assert.equal(goblin.visible, false);
  assert.ok(log.includes('prewarm goblin'), 'the new hero compiles against the same renderer');

  goblin.finishLoading(true);
  assert.equal(await swapped, true);
  assert.equal(switcher.heroId, 'goblin');
  assert.equal(goblin.visible, true, 'the new hero inherits the visibility');
  assert.equal(drusniel.disposed, true);
});

test('a hero that fails to load leaves the current one in place', async () => {
  const { switcher, views } = createSwitch();
  const swapped = switcher.setHero('goblin');
  views[1].finishLoading(false);
  assert.equal(await swapped, false);
  assert.equal(switcher.heroId, 'drusniel');
  assert.equal(views[0].disposed, false);
  assert.equal(views[1].disposed, true);
});

test('a newer pick supersedes one still loading', async () => {
  const { switcher, views } = createSwitch();
  const first = switcher.setHero('goblin');
  const second = switcher.setHero('drow');
  views[1].finishLoading(true);
  views[2].finishLoading(true);
  assert.equal(await first, false);
  assert.equal(await second, true);
  assert.equal(switcher.heroId, 'drow');
  assert.equal(views[1].disposed, true);
});

test('disposing mid-swap releases both heroes', async () => {
  const { switcher, views } = createSwitch();
  const swapped = switcher.setHero('goblin');
  switcher.dispose();
  views[1].finishLoading(true);
  assert.equal(await swapped, false);
  assert.ok(views[0].disposed && views[1].disposed);
});

test('a hero that failed to load can be picked again, and loads afresh', async () => {
  const { switcher, views } = createSwitch();
  const failed = switcher.setHero('goblin');
  views[1].finishLoading(false);
  assert.equal(await failed, false);
  assert.equal(switcher.pendingHeroId, null, 'nothing is left pending after a failure');
  const retry = switcher.setHero('goblin');
  assert.equal(views.length, 3, 'the retry builds a new view');
  views[2].finishLoading(true);
  assert.equal(await retry, true);
  assert.equal(switcher.heroId, 'goblin');
});

test('a hero whose preparation throws is dropped, not left pending', async () => {
  const log = [];
  const switcher = new SwitchableCharacterView({
    createView: (heroId) => {
      const view = fakeView(heroId, log);
      if (heroId === 'goblin') view.ready = Promise.reject(new Error('compile failed'));
      else view.finishLoading();
      return view;
    },
    heroId: 'drusniel',
  });
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal(await switcher.setHero('goblin'), false);
  } finally {
    console.error = originalError;
  }
  assert.equal(switcher.heroId, 'drusniel');
  assert.equal(switcher.pendingHeroId, null);
  assert.ok(log.includes('dispose goblin'), 'the half-made hero is released');
});
