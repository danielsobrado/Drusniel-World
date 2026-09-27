import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHARACTER_ASSETS } from './character-assets.config.mjs';
import { readGlbJson } from './lib/glb-inspection.mjs';
import { missingHumanoidBones } from '../src/editor/character/glb/humanoidRig.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(rootDir, 'assets', 'extracted', 'character-manifest.json');

function hash(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

if (!fs.existsSync(manifestPath)) {
  throw new Error('Missing character manifest; run npm run prepare:character-assets.');
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const expectedIds = CHARACTER_ASSETS.map((asset) => asset.id);
if (JSON.stringify(manifest.assets?.map((asset) => asset.id)) !== JSON.stringify(expectedIds)) {
  throw new Error('Character manifest does not match configured characters.');
}

for (const [index, definition] of CHARACTER_ASSETS.entries()) {
  const record = manifest.assets[index];
  for (const [relativePath, expectedBytes, expectedHash] of [
    [record.input, record.inputBytes, record.inputSha256],
    [record.prepared, record.preparedBytes, record.preparedSha256],
  ]) {
    const bytes = fs.readFileSync(path.join(rootDir, relativePath));
    if (bytes.length !== expectedBytes || hash(bytes) !== expectedHash) {
      throw new Error(`${relativePath} does not match the character manifest.`);
    }
  }
  if (record.input !== definition.input
      || record.prepared !== definition.prepared
      || record.published !== definition.published) {
    throw new Error(`${definition.id} character paths do not match configuration.`);
  }

  const json = readGlbJson(fs.readFileSync(path.join(rootDir, record.prepared)), record.prepared);
  const clips = (json.animations ?? []).map((animation) => animation.name);
  if (JSON.stringify([...clips].sort()) !== JSON.stringify([...definition.clips].sort())) {
    throw new Error(`${record.prepared} must contain exactly the clips ${definition.clips.join(', ')}.`);
  }
  if ((json.extensionsUsed ?? []).includes('KHR_draco_mesh_compression')) {
    throw new Error(`${record.prepared} is still Draco-compressed.`);
  }
  if ((json.skins?.length ?? 0) < 1
      || json.asset?.extras?.runtimeCharacter !== definition.id) {
    throw new Error(`${record.prepared} is missing its rig or character provenance.`);
  }
  const missingBones = missingHumanoidBones((json.nodes ?? []).map((node) => node.name));
  if (missingBones.length > 0) {
    throw new Error(`${record.prepared} is missing humanoid bones: ${missingBones.join(', ')}.`);
  }
}

console.log(`validated ${CHARACTER_ASSETS.length} playable character GLB(s)`);
