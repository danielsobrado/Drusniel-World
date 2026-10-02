import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import {
  CONSTRUCTION_STONE_ROUNDING_PROFILES,
  constructionStoneRoundingProfile,
} from '../src/editor/construction/config/ConstructionStoneRoundingProfiles.generated.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const YAML_PATH = join(ROOT, 'src/editor/construction/config/stone-rounding.yml');
const GENERATOR = join(ROOT, 'tools/generate-construction-stone-rounding.mjs');

function runGenerator(args = []) {
  return spawnSync(process.execPath, [GENERATOR, ...args], { cwd: ROOT, encoding: 'utf8' });
}

function generateFrom(document) {
  const dir = mkdtempSync(join(tmpdir(), 'stone-rounding-'));
  const yamlPath = join(dir, 'stone-rounding.yml');
  const outPath = join(dir, 'out.js');
  writeFileSync(yamlPath, yaml.dump(document));
  const result = runGenerator(['--yaml', yamlPath, '--out', outPath]);
  let source = null;
  try {
    source = readFileSync(outPath, 'utf8');
  } catch {
    source = null;
  }
  rmSync(dir, { recursive: true, force: true });
  return { result, source };
}

function validDocument() {
  return yaml.load(readFileSync(YAML_PATH, 'utf8'));
}

test('the generated profile is up to date with the YAML', () => {
  const result = runGenerator(['--check']);
  assert.equal(result.status, 0, result.stderr);
});

test('unknown styles fall back to the defaults, which are frozen', () => {
  const profile = constructionStoneRoundingProfile('no-such-style');
  assert.equal(profile, CONSTRUCTION_STONE_ROUNDING_PROFILES.default);
  assert.equal(Object.isFrozen(profile), true);
  assert.equal(Object.isFrozen(profile.lod.near), true);
  assert.equal(Object.isFrozen(profile.occlusion.groundTint), true);
});

test('the shipped profile keeps its rounding budget', () => {
  const profile = constructionStoneRoundingProfile('rounded-fieldstone');
  // Rims well short of pills: past about a quarter of the short side the rims
  // meet in the middle of a course stone and the wall reads as stacked sausages.
  assert.ok(profile.edgeRadius.ratioMin >= 0.1 && profile.edgeRadius.ratioMax <= 0.25);
  assert.ok(profile.cornerRadius.ratioMin >= profile.edgeRadius.ratioMin);
  assert.deepEqual({ ...profile.lod.near }, { arcSegments: 3, edgeSegments: 1, rimRings: 2, faceRings: 1 });
  assert.deepEqual({ ...profile.lod.coarse }, { arcSegments: 1, edgeSegments: 1, rimRings: 1, faceRings: 0 });
  assert.ok(profile.categories.voussoir < profile.categories.field);
});

test('a style override merges over the defaults', () => {
  const document = validDocument();
  document.styles = { 'test-style': { bulge: { maximum: 0.02 }, occlusion: { crevice: 0.3 } } };
  const { result, source } = generateFrom(document);
  assert.equal(result.status, 0, result.stderr);
  assert.match(source, /"test-style": Object\.freeze/);
  assert.match(source, /maximum: 0\.02,/);
  assert.match(source, /crevice: 0\.3,/);
});

test('invalid documents are rejected with the offending key', () => {
  const cases = [
    [(document) => { document.defaults.edgeRadius.ratioMax = 0.9; }, /edgeRadius\.ratioMax/],
    [(document) => { document.defaults.lod.near.arcSegments = 2.5; }, /arcSegments must be an integer/],
    [(document) => { document.defaults.lod.near.arcSegments = 0; }, /arcSegments/],
    [(document) => { document.defaults.lod.coarse.arcSegments = -1; }, /arcSegments/],
    [(document) => { document.defaults.occlusion.groundTint = [1, 1]; }, /groundTint must be a three-number array/],
    [(document) => { document.defaults.shellShade = 5; }, /shellShade/],
    [(document) => { document.defaults.surprise = 1; }, /unknown key "surprise"/],
    [(document) => { delete document.defaults.saddle; }, /missing "saddle"/],
    [(document) => {
      document.defaults.bulge.ratioMin = 0.2;
      document.defaults.bulge.ratioMax = 0.1;
    }, /bulge ratio range is reversed/],
  ];
  for (const [mutate, message] of cases) {
    const document = validDocument();
    mutate(document);
    const { result } = generateFrom(document);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
  }
});
