/**
 * Resolves `character.hero` against `character.roster` into the one definition
 * the runtime reads, with every optional block filled in. The configuration
 * itself is validated at load (`src/config/validateCharacterConfig.js`); this
 * only applies defaults, so it trusts the shape it is given.
 */

import { PROCEDURAL_HERO_ID } from '../../../config/validateCharacterConfig.js';

export const HERO_KIND_PROCEDURAL = 'procedural';
export const HERO_KIND_AUTHORED = 'authored';

const DEFAULT_ROOT_MOTION = Object.freeze({
  inPlace: true,
  nodes: Object.freeze(['Hips']),
  axes: Object.freeze(['x', 'z']),
});

const DEFAULT_LOCOMOTION = Object.freeze({
  maxTimeScale: 3.2,
  minTimeScale: 0.5,
  swimCadence: 0.55,
});

/**
 * @param {object | undefined} character the `character` config section
 */
export function resolveHeroCharacter(character) {
  const id = character?.hero ?? PROCEDURAL_HERO_ID;
  if (id === PROCEDURAL_HERO_ID) {
    return Object.freeze({ kind: HERO_KIND_PROCEDURAL, id });
  }
  const entry = character.roster?.[id];
  if (!entry) throw new Error(`character.hero "${id}" is not in character.roster.`);
  return Object.freeze({
    kind: HERO_KIND_AUTHORED,
    id,
    name: entry.name ?? id,
    scene: entry.scene,
    targetHeight: entry.targetHeight,
    clips: Object.freeze({
      idle: entry.clips.idle ?? null,
      walk: entry.clips.walk,
      run: entry.clips.run,
    }),
    clipSpeedInHeights: Object.freeze({
      walk: entry.clipSpeedInHeights.walk,
      run: entry.clipSpeedInHeights.run,
    }),
    rootMotion: Object.freeze({ ...DEFAULT_ROOT_MOTION, ...(entry.rootMotion ?? {}) }),
    locomotion: Object.freeze({ ...DEFAULT_LOCOMOTION, ...(entry.locomotion ?? {}) }),
    footPlacement: entry.footPlacement !== false,
  });
}
