import { createKeycap, hudIcon } from './hudIcons.js';
import { resolveHudStatus } from './hudState.js';

function statusSignature(status) {
  if (!status) return '';
  const keys = status.keys.map(({ key, label }) => `${key}:${label}`).join(',');
  return `${status.tone}|${status.icon}|${status.text}|${keys}`;
}

/** The one-line prompt under the mode switch: spawn, loading, click to play, paused. */
export class HudStatus {
  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'hud-status';
    this.element.setAttribute('role', 'status');
    this.element.setAttribute('aria-live', 'polite');
    this.element.hidden = true;
    this.signature = null;
  }

  render(state) {
    const status = resolveHudStatus(state);
    const signature = statusSignature(status);
    if (signature === this.signature) return;
    this.signature = signature;

    this.element.hidden = !status;
    if (!status) {
      this.element.replaceChildren();
      return;
    }

    this.element.dataset.tone = status.tone;
    this.element.title = status.text;
    const icon = document.createElement('span');
    icon.className = 'hud-status__icon';
    icon.innerHTML = hudIcon(status.icon);
    const text = document.createElement('span');
    text.className = 'hud-status__text';
    text.textContent = status.text;
    const parts = [icon, text];
    for (const { key, label } of status.keys) {
      const hint = document.createElement('span');
      hint.className = 'hud-status__hint';
      hint.append(createKeycap(key), label);
      parts.push(hint);
    }
    this.element.replaceChildren(...parts);
  }

  dispose() {
    this.element.remove();
  }
}
