/**
 * Playable character GLBs.
 *
 * `input` is the canonical source: a Meshy export whose per-clip files were
 * merged by bone name (grass-test `scripts/merge-glb-animations.mjs`) and whose
 * Draco geometry was decoded, because this pipeline publishes Meshopt/KTX2 only
 * (docs/gltf-asset-optimization-decision.md). `clips` lists the animations the
 * runtime binds; every other clip — Meshy ships a `restpose` — is dropped.
 *
 * The files `Arcane_Wizard.glb` and `Devout_Cleric.glb` carry each other's
 * character (grass-test records the swap), so each is published under the name
 * of the character it actually holds.
 */
export const CHARACTER_ASSETS = Object.freeze([
  Object.freeze({
    id: 'drusniel',
    input: 'assets/characters/drusniel_dark_elf.glb',
    prepared: 'assets/extracted/characters/drusniel-dark-elf.glb',
    published: 'public/assets/characters/drusniel-dark-elf.glb',
    clips: Object.freeze(['Walking', 'Running']),
  }),
  Object.freeze({
    id: 'enanillo',
    input: 'assets/characters/enanillo_dwarven.glb',
    prepared: 'assets/extracted/characters/enanillo-dwarven.glb',
    published: 'public/assets/characters/enanillo-dwarven.glb',
    clips: Object.freeze(['Armature|walking_man|baselayer', 'Armature|running|baselayer']),
  }),
  Object.freeze({
    id: 'paladin',
    input: 'assets/characters/radiant_paladin.glb',
    prepared: 'assets/extracted/characters/radiant-paladin.glb',
    published: 'public/assets/characters/radiant-paladin.glb',
    clips: Object.freeze(['Armature|walking_man|baselayer', 'Armature|running|baselayer']),
  }),
  Object.freeze({
    id: 'cleric',
    input: 'assets/characters/arcane_wizard.glb',
    prepared: 'assets/extracted/characters/devout-cleric.glb',
    published: 'public/assets/characters/devout-cleric.glb',
    clips: Object.freeze(['Walking', 'Running']),
  }),
  Object.freeze({
    id: 'wizard',
    input: 'assets/characters/devout_cleric.glb',
    prepared: 'assets/extracted/characters/arcane-wizard.glb',
    published: 'public/assets/characters/arcane-wizard.glb',
    clips: Object.freeze(['Walking', 'Running']),
  }),
  Object.freeze({
    id: 'serpent',
    input: 'assets/characters/serpent_master.glb',
    prepared: 'assets/extracted/characters/serpent-master.glb',
    published: 'public/assets/characters/serpent-master.glb',
    clips: Object.freeze(['Walking', 'Running']),
  }),
  Object.freeze({
    id: 'villager',
    input: 'assets/characters/villager_rugged_blacks.glb',
    prepared: 'assets/extracted/characters/villager-rugged-blacks.glb',
    published: 'public/assets/characters/villager-rugged-blacks.glb',
    clips: Object.freeze(['Walking', 'Running']),
  }),
  Object.freeze({
    id: 'goblin',
    input: 'assets/characters/goblin_gribble_thornhide.glb',
    prepared: 'assets/extracted/characters/goblin-gribble-thornhide.glb',
    published: 'public/assets/characters/goblin-gribble-thornhide.glb',
    clips: Object.freeze(['Walking', 'Running']),
  }),
]);
