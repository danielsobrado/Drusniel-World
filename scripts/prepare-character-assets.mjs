import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup,
  metalRough,
  prune,
  resample,
  textureCompress,
} from '@gltf-transform/functions';
import sharp from 'sharp';
import { CHARACTER_ASSETS } from './character-assets.config.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(rootDir, 'assets', 'extracted', 'character-manifest.json');
const DRACO_EXTENSION = 'KHR_draco_mesh_compression';

function hash(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function glbExtensionsUsed(bytes) {
  const jsonLength = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8')).extensionsUsed ?? [];
}

/**
 * Meshy exports arrive Draco-compressed. The pipeline does not depend on a
 * Draco decoder, so a compressed source is accepted only when one happens to be
 * installed; otherwise the error says how to produce the canonical source.
 */
async function createSourceIo(inputBytes, inputPath) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  if (!glbExtensionsUsed(inputBytes).includes(DRACO_EXTENSION)) return io;
  let draco3d;
  try {
    draco3d = (await import('draco3dgltf')).default;
  } catch {
    throw new Error(
      `${inputPath} uses ${DRACO_EXTENSION}. Decode it once (for example with `
      + '@gltf-transform and draco3dgltf) and store the uncompressed GLB as the source.',
    );
  }
  return io.registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() });
}

function triangleCount(document) {
  let triangles = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const count = primitive.getIndices()?.getCount()
        ?? primitive.getAttribute('POSITION')?.getCount()
        ?? 0;
      triangles += Math.floor(count / 3);
    }
  }
  return triangles;
}

function animationDuration(animation) {
  return animation.listSamplers().reduce((duration, sampler) => {
    const times = sampler.getInput()?.getArray();
    return Math.max(duration, times?.[times.length - 1] ?? 0);
  }, 0);
}

const manifest = {
  version: 1,
  generator: 'scripts/prepare-character-assets.mjs',
  assets: [],
};

for (const definition of CHARACTER_ASSETS) {
  const inputPath = path.join(rootDir, definition.input);
  const preparedPath = path.join(rootDir, definition.prepared);
  const inputBytes = fs.readFileSync(inputPath);
  const io = await createSourceIo(inputBytes, definition.input);
  const document = await io.read(inputPath);
  const root = document.getRoot();
  for (const extension of root.listExtensionsUsed()) {
    if (extension.extensionName === DRACO_EXTENSION) extension.dispose();
  }

  const wanted = new Set(definition.clips);
  const kept = root.listAnimations().filter((animation) => wanted.has(animation.getName()));
  const missing = definition.clips.filter(
    (clip) => !kept.some((animation) => animation.getName() === clip),
  );
  if (missing.length > 0) {
    throw new Error(`${definition.input} is missing animation(s): ${missing.join(', ')}.`);
  }
  for (const animation of root.listAnimations()) {
    if (!wanted.has(animation.getName())) animation.dispose();
  }
  if (root.listSkins().length < 1) {
    throw new Error(`${definition.input} has no skin; a playable character must be rigged.`);
  }

  // Older Meshy exports ship no metal/roughness map and leave the factors at
  // glTF's defaults, which read as solid metal. Without an environment map the
  // scene gives metal nothing to reflect and the character renders near-black.
  // These are cloth, leather and skin: make them dielectric.
  const dielectricMaterials = [];
  for (const material of root.listMaterials()) {
    if (!material.getMetallicRoughnessTexture() && material.getMetallicFactor() > 0) {
      material.setMetallicFactor(0);
      dielectricMaterials.push(material.getName());
    }
  }

  const sourceMetadata = root.getAsset().extras ?? {};
  root.getAsset().generator = 'SimCity-DnD character asset preparer';
  root.getAsset().extras = {
    ...sourceMetadata,
    preparedFrom: definition.input.replaceAll('\\', '/'),
    runtimeCharacter: definition.id,
    runtimeClips: [...definition.clips],
  };

  await document.transform(
    metalRough(),
    resample({ tolerance: 1e-4 }),
    dedup(),
    prune(),
  );
  if (root.listTextures().length > 0) {
    await document.transform(textureCompress({
      encoder: sharp,
      targetFormat: 'webp',
      resize: [1024, 1024],
      quality: 90,
      effort: 4,
    }));
  }

  const outputBytes = await new NodeIO().registerExtensions(ALL_EXTENSIONS).writeBinary(document);
  fs.mkdirSync(path.dirname(preparedPath), { recursive: true });
  fs.writeFileSync(preparedPath, outputBytes);
  manifest.assets.push({
    id: definition.id,
    input: definition.input,
    inputBytes: inputBytes.length,
    inputSha256: hash(inputBytes),
    prepared: definition.prepared,
    published: definition.published,
    preparedBytes: outputBytes.length,
    preparedSha256: hash(outputBytes),
    clips: root.listAnimations().map((animation) => ({
      name: animation.getName(),
      duration: Number(animationDuration(animation).toFixed(6)),
    })),
    joints: root.listSkins()[0].listJoints().length,
    dielectricMaterials,
    triangles: triangleCount(document),
    sourceAsset: sourceMetadata,
  });
  console.log(
    `${definition.id}: ${(inputBytes.length / 1048576).toFixed(2)} MiB -> `
    + `${(outputBytes.length / 1048576).toFixed(2)} MiB, `
    + `${root.listAnimations().length} clips, ${triangleCount(document)} triangles`,
  );
}

fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
