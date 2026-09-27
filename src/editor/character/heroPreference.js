/**
 * Which hero this viewer walks as.
 *
 * `character.hero` in `editor.config.yaml` is the default. A viewer's own pick
 * is remembered in browser storage — a per-viewer convenience, so it may be
 * missing or unwritable (private windows, blocked site data) and every access
 * is guarded. `?hero=<id>` overrides both, which keeps QA and screenshot runs
 * deterministic.
 */

import { PROCEDURAL_HERO_ID } from '../../config/validateCharacterConfig.js';

export const HERO_STORAGE_KEY = 'simcity-dnd.hero';

/** Every hero id the configuration offers, the procedural drow last. */
export function availableHeroIds(character) {
  return [...Object.keys(character?.roster ?? {}), PROCEDURAL_HERO_ID];
}

function readStorage(storage) {
  try {
    return storage?.getItem(HERO_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

/**
 * @param {object | undefined} character the `character` config section
 * @param {{ search?: string, storage?: Storage | null }} [environment]
 * @returns {string} a hero id the configuration offers
 */
export function resolveHeroPreference(character, { search = '', storage = null } = {}) {
  const offered = new Set(availableHeroIds(character));
  const fromUrl = new URLSearchParams(search).get('hero');
  for (const candidate of [fromUrl, readStorage(storage), character?.hero]) {
    if (candidate && offered.has(candidate)) return candidate;
  }
  return PROCEDURAL_HERO_ID;
}

/** Remember a pick. Returns whether it was stored. */
export function storeHeroPreference(heroId, storage) {
  try {
    storage?.setItem(HERO_STORAGE_KEY, heroId);
    return Boolean(storage);
  } catch {
    return false;
  }
}
