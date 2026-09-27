/**
 * The `character` section: which figure the player walks as, the third-person
 * boom it is seen from, and the roster of authored characters.
 *
 * Optional in its entirety: the whole section absent means the procedural drow
 * with its built-in defaults.
 */

/** The procedural hero. Reserved: no roster entry may take this id. */
export const PROCEDURAL_HERO_ID = 'drow';

const ROOT_MOTION_AXES = new Set(['x', 'y', 'z']);

function fail(message) {
  throw new Error(`Invalid editor configuration: ${message}`);
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertPositive(value, path) {
  if (!Number.isFinite(value) || value <= 0) fail(`${path} must be positive.`);
}

function assertOptionalPositive(value, path) {
  if (value !== undefined) assertPositive(value, path);
}

function assertThirdPerson(boom) {
  if (boom === undefined) return;
  if (!isPlainObject(boom)) fail('character.thirdPerson must be an object.');
  for (const name of ['distance', 'pivotHeight', 'minDistance', 'clearance', 'damping']) {
    assertOptionalPositive(boom[name], `character.thirdPerson.${name}`);
  }
  // Shoulder offset is the one that may legitimately be zero or negative — zero
  // centres the character and negative swings the boom over the other shoulder.
  if (boom.shoulder !== undefined && !Number.isFinite(boom.shoulder)) {
    fail('character.thirdPerson.shoulder must be finite.');
  }
  if (boom.distance !== undefined && boom.minDistance !== undefined
      && boom.minDistance > boom.distance) {
    fail('character.thirdPerson.minDistance must not exceed distance.');
  }
}

function assertRootMotion(rootMotion, path) {
  if (rootMotion === undefined) return;
  if (!isPlainObject(rootMotion)) fail(`${path} must be an object.`);
  if (rootMotion.inPlace !== undefined && typeof rootMotion.inPlace !== 'boolean') {
    fail(`${path}.inPlace must be boolean.`);
  }
  if (rootMotion.nodes !== undefined
      && (!Array.isArray(rootMotion.nodes) || !rootMotion.nodes.every(isNonEmptyString))) {
    fail(`${path}.nodes must be a list of node names.`);
  }
  if (rootMotion.axes !== undefined
      && (!Array.isArray(rootMotion.axes)
        || rootMotion.axes.length === 0
        || !rootMotion.axes.every((axis) => ROOT_MOTION_AXES.has(axis)))) {
    fail(`${path}.axes must list some of x, y and z.`);
  }
}

function assertLocomotion(locomotion, path) {
  if (locomotion === undefined) return;
  if (!isPlainObject(locomotion)) fail(`${path} must be an object.`);
  for (const name of ['maxTimeScale', 'minTimeScale', 'swimCadence']) {
    assertOptionalPositive(locomotion[name], `${path}.${name}`);
  }
  if (locomotion.minTimeScale !== undefined && locomotion.maxTimeScale !== undefined
      && locomotion.minTimeScale > locomotion.maxTimeScale) {
    fail(`${path}.minTimeScale must not exceed maxTimeScale.`);
  }
}

function assertRosterEntry(entry, path) {
  if (!isPlainObject(entry)) fail(`${path} must be an object.`);
  if (!isNonEmptyString(entry.scene) || !entry.scene.toLowerCase().endsWith('.glb')) {
    fail(`${path}.scene must be a .glb path.`);
  }
  for (const name of ['name', 'title']) {
    if (entry[name] !== undefined && typeof entry[name] !== 'string') {
      fail(`${path}.${name} must be a string.`);
    }
  }
  assertPositive(entry.targetHeight, `${path}.targetHeight`);
  if (!isPlainObject(entry.clips)) fail(`${path}.clips must be an object.`);
  for (const kind of ['walk', 'run']) {
    if (!isNonEmptyString(entry.clips[kind])) fail(`${path}.clips.${kind} must name a clip.`);
  }
  if (entry.clips.idle !== undefined && entry.clips.idle !== null
      && !isNonEmptyString(entry.clips.idle)) {
    fail(`${path}.clips.idle must name a clip or be null.`);
  }
  if (!isPlainObject(entry.clipSpeedInHeights)) {
    fail(`${path}.clipSpeedInHeights must be an object.`);
  }
  for (const kind of ['walk', 'run']) {
    assertPositive(entry.clipSpeedInHeights[kind], `${path}.clipSpeedInHeights.${kind}`);
  }
  if (entry.clipSpeedInHeights.walk >= entry.clipSpeedInHeights.run) {
    fail(`${path}.clipSpeedInHeights.run must be faster than walk.`);
  }
  assertRootMotion(entry.rootMotion, `${path}.rootMotion`);
  assertLocomotion(entry.locomotion, `${path}.locomotion`);
  if (entry.footPlacement !== undefined && typeof entry.footPlacement !== 'boolean') {
    fail(`${path}.footPlacement must be boolean.`);
  }
}

function assertRoster(roster) {
  if (roster === undefined) return;
  if (!isPlainObject(roster)) fail('character.roster must be a mapping of id to character.');
  for (const [id, entry] of Object.entries(roster)) {
    if (id === PROCEDURAL_HERO_ID) {
      fail(`character.roster may not define "${PROCEDURAL_HERO_ID}"; that id is the procedural hero.`);
    }
    assertRosterEntry(entry, `character.roster.${id}`);
  }
}

export function assertCharacterConfig(character) {
  if (character === undefined) return;
  if (!isPlainObject(character)) fail('character must be an object.');
  for (const name of ['enabled', 'visibleInFirstPerson', 'contactShadow']) {
    if (character[name] !== undefined && typeof character[name] !== 'boolean') {
      fail(`character.${name} must be boolean.`);
    }
  }
  assertThirdPerson(character.thirdPerson);
  assertRoster(character.roster);
  if (character.hero === undefined || character.hero === PROCEDURAL_HERO_ID) return;
  if (!isNonEmptyString(character.hero)) fail('character.hero must be a roster id.');
  if (!Object.hasOwn(character.roster ?? {}, character.hero)) {
    fail(`character.hero "${character.hero}" is not in character.roster.`);
  }
}
