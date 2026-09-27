import { HudKeyHints } from './HudKeyHints.js';
import { HudMinimap } from './HudMinimap.js';
import { HudStatus } from './HudStatus.js';
import { HUD_PHASE, isPlayerEngaged, resolveHudPhase } from './hudState.js';

function createReticle() {
  const reticle = document.createElement('span');
  reticle.className = 'hud-reticle';
  reticle.setAttribute('aria-hidden', 'true');
  return reticle;
}

/**
 * The walking HUD: a status line, the reticle, the heading-up minimap and the
 * control hints. Spells keep their own dock (`spell_menu.js`).
 *
 * `render` follows view-mode state changes; `update` runs every frame and only
 * moves the minimap, so it stays cheap while walking and free otherwise.
 */
export class PlayerHud {
  /**
   * @param {object} options
   * @param {HTMLElement} options.viewport
   * @param {boolean} [options.canToggleCamera] whether V switches to third person
   * @param {ConstructorParameters<typeof HudMinimap>[0] | null} [options.minimap]
   */
  constructor({ viewport, canToggleCamera = false, minimap = null }) {
    this.element = document.createElement('div');
    this.element.className = 'player-hud';
    this.element.hidden = true;
    this.phase = HUD_PHASE.hidden;

    this.status = new HudStatus();
    this.reticle = createReticle();
    this.minimap = minimap ? new HudMinimap(minimap) : null;
    this.hints = new HudKeyHints({ canToggleCamera });
    this.element.append(
      this.status.element,
      this.reticle,
      ...(this.minimap ? [this.minimap.element] : []),
      this.hints.element,
    );
    viewport.append(this.element);
  }

  render(state) {
    const phase = resolveHudPhase(state);
    this.phase = phase;
    this.element.hidden = phase === HUD_PHASE.hidden;
    this.element.dataset.hudPhase = phase;
    this.reticle.hidden = phase !== HUD_PHASE.walking;
    this.status.render(state);
    this.minimap?.render(phase);
    this.hints.render(phase, { engaged: isPlayerEngaged(state) });
  }

  update(heading, nowMs = performance.now()) {
    if (this.phase !== HUD_PHASE.walking) return;
    this.minimap?.update(heading, nowMs);
  }

  dispose() {
    this.minimap?.dispose();
    this.hints.dispose();
    this.status.dispose();
    this.element.remove();
  }
}
