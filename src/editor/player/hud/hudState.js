import {
  PLAYER_MODE_WALK,
  PLAYER_PAUSED_MESSAGE,
  PLAYER_POINTER_LOCK_MESSAGE,
  PLAYER_SPAWN_PICK_MESSAGE,
} from '../playerConstants.js';

/** Which HUD the view-mode state calls for. */
export const HUD_PHASE = Object.freeze({
  hidden: 'hidden',
  spawn: 'spawn',
  walking: 'walking',
  paused: 'paused',
});

export function resolveHudPhase(state) {
  if (state?.awaitingSpawn) return HUD_PHASE.spawn;
  if (state?.mode !== PLAYER_MODE_WALK) return HUD_PHASE.hidden;
  return state.paused ? HUD_PHASE.paused : HUD_PHASE.walking;
}

function status(tone, icon, text, keys = []) {
  return Object.freeze({ tone, icon, text, keys: Object.freeze(keys) });
}

function collisionStatus(player) {
  const collision = player?.collision;
  if (!collision?.active || collision.ready || !collision.readiness) return null;
  const failure = collision.readiness.failed?.[0] ?? null;
  if (failure) {
    return status(
      'danger',
      'warning',
      `Collision failed in ${failure.chunkKey ?? 'the destination'}: ${failure.message}`,
    );
  }
  const missing = collision.readiness.missing?.length ?? 0;
  return status(
    'busy',
    'spinner',
    missing > 0
      ? `Preparing the ground… ${missing} chunk${missing === 1 ? '' : 's'} left`
      : 'Preparing the ground…',
  );
}

/**
 * The single line the HUD shows under the mode switch, or null for none.
 *
 * Walking with the mouse captured is the normal case and stays silent; every
 * other state says what the player can do next.
 */
export function resolveHudStatus(state) {
  const phase = resolveHudPhase(state);
  if (phase === HUD_PHASE.spawn) {
    return status('info', 'pin', PLAYER_SPAWN_PICK_MESSAGE, [{ key: 'Esc', label: 'cancel' }]);
  }
  if (phase === HUD_PHASE.paused) {
    return status('info', 'pause', PLAYER_PAUSED_MESSAGE, [{ key: 'Esc', label: 'leave' }]);
  }
  if (phase !== HUD_PHASE.walking) return null;

  const collision = collisionStatus(state.player);
  if (collision) return collision;

  const player = state.player ?? {};
  if (!player.pointerLocked && !player.uiBlocked && !player.harnessActive) {
    return status('info', 'mouse', PLAYER_POINTER_LOCK_MESSAGE);
  }
  return null;
}

/** Whether the player is actually driving the camera, so hints can step back. */
export function isPlayerEngaged(state) {
  const player = state?.player ?? {};
  return Boolean(player.pointerLocked || player.harnessActive);
}
