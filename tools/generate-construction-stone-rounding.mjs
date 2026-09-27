#!/usr/bin/env node
/**
 * Generate ConstructionStoneRoundingProfiles.generated.js from stone-rounding.yml.
 *
 * Usage:
 *   node tools/generate-construction-stone-rounding.mjs
 *   node tools/generate-construction-stone-rounding.mjs --check
 *   node tools/generate-construction-stone-rounding.mjs --yaml <in> --out <out>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DEFAULT_YAML_PATH = join(ROOT, 'src/editor/construction/config/stone-rounding.yml');
const DEFAULT_OUT_PATH = join(
  ROOT,
  'src/editor/construction/config/ConstructionStoneRoundingProfiles.generated.js',
);

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0 || index + 1 >= process.argv.length) return null;
  return process.argv[index + 1];
}

const YAML_PATH = argValue('--yaml') ?? DEFAULT_YAML_PATH;
const OUT_PATH = argValue('--out') ?? DEFAULT_OUT_PATH;

const range = (minimum, maximum) => ({ kind: 'range', minimum, maximum });
const integer = (minimum, maximum) => ({ kind: 'integer', minimum, maximum });
const triple = (minimum, maximum) => ({ kind: 'triple', minimum, maximum });

const LOD_BAND = {
  arcSegments: integer(1, 6),
  rimRings: integer(1, 4),
  faceRings: integer(0, 3),
};

/** Key order here is the key order of the generated file. */
const SCHEMA = {
  edgeRadius: {
    ratioMin: range(0, 0.5),
    ratioMax: range(0, 0.5),
    minimum: range(0, 0.3),
    maximum: range(0, 0.3),
  },
  cornerRadius: {
    ratioMin: range(0, 0.5),
    ratioMax: range(0, 0.5),
  },
  bulge: {
    ratioMin: range(0, 0.3),
    ratioMax: range(0, 0.3),
    maximum: range(0, 0.1),
  },
  asymmetry: range(0, 1),
  saddle: range(0, 0.5),
  protrusionScale: range(0, 1),
  categories: {
    field: range(0, 1),
    coping: range(0, 1),
    ashlar: range(0, 1),
    quoin: range(0, 1),
    voussoir: range(0, 1),
    merlon: range(0, 1),
    recess: range(0, 1),
  },
  footingScale: range(0, 2),
  minimumEdgeRadius: range(0.001, 0.05),
  lod: {
    near: LOD_BAND,
    coarse: LOD_BAND,
  },
  occlusion: {
    crevice: range(0, 1),
    creviceReach: range(0.1, 4),
    down: range(0, 1),
    face: range(0, 1),
    sky: range(0, 1),
    base: range(0, 1),
    baseHeight: range(0.05, 5),
    groundTint: triple(0, 2),
    groundTintHeight: range(0, 5),
  },
  shellShade: range(0.2, 1.2),
};

function fail(message) {
  throw new Error(`stone-rounding.yml: ${message}`);
}

function isLeaf(schema) {
  return typeof schema.kind === 'string';
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateLeaf(value, schema, label) {
  if (schema.kind === 'triple') {
    if (!Array.isArray(value) || value.length !== 3) fail(`${label} must be a three-number array.`);
    value.forEach((channel, index) => validateLeaf(channel, range(schema.minimum, schema.maximum), `${label}[${index}]`));
    return;
  }
  if (!Number.isFinite(value) || value < schema.minimum || value > schema.maximum) {
    fail(`${label} must be between ${schema.minimum} and ${schema.maximum}, got ${value}.`);
  }
  if (schema.kind === 'integer' && !Number.isInteger(value)) {
    fail(`${label} must be an integer, got ${value}.`);
  }
}

/** `partial` allows missing keys, for per-style overrides before merging. */
function validate(value, schema, label, { partial = false } = {}) {
  if (isLeaf(schema)) {
    validateLeaf(value, schema, label);
    return;
  }
  if (!isPlainObject(value)) fail(`${label} must be an object.`);
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(schema, key)) fail(`${label} has unknown key "${key}".`);
  }
  for (const [key, child] of Object.entries(schema)) {
    if (!Object.hasOwn(value, key)) {
      if (partial) continue;
      fail(`${label} is missing "${key}".`);
    }
    validate(value[key], child, `${label}.${key}`, { partial });
  }
}

