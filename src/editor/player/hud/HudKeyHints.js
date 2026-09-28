import { HUD_PHASE } from './hudState.js';

/** How long the controls stay up once the player has taken the mouse. */
const REST_AFTER_MS = 8000;
const TAGLINE = 'Explore at your own pace';

function hintColumns({ canToggleCamera }) {
  return [
    { key: 'Mouse', label: 'Look around' },
    { key: 'WASD', label: 'Move' },
    { key: 'Shift', label: 'Run' },
    { key: 'Space', label: 'Jump' },
    canToggleCamera ? { key: 'V', label: 'Camera' } : null,
    { key: 'I', label: 'Bag' },
    { key: 'M', label: 'Map' },
    { key: 'Esc', label: 'Pause' },
  ].filter(Boolean);
}

/**
 * The lower-left legend, after grass-test's reference HUD: the scene's name with
 * a tagline, and under it the controls as a row of columns — the key in small
 * caps, what it does beneath — set straight on the world with a soft shadow, no
 * panel. The key row rests (fades) once the player has taken the mouse; the scene
 * line stays.
 */
export class HudKeyHints {
  /**
   * @param {object} [options]
   * @param {boolean} [options.canToggleCamera]
   * @param {() => string} [options.getSceneLabel] the place or time of day to title the legend
   */
  constructor({ canToggleCamera = false, getSceneLabel = () => '' } = {}) {
    this.getSceneLabel = getSceneLabel;
    this.element = document.createElement('section');
    this.element.className = 'hud-legend';
    this.element.hidden = true;
    this.element.innerHTML = `
      <div class="hud-legend__scene"><strong></strong><span>${TAGLINE}</span></div>
      <dl class="hud-keys" aria-label="Controls"></dl>
    `;
    this.sceneName = this.element.querySelector('.hud-legend__scene strong');
    this.keys = this.element.querySelector('.hud-keys');
    for (const column of hintColumns({ canToggleCamera })) {
      const cell = document.createElement('div');
      const key = document.createElement('dt');
      key.textContent = column.key;
      const label = document.createElement('dd');
      label.textContent = column.label;
      cell.append(key, label);
      this.keys.append(cell);
    }
    this.engaged = null;
    this.restTimer = 0;
    this.sceneLabel = null;
  }

  render(phase, { engaged }) {
    const visible = phase === HUD_PHASE.walking;
    this.element.hidden = !visible;
    this.refreshScene();
    if (!visible) {
      this.engaged = null;
      this.wake();
      return;
    }
    if (engaged === this.engaged) return;
    this.engaged = engaged;
    this.wake();
    if (engaged) {
      this.restTimer = setTimeout(() => this.keys.classList.add('is-resting'), REST_AFTER_MS);
    }
  }

  /** Cheap to call every frame: it only touches the DOM when the name changes. */
  refreshScene() {
    let label = '';
    try {
      label = this.getSceneLabel() ?? '';
    } catch {
      label = '';
    }
    if (label === this.sceneLabel) return;
    this.sceneLabel = label;
    this.sceneName.textContent = label;
    this.sceneName.parentElement.hidden = !label;
  }

  wake() {
    clearTimeout(this.restTimer);
    this.restTimer = 0;
    this.keys.classList.remove('is-resting');
  }

  dispose() {
    clearTimeout(this.restTimer);
    this.element.remove();
  }
}
