import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';

import { assertCharacterConfig } from '../src/config/validateCharacterConfig.js';
import {
  HERO_KIND_AUTHORED,
  HERO_KIND_PROCEDURAL,
  resolveHeroCharacter,
} from '../src/editor/character/glb/CharacterRoster.js';

const shipped = yaml.load(fs.readFileSync(new URL('../editor.config.yaml', import.meta.url), 'utf8'));

function rosterEntry(overrides = {}) {
  return {
    scene: '/assets/characters/hero.glb',
    targetHeight: 1.8,
    clips: { walk: 'Walking', run: 'Running' },
    clipSpeedInHeights: { walk: 0.85, run: 2.4 },
    ...overrides,
  };
}

function character(overrides = {}, entry = rosterEntry()) {
  return { hero: 'hero', roster: { hero: entry }, ...overrides };
}

test('the shipped configuration walks as Drusniel', () => {
  assert.doesNotThrow(() => assertCharacterConfig(shipped.character));
  const hero = resolveHeroCharacter(shipped.character);
  assert.equal(hero.kind, HERO_KIND_AUTHORED);
  assert.equal(hero.id, 'drusniel');
  assert.equal(hero.scene, '/assets/characters/drusniel-dark-elf.glb');
  assert.deepEqual(hero.clips, { idle: null, walk: 'Walking', run: 'Running' });
  assert.equal(hero.footPlacement, true);
});

test('an absent section or hero means the procedural drow', () => {
  assert.equal(resolveHeroCharacter(undefined).kind, HERO_KIND_PROCEDURAL);
  assert.equal(resolveHeroCharacter({ enabled: true }).kind, HERO_KIND_PROCEDURAL);
  assert.equal(resolveHeroCharacter({ hero: 'drow', roster: { hero: rosterEntry() } }).kind, HERO_KIND_PROCEDURAL);
});

test('optional roster blocks resolve to their defaults', () => {
  const hero = resolveHeroCharacter(character());
  assert.deepEqual(hero.rootMotion, { inPlace: true, nodes: ['Hips'], axes: ['x', 'z'] });
  assert.deepEqual(hero.locomotion, { maxTimeScale: 3.2, minTimeScale: 0.5, swimCadence: 0.55 });
  const tuned = resolveHeroCharacter(character({}, rosterEntry({ locomotion: { maxTimeScale: 2 } })));
  assert.equal(tuned.locomotion.maxTimeScale, 2);
  assert.equal(tuned.locomotion.swimCadence, 0.55);
});

test('the hero must name a roster entry', () => {
  assert.throws(() => assertCharacterConfig(character({ hero: 'nobody' })), /character\.hero "nobody"/);
  assert.throws(() => assertCharacterConfig({ hero: 'hero' }), /not in character\.roster/);
});

test('no roster entry may take the procedural id', () => {
  assert.throws(
    () => assertCharacterConfig({ hero: 'drow', roster: { drow: rosterEntry() } }),
    /may not define "drow"/,
  );
});

test('roster entries are checked field by field', () => {
  const cases = [
    [{ scene: 'hero.fbx' }, /scene must be a \.glb path/],
    [{ targetHeight: 0 }, /targetHeight must be positive/],
    [{ clips: { walk: 'Walking' } }, /clips\.run must name a clip/],
    [{ clips: { walk: 'Walking', run: 'Running', idle: 3 } }, /clips\.idle must name a clip or be null/],
    [{ clipSpeedInHeights: { walk: 2.4, run: 0.85 } }, /run must be faster than walk/],
    [{ rootMotion: { axes: ['w'] } }, /axes must list some of x, y and z/],
    [{ locomotion: { minTimeScale: 4, maxTimeScale: 3 } }, /minTimeScale must not exceed maxTimeScale/],
    [{ footPlacement: 'yes' }, /footPlacement must be boolean/],
  ];
  for (const [overrides, message] of cases) {
    assert.throws(() => assertCharacterConfig(character({}, rosterEntry(overrides))), message);
  }
});

test('third-person boom rules are unchanged by the move', () => {
  assert.throws(
    () => assertCharacterConfig({ thirdPerson: { distance: 2, minDistance: 3 } }),
    /minDistance must not exceed distance/,
  );
  assert.doesNotThrow(() => assertCharacterConfig({ thirdPerson: { shoulder: -0.4 } }));
});
