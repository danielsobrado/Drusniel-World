import { createKeycap } from './hudIcons.js';
import { HUD_PHASE } from './hudState.js';

/** How long the controls stay up once the player has taken the mouse. */
const REST_AFTER_MS = 8000;

function hintRows({ canToggleCamera }) {
  return [
    { keys: ['W', 'A', 'S', 'D'], label: 'Move' },
    { keys: ['Shift'], label: 'Run' },
    { keys: ['Space'], label: 'Jump' },
    canToggleCamera ? { keys: ['V'], label: 'Camera' } : null,
    { keys: ['I'], label: 'Bag' },
    { keys: ['M'], label: 'Map' },
    { keys: ['Esc'], label: 'Pause' },
  ].filter(Boolean);
}

/**
 * Keycap cheat sheet in the bottom-left corner. It stays up until the player
 * captures the mouse, then fades so the view is clean while playing.
 */
export class HudKeyHints {
  constructor({ canToggleCamera = false } = {}) {
    this.element = document.createElement('dl');
    this.element.className = 'hud-keys';
    this.element.setAttribute('aria-label', 'Controls');
    this.element.hidden = true;
    for (const row of hintRows({ canToggleCamera })) {
      const keys = document.createElement('dt');
      keys.append(...row.keys.map(createKeycap));
      const label = document.createElement('dd');
      label.textContent = row.label;
      this.element.append(keys, label);
    }
    this.engaged = null;
    this.restTimer = 0;
  }

  render(phase, { engaged }) {
    const visible = phase === HUD_PHASE.walking;
    this.element.hidden = !visible;
    if (!visible) {
      this.engaged = null;
      this.wake();
      return;
    }
    if (engaged === this.engaged) return;
    this.engaged = engaged;
    this.wake();
    if (engaged) {
      this.restTimer = setTimeout(() => this.element.classList.add('is-resting'), REST_AFTER_MS);
    }
  }

  wake() {
    clearTimeout(this.restTimer);
    this.restTimer = 0;
    this.element.classList.remove('is-resting');
  }

  dispose() {
    clearTimeout(this.restTimer);
    this.element.remove();
  }
}
