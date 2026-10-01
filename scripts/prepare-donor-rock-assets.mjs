/**
 * Canonical runtime source for grass-test's stones: `fantasy/rocks.glb`, its
 * eleven `SM_Rocks_NN` stylized stones (variants 10 and 11 are the donor's
 * repainted 06 and 07) under one painted-stone material.
 *
 * The donor file is Draco-compressed and points at its texture outside itself
 * (`../../textures/shared/painted-foundation-stone-*.png`). This decodes the
 * geometry once and embeds the texture, so the runtime optimizer can publish it
 * like any other rock variant; nothing else about the stones changes.
 *
 * Needs the optional `draco3dgltf` decoder, like the tree preparers.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import { readGlbJson, renderedTriangleCount } from './lib/glb-inspection.mjs';
import {
  DRACO_EXTENSION,
  assertEmbeddedTextures,
  createSourceIo,
  replaceFileAtomically,
  sceneBounds,
} from './lib/donor-tree-prepare.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const donorPath = process.env.DONOR_ROCKS_GLB
  ?? 'F:/Development/grass-test/public/Assets/terrain/fantasy/rocks.glb';
const output = 'assets/runtime-sources/rocks/donor/rocks.glb';

const inputBytes = fs.readFileSync(donorPath);
const donorTriangles = renderedTriangleCount(readGlbJson(inputBytes, 'rocks.glb'));
const io = await createSourceIo(inputBytes, 'rocks.glb');
const document = await io.read(donorPath);
const root = document.getRoot();
for (const extension of root.listExtensionsUsed()) {
  if (extension.extensionName === DRACO_EXTENSION) extension.dispose();
}
// No `dedup`: merging accessors the stones happen to share would make the source
// smaller than gltfpack's per-mesh output, which the optimizer rejects as growth.
await document.transform(prune());
// Embed the external texture: the image data is already loaded; clearing the
// URI makes the binary writer store it in the GLB.
for (const texture of root.listTextures()) texture.setURI('');
assertEmbeddedTextures(document, output);
const stones = root.listNodes().filter((node) => /^SM_Rocks_\d+$/.test(node.getName()));
if (stones.length !== 11) throw new Error(`expected 11 SM_Rocks stones, found ${stones.length}.`);

root.getAsset().generator = 'SimCity-DnD donor rock asset preparer';
root.getAsset().extras = {
  preparedFrom: donorPath.replaceAll('\\', '/'),
  preparer: 'scripts/prepare-donor-rock-assets.mjs',
};
const outputBytes = await new NodeIO().registerExtensions(ALL_EXTENSIONS).writeBinary(document);
const outputTriangles = renderedTriangleCount(readGlbJson(Buffer.from(outputBytes), output));
if (outputTriangles !== donorTriangles) {
  throw new Error(`triangle count changed ${donorTriangles} -> ${outputTriangles}.`);
}
replaceFileAtomically(outputBytes, path.join(rootDir, output));
const bounds = sceneBounds(document);
console.log(
  `rocks.glb: ${stones.length} stones, ${outputTriangles} triangles, `
  + `${(outputBytes.length / 1024).toFixed(1)} KiB, bounds [${bounds.min.join(', ')}] .. [${bounds.max.join(', ')}]`,
);
