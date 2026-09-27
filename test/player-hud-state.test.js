import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HUD_PHASE,
  isPlayerEngaged,
  resolveHudPhase,
  resolveHudStatus,
} from '../src/editor/player/hud/hudState.js';
import {
  PLAYER_MODE_EDIT,
  PLAYER_MODE_WALK,
  PLAYER_PAUSED_MESSAGE,
  PLAYER_POINTER_LOCK_MESSAGE,
  PLAYER_SPAWN_PICK_MESSAGE,
} from '../src/editor/player/playerConstants.js';

function walking(player = {}, extra = {}) {
  return {
    mode: PLAYER_MODE_WALK,
    paused: false,
    awaitingSpawn: false,
    player: { pointerLocked: true, uiBlocked: false, harnessActive: false, ...player },
    ...extra,
  };
}

test('the HUD phase follows mode, spawn picking and pause', () => {
  assert.equal(resolveHudPhase({ mode: PLAYER_MODE_EDIT, awaitingSpawn: false }), HUD_PHASE.hidden);
  assert.equal(resolveHudPhase({ mode: PLAYER_MODE_EDIT, awaitingSpawn: true }), HUD_PHASE.spawn);
  assert.equal(resolveHudPhase(walking()), HUD_PHASE.walking);
  assert.equal(resolveHudPhase(walking({}, { paused: true })), HUD_PHASE.paused);
});

test('walking with the mouse captured shows no status line', () => {
  assert.equal(resolveHudStatus(walking()), null);
  assert.equal(resolveHudStatus({ mode: PLAYER_MODE_EDIT }), null);
});

test('an uncaptured mouse asks for a click, unless an overlay or the harness owns input', () => {
  const status = resolveHudStatus(walking({ pointerLocked: false }));
  assert.equal(status.icon, 'mouse');
  assert.equal(status.text, PLAYER_POINTER_LOCK_MESSAGE);
  assert.equal(resolveHudStatus(walking({ pointerLocked: false, uiBlocked: true })), null);
  assert.equal(resolveHudStatus(walking({ pointerLocked: false, harnessActive: true })), null);
});

test('spawn picking and pausing name the key that backs out', () => {
  const spawn = resolveHudStatus({ mode: PLAYER_MODE_EDIT, awaitingSpawn: true });
  assert.equal(spawn.text, PLAYER_SPAWN_PICK_MESSAGE);
  assert.deepEqual(spawn.keys, [{ key: 'Esc', label: 'cancel' }]);

  const paused = resolveHudStatus(walking({ pointerLocked: false }, { paused: true }));
  assert.equal(paused.text, PLAYER_PAUSED_MESSAGE);
  assert.deepEqual(paused.keys, [{ key: 'Esc', label: 'leave' }]);
});

test('collision readiness outranks the click prompt', () => {
  const loading = resolveHudStatus(walking({
    pointerLocked: false,
    collision: { active: true, ready: false, readiness: { missing: ['a', 'b'], failed: [] } },
  }));
  assert.equal(loading.tone, 'busy');
  assert.match(loading.text, /2 chunks left/);

  const one = resolveHudStatus(walking({
    collision: { active: true, ready: false, readiness: { missing: ['a'], failed: [] } },
  }));
  assert.match(one.text, /1 chunk left/);

  const failed = resolveHudStatus(walking({
    collision: {
      active: true,
      ready: false,
      readiness: { missing: [], failed: [{ chunkKey: '3:4', message: 'bad mesh' }] },
    },
  }));
  assert.equal(failed.tone, 'danger');
  assert.equal(failed.text, 'Collision failed in 3:4: bad mesh');

  const ready = resolveHudStatus(walking({
    collision: { active: true, ready: true, readiness: { missing: [], failed: [] } },
  }));
  assert.equal(ready, null);
});

test('hints count the player as engaged once the camera is theirs', () => {
  assert.equal(isPlayerEngaged(walking()), true);
  assert.equal(isPlayerEngaged(walking({ pointerLocked: false })), false);
  assert.equal(isPlayerEngaged(walking({ pointerLocked: false, harnessActive: true })), true);
  assert.equal(isPlayerEngaged({}), false);
});