function validateRelations(profile, label) {
  if (profile.edgeRadius.ratioMax < profile.edgeRadius.ratioMin) {
    fail(`${label}.edgeRadius ratio range is reversed.`);
  }
  if (profile.edgeRadius.maximum < profile.edgeRadius.minimum) {
    fail(`${label}.edgeRadius absolute range is reversed.`);
  }
  if (profile.cornerRadius.ratioMax < profile.cornerRadius.ratioMin) {
    fail(`${label}.cornerRadius ratio range is reversed.`);
  }
  if (profile.bulge.ratioMax < profile.bulge.ratioMin) {
    fail(`${label}.bulge ratio range is reversed.`);
  }
}

function merge(defaults, override = {}, schema = SCHEMA) {
  if (isLeaf(schema)) return override ?? defaults;
  const merged = {};
  for (const [key, child] of Object.entries(schema)) {
    merged[key] = Object.hasOwn(override ?? {}, key)
      ? merge(defaults[key], override[key], child)
      : defaults[key];
  }
  return merged;
}

function loadDocument(yamlPath = YAML_PATH) {
  const document = yaml.load(readFileSync(yamlPath, 'utf8'));
  if (!isPlainObject(document)) fail('root must be an object.');
  for (const key of Object.keys(document)) {
    if (!['version', 'defaults', 'styles'].includes(key)) fail(`root has unknown key "${key}".`);
  }
  if (document.version !== 1) fail(`unsupported version ${document.version}.`);
  validate(document.defaults, SCHEMA, 'defaults');
  validateRelations(document.defaults, 'defaults');
  const styles = document.styles ?? {};
  if (!isPlainObject(styles)) fail('styles must be an object.');
  for (const [key, override] of Object.entries(styles)) {
    validate(override, SCHEMA, `styles.${key}`, { partial: true });
    const merged = merge(document.defaults, override);
    validate(merged, SCHEMA, `styles.${key}`);
    validateRelations(merged, `styles.${key}`);
  }
  return document;
}

function serialize(value, schema, indent) {
  if (isLeaf(schema)) {
    return schema.kind === 'triple'
      ? `Object.freeze([${value.join(', ')}])`
      : String(value);
  }
  const inner = `${indent}  `;
  const lines = Object.keys(schema).map((key) => (
    `${inner}${key}: ${serialize(value[key], schema[key], inner)},`
  ));
  return ['Object.freeze({', ...lines, `${indent}})`].join('\n');
}

function generateSource(document) {
  const styleKeys = Object.keys(document.styles ?? {}).sort();
  const entries = [
    `  default: ${serialize(merge(document.defaults), SCHEMA, '  ')},`,
    ...styleKeys.map((key) => (
      `  ${JSON.stringify(key)}: ${serialize(merge(document.defaults, document.styles[key]), SCHEMA, '  ')},`
    )),
  ];
  return [
    '/* Generated by tools/generate-construction-stone-rounding.mjs — do not edit. */',
    '',
    'export const CONSTRUCTION_STONE_ROUNDING_PROFILES = Object.freeze({',
    ...entries,
    '});',
    '',
    'export function constructionStoneRoundingProfile(styleKey) {',
    '  return CONSTRUCTION_STONE_ROUNDING_PROFILES[styleKey]',
    '    ?? CONSTRUCTION_STONE_ROUNDING_PROFILES.default;',
    '}',
    '',
  ].join('\n');
}

const check = process.argv.includes('--check');
const source = generateSource(loadDocument());

if (check) {
  let current = null;
  try {
    current = readFileSync(OUT_PATH, 'utf8');
  } catch {
    current = null;
  }
  if (current !== source) {
    console.error('ConstructionStoneRoundingProfiles.generated.js is out of date. Run:');
    console.error('  node tools/generate-construction-stone-rounding.mjs');
    process.exit(1);
  }
  console.log('ConstructionStoneRoundingProfiles.generated.js is up to date.');
  process.exit(0);
}

writeFileSync(OUT_PATH, source);
console.log(`Wrote ${OUT_PATH}`);
