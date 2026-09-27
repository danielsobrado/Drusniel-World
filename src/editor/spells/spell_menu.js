import { emitAudio } from '../_clod_shims/audio.js';
import { defaultSpellConfig } from './spell_config.js';
import { spellGlyph } from './spell_icons.js';

const MISS_FLASH_MS = 280;
const CAST_LABEL_MS = 1100;
const SPELL_BUTTONS = Object.freeze([
  { id: 'fire', key: 1, method: 'playFire' },
  { id: 'water', key: 2, method: 'playWater' },
  { id: 'air', key: 3, method: 'playAir' },
  { id: 'earth', key: 4, method: 'playEarth' },
  { id: 'lightning', key: 5, method: 'playLightning' },
  { id: 'fireball', key: 6, method: 'playFireball' },
]);

function resolveMenuRoot(rootId, suppliedRoot) {
  if (suppliedRoot) return { root: suppliedRoot, owned: false };
  const existing = document.getElementById(rootId);
  if (existing) return { root: existing, owned: false };
  const root = document.createElement('nav');
  root.id = rootId;
  document.body.appendChild(root);
  return { root, owned: true };
}

function stopUiPropagation(event) {
  event.stopPropagation();
}

function createSpellButton({ id, key, label, onClick }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'spell-slot';
  button.dataset.spell = id;
  button.title = `${label} (${key})`;
  button.setAttribute('aria-label', `${label} spell, key ${key}`);
  button.setAttribute('aria-pressed', 'false');
  button.innerHTML = `
    <span class="spell-slot__glyph">${spellGlyph(id)}</span>
    <svg class="spell-slot__channel" viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="22" pathLength="100"/>
    </svg>
    <kbd class="spell-slot__key">${key}</kbd>
    <span class="spell-slot__label"></span>
  `;
  // Labels come from spells YAML, so they are set as text.
  button.querySelector('.spell-slot__label').textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function createGrip(title) {
  const grip = document.createElement('span');
  grip.className = 'spell-menu-grip';
  grip.title = `${title} — drag to move`;
  grip.setAttribute('aria-hidden', 'true');
  grip.innerHTML = '<i></i><i></i><i></i><i></i><i></i><i></i>';
  return grip;
}

/**
 * Feedback for a cast that started: the ring round the slot drains over the
 * cast, and the spell's name surfaces above it for a moment. Web Animations
 * restart cleanly when the same spell is cast again before the ring empties.
 */
function playCastFeedback(button, durationMs) {
  const ring = button.querySelector('.spell-slot__channel circle');
  const label = button.querySelector('.spell-slot__label');
  button.castAnimations?.forEach((animation) => animation.cancel());
  button.castAnimations = [
    ring?.animate?.(
      [{ strokeDashoffset: 0 }, { strokeDashoffset: 100 }],
      { duration: durationMs, easing: 'linear' },
    ),
    label?.animate?.(
      [{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }],
      { duration: CAST_LABEL_MS, easing: 'ease-out' },
    ),
  ].filter(Boolean);
}

/**
 * The spell dock: six round slots on a paper pill, dragged by its grip.
 * Casting from a slot and casting from the number keys (`cast`) share one
 * path, so both get the same ring, miss flash and cast sound.
 */
export function createSpellMenu(deps = {}) {
  const config = deps.config ?? defaultSpellConfig;
  const controller = deps.controller ?? {};
  const { root, owned } = resolveMenuRoot(config.menu.rootId, deps.root);
  const resetTimers = new Map();
  let missFlashTimer = 0;
  let dragOffset = null;

  root.replaceChildren();
  root.classList.add('spell-dock');
  root.setAttribute('aria-label', 'Spell menu');

  const grip = createGrip(config.menu.title);

  const slots = document.createElement('div');
  slots.className = 'spell-menu-slots';
  const buttons = new Map();

  const flashMiss = (button) => {
    window.clearTimeout(missFlashTimer);
    for (const other of buttons.values()) other.classList.remove('spell-miss');
    button.classList.add('spell-miss');
    missFlashTimer = window.setTimeout(() => {
      button.classList.remove('spell-miss');
      missFlashTimer = 0;
    }, MISS_FLASH_MS);
  };

  const castSpell = (descriptor) => {
    const entry = config[descriptor.id];
    const button = buttons.get(descriptor.id);
    if (!entry || !button) return false;

    window.clearTimeout(resetTimers.get(descriptor.id));
    const play = controller[descriptor.method];
    const fired = typeof play === 'function'
      && play(entry.castDurationMs) !== false;
    if (!fired) {
      button.setAttribute('aria-pressed', 'false');
      flashMiss(button);
      return false;
    }

    button.setAttribute('aria-pressed', 'true');
    playCastFeedback(button, entry.castDurationMs);
    emitAudio(`spell.${descriptor.id}.cast`, {
      volume: entry.audio.volume,
      durationMs: entry.castDurationMs,
    });
    resetTimers.set(descriptor.id, window.setTimeout(() => {
      button.setAttribute('aria-pressed', 'false');
      resetTimers.delete(descriptor.id);
    }, entry.castDurationMs));
    return true;
  };

  for (const descriptor of SPELL_BUTTONS) {
    const entry = config[descriptor.id];
    const button = createSpellButton({
      id: descriptor.id,
      key: descriptor.key,
      label: entry.label,
      onClick: () => castSpell(descriptor),
    });
    buttons.set(descriptor.id, button);
    slots.append(button);
  }

  root.append(grip, slots);
  root.addEventListener('pointerdown', stopUiPropagation);
  root.addEventListener('click', stopUiPropagation);

  const onDragMove = (event) => {
    if (!dragOffset) return;
    const maximumLeft = Math.max(0, window.innerWidth - root.offsetWidth);
    const maximumTop = Math.max(0, window.innerHeight - root.offsetHeight);
    const left = Math.max(0, Math.min(maximumLeft, event.clientX - dragOffset.x));
    const top = Math.max(0, Math.min(maximumTop, event.clientY - dragOffset.y));
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
  };

  const onDragEnd = () => {
    dragOffset = null;
    root.classList.remove('dragging');
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
  };

  const onDragStart = (event) => {
    if (!(event.target instanceof HTMLElement) || !grip.contains(event.target)) return;
    event.preventDefault();
    const rect = root.getBoundingClientRect();
    dragOffset = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    root.style.left = `${rect.left}px`;
    root.style.top = `${rect.top}px`;
    root.style.transform = 'none';
    root.style.bottom = 'auto';
    root.style.right = 'auto';
    root.classList.add('dragging');
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
  };

  grip.addEventListener('pointerdown', onDragStart);

  return {
    cast: (spellId) => {
      const descriptor = SPELL_BUTTONS.find(({ id }) => id === spellId);
      return descriptor ? castSpell(descriptor) : false;
    },
    castFire: () => castSpell(SPELL_BUTTONS[0]),
    castWater: () => castSpell(SPELL_BUTTONS[1]),
    castAir: () => castSpell(SPELL_BUTTONS[2]),
    castEarth: () => castSpell(SPELL_BUTTONS[3]),
    castLightning: () => castSpell(SPELL_BUTTONS[4]),
    castFireball: () => castSpell(SPELL_BUTTONS[5]),
    dispose() {
      for (const timer of resetTimers.values()) window.clearTimeout(timer);
      resetTimers.clear();
      window.clearTimeout(missFlashTimer);
      for (const button of buttons.values()) {
        button.castAnimations?.forEach((animation) => animation.cancel());
      }
      if (dragOffset) onDragEnd();
      grip.removeEventListener('pointerdown', onDragStart);
      root.removeEventListener('pointerdown', stopUiPropagation);
      root.removeEventListener('click', stopUiPropagation);
      root.classList.remove('spell-dock');
      if (owned) root.remove();
      else root.replaceChildren();
    },
  };
}
