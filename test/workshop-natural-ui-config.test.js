import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';

const source = yaml.load(readFileSync(
  new URL('../config/workshop-radial-menus.yaml', import.meta.url),
  'utf8',
));

// The workshop is the creator-facing authoring surface: it is opened from the
// editor's own tool row (`EditorUi.bind`, `data-tool="workshop"`) and its job is
// to author reusable assets that bake into the Objects palette — see
// `docs/plans/procedural-medieval-construction/15-procedural-object-workshop.md`
// and the state fields in `docs/workshop-aaa-sota-implementation-plan.md` §7.
// Its modes are therefore authoring domains and must read as building concepts a
// creator recognises, not as engine subsystems. Imported material maps and
// generation detail are legitimate here (the material inspector implements both),
// but they belong to a secondary lane inside their domain — never beside
// `Structure`/`Roof`/`Colors` as a first-class choice.
const AUTHORING_DOMAINS = ['structure', 'materials', 'roof', 'textures', 'colors', 'details'];

// Render-pipeline vocabulary that only means something to whoever wrote the
// renderer. `textures` is an authoring domain (importing authored maps), so it is
// deliberately not on this list.
const RENDERER_TERMS = [
  'renderer', 'shader', 'pipeline', 'gpu', 'lod', 'buffer', 'drawcall', 'draw-call', 'batch',
];

// Renderer-facing controls that we do expose, and the single secondary lane each is
// allowed to live under. If one of these ever becomes its own mode it has been
// promoted to a first-class creator choice, which is the regression this test guards.
const SECONDARY_LANES = new Map([
  ['pbr-maps', 'textures'],
  ['detail-level', 'details'],
]);

// Lanes inside the primary domains: each names an authored property of the building.
// A raw render input (a `materialMaps` lane, say) appearing in one of these modes
// would re-expose renderer internals as a primary choice.
const PRIMARY_DOMAINS = new Set(['structure', 'materials', 'roof', 'colors']);
const AUTHORED_FIELDS = new Set([
  'archetype', 'shape', 'towerSide', 'finish', 'style', 'topStyle', 'roofScale', 'roofOverhang',
]);
const AUTHORED_SOURCES = new Set(['materialPresets', 'colorField']);

// Persisted version-five recipe booleans the Features lane switches. These are
// authored asset properties, not renderer settings: `ProceduralAssetStore` validates
// `ivy` and `remesh`, `ProceduralWorkshopUi.readInput` reads all three toggles plus
// imported albedo, and plan 15 steps 9-10 document remeshing and procedural albedo as
// authoring choices.
const FEATURE_TOGGLES = ['windows', 'ivy', 'remesh', 'albedo'];

function lanesWithOwner() {
  return source.modes.flatMap((mode) => (mode.lanes ?? []).map((lane) => ({ mode, lane })));
}

test('workshop radial exposes authored concepts with renderer internals kept secondary', () => {
  const modeIds = source.modes.map(({ id }) => id);
  assert.deepEqual(modeIds, AUTHORING_DOMAINS);

  // Every mode a creator can land on is a labelled authoring domain, and no mode is
  // named after the renderer.
  for (const mode of source.modes) {
    assert.equal(typeof mode.label, 'string');
    assert.ok(mode.label.trim().length > 0, `mode ${mode.id} needs a human label`);
    assert.ok((mode.lanes ?? []).length > 0, `mode ${mode.id} needs at least one lane`);
    for (const term of RENDERER_TERMS) {
      assert.equal(
        mode.id.includes(term),
        false,
        `mode ${mode.id} names the renderer instead of the authoring concept`,
      );
      assert.equal(
        mode.label.toLowerCase().includes(term),
        false,
        `mode ${mode.id} label "${mode.label}" names the renderer`,
      );
    }
  }

  // Renderer-internal controls stay grouped under a clearly secondary lane inside
  // their domain: present, reachable, and never a top-level mode of their own.
  const lanes = lanesWithOwner();
  for (const [laneId, ownerModeId] of SECONDARY_LANES) {
    const owners = lanes.filter(({ lane }) => lane.id === laneId).map(({ mode }) => mode.id);
    assert.deepEqual(
      owners,
      [ownerModeId],
      `lane ${laneId} must stay inside the ${ownerModeId} lane, not become a mode`,
    );
    assert.equal(modeIds.includes(laneId), false, `${laneId} must not be a top-level mode`);
  }

  // The primary domains still expose authored building properties — the simplification
  // that made this menu readable to creators is not lost.
  for (const mode of source.modes) {
    if (!PRIMARY_DOMAINS.has(mode.id)) continue;
    for (const lane of mode.lanes) {
      const authored = lane.field
        ? AUTHORED_FIELDS.has(lane.field)
        : AUTHORED_SOURCES.has(lane.source);
      assert.ok(
        authored,
        `lane ${lane.id} in primary domain ${mode.id} exposes a render input instead of an authored property`,
      );
    }
  }

  const featureLane = lanes.find(({ lane }) => lane.id === 'feature-toggles').lane;
  assert.deepEqual(featureLane.items.map(({ value }) => value), FEATURE_TOGGLES);
});
