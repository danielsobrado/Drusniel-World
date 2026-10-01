/**
 * Canonical runtime sources for grass-test's meadow trees, tree1–tree9.
 *
 * The donor generated them (`scripts/generate-fantasy-assets.mjs`) from its
 * project trees: curved trunks, flared bases and merged roots, painted bark and
 * alpha-cut leaf cards in three families — gold (1–3), pale (4–6) and green
 * (7–9). What they inherit that this project cannot publish as-is:
 *
 *   1. A baked billboard (`TreeN_Low` holding the `TreeN_Billboard` card and its
 *      atlas). This project bakes its own impostors; it is removed.
 *   2. `KHR_texture_transform` on the bark (trees 4–9 repeat it 5× up the trunk).
 *      The runtime's authored texture nodes sample plain UVs, so the transform is
 *      baked into TEXCOORD_0 and the extension dropped.
 *   3. Per-tree material names (`branches.014`, `leaves.001`, …). They become
 *      "Meadow bark" and "Meadow leaves", so every variant names the same pair.
 *   4. Branch meshes of 6–13 k triangles (roots included) are decimated, and the
 *      2–11 k triangles of leaf cards are thinned: whole cards are dropped, never
 *      simplified — simplifying an alpha-cut card collapses it — and the
 *      survivors grow about their own centres to keep the crown as full.
 *
 * Idempotent: it always reads the unchanged donor files. Like the alpine
 * preparer it needs the optional `draco3dgltf` decoder.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureTransform } from '@gltf-transform/extensions';
import { dedup, prune, simplifyPrimitive, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { readGlbJson, renderedTriangleCount } from './lib/glb-inspection.mjs';
import {
  BILLBOARD_MATERIAL,
  DRACO_EXTENSION,
  assertEmbeddedTextures,
  createSourceIo,
  dropDegenerateTriangles,
  replaceFileAtomically,
  sceneBounds,
  stripBillboard,
  triangleCount,
} from './lib/donor-tree-prepare.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const donorDirectory = process.env.MEADOW_TREE_DONOR_DIR
  ?? 'F:/Development/grass-test/public/Assets/terrain/fantasy';
const outputDirectory = 'assets/runtime-sources/trees/meadow';
export const MEADOW_BARK = 'Meadow bark';
export const MEADOW_LEAVES = 'Meadow leaves';
/** Branches and roots after decimation. */
const BRANCH_TRIANGLES = 2000;
/**
 * Leaf triangles after thinning. Measured: the whole cards (up to 10 900
 * triangles a tree) cost the spawn a third of its frame rate across the near
 * ring (chunk-cross 40 vs 60 fps).
 */
const LEAF_TRIANGLES = 3000;
/** The most a surviving card is enlarged to cover for the ones dropped. */
const MAX_CARD_GROWTH = 1.6;
const SIMPLIFY_ERROR = 0.02;

const MEADOW_TREES = Object.freeze(
  Array.from({ length: 9 }, (_, index) => `tree${index + 1}`),
);

/** Whole-material classification: the donor's leaf cards are alpha-masked. */
function isLeafMaterial(material) {
  return material.getAlphaMode() === 'MASK';
}

/**
 * Bakes a KHR_texture_transform into the UVs it applies to. The accessor is
 * cloned first: branch and leaf primitives may share one.
 */
function bakeTextureTransforms(document) {
  let baked = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const info = primitive.getMaterial()?.getBaseColorTextureInfo();
      const transform = info?.getExtension('KHR_texture_transform');
      if (!transform) continue;
      const uv = primitive.getAttribute(`TEXCOORD_${transform.getTexCoord() ?? info.getTexCoord()}`)
        ?? primitive.getAttribute('TEXCOORD_0');
      if (!uv) continue;
      const [scaleU, scaleV] = transform.getScale();
      const [offsetU, offsetV] = transform.getOffset();
      const rotation = transform.getRotation();
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      const clone = uv.clone();
      const element = [0, 0];
      for (let index = 0; index < clone.getCount(); index += 1) {
        clone.getElement(index, element);
        const u = element[0] * scaleU;
        const v = element[1] * scaleV;
        clone.setElement(index, [cos * u + sin * v + offsetU, -sin * u + cos * v + offsetV]);
      }
      primitive.setAttribute('TEXCOORD_0', clone);
      baked += 1;
    }
  }
  for (const material of document.getRoot().listMaterials()) {
    material.getBaseColorTextureInfo()?.setExtension('KHR_texture_transform', null);
  }
  for (const extension of document.getRoot().listExtensionsUsed()) {
    if (extension.extensionName === KHRTextureTransform.EXTENSION_NAME) extension.dispose();
  }
  return baked;
}

function renameMaterials(document) {
  const materials = document.getRoot().listMaterials();
  const leaves = materials.filter(isLeafMaterial);
  const bark = materials.filter((material) => !isLeafMaterial(material));
  if (leaves.length !== 1 || bark.length !== 1) {
    throw new Error(`expected one bark and one leaf material, found ${materials.map((m) => m.getName()).join(', ')}.`);
  }
  bark[0].setName(MEADOW_BARK);
  leaves[0].setName(MEADOW_LEAVES);
  return { bark: bark[0], leaves: leaves[0] };
}

function decimateBranches(document, bark) {
  let before = 0;
  let after = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      if (primitive.getMaterial() !== bark) continue;
      const triangles = Math.floor(primitive.getIndices().getCount() / 3);
      before += triangles;
      if (triangles > BRANCH_TRIANGLES) {
        simplifyPrimitive(primitive, {
          simplifier: MeshoptSimplifier,
          ratio: BRANCH_TRIANGLES / triangles,
          error: SIMPLIFY_ERROR,
          lockBorder: true,
        });
      }
      after += Math.floor(primitive.getIndices().getCount() / 3);
    }
  }
  return { before, after };
}

/** Stable pseudo-random order for cards, so reruns keep the same ones. */
function cardRank(index) {
  let value = Math.imul(index + 1, 2654435761);
  value ^= value >>> 13;
  value = Math.imul(value, 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

/** Leaf cards as lists of triangle offsets: after `weld` no two cards share a vertex. */
function leafCards(index, vertexCount) {
  const parent = Int32Array.from({ length: vertexCount }, (_, i) => i);
  const find = (vertex) => {
    let root = vertex;
    while (parent[root] !== root) {
      parent[root] = parent[parent[root]];
      root = parent[root];
    }
    return root;
  };
  for (let t = 0; t < index.length; t += 3) {
    const a = find(index[t]);
    parent[find(index[t + 1])] = a;
    parent[find(index[t + 2])] = find(a);
  }
  const cards = new Map();
  for (let t = 0; t < index.length; t += 3) {
    const root = find(index[t]);
    if (!cards.has(root)) cards.set(root, []);
    cards.get(root).push(t);
  }
  return [...cards.values()];
}

/** Grows a card about its centroid. */
function growCard(position, index, triangles, growth) {
  const vertices = new Set();
  for (const t of triangles) vertices.add(index[t]).add(index[t + 1]).add(index[t + 2]);
  const point = [0, 0, 0];
  const centre = [0, 0, 0];
  for (const vertex of vertices) {
    position.getElement(vertex, point);
    for (let axis = 0; axis < 3; axis += 1) centre[axis] += point[axis] / vertices.size;
  }
  for (const vertex of vertices) {
    position.getElement(vertex, point);
    position.setElement(vertex, point.map((value, axis) => centre[axis] + (value - centre[axis]) * growth));
  }
}

/** Drops whole leaf cards down to LEAF_TRIANGLES; see the header, step 4. */
function thinLeafCards(document, leaves) {
  let before = 0;
  let after = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      if (primitive.getMaterial() !== leaves) continue;
      const indices = primitive.getIndices();
      const index = indices.getArray();
      const triangles = index.length / 3;
      before += triangles;
      if (triangles <= LEAF_TRIANGLES) {
        after += triangles;
        continue;
      }
      const position = primitive.getAttribute('POSITION');
      const ordered = leafCards(index, position.getCount())
        .map((list, order) => ({ list, rank: cardRank(order) }))
        .sort((left, right) => left.rank - right.rank);
      const kept = [];
      let keptTriangles = 0;
      for (const card of ordered) {
        if (keptTriangles > 0 && keptTriangles + card.list.length > LEAF_TRIANGLES) continue;
        kept.push(card.list);
        keptTriangles += card.list.length;
      }
      const growth = Math.min(MAX_CARD_GROWTH, Math.sqrt(triangles / keptTriangles));
      const keptIndex = [];
      for (const list of kept) {
        growCard(position, index, list, growth);
        for (const t of list) keptIndex.push(index[t], index[t + 1], index[t + 2]);
      }
      indices.setArray(new index.constructor(keptIndex));
      after += keptIndex.length / 3;
    }
  }
  return { before, after };
}

async function prepareTree(id) {
  const donorPath = path.join(donorDirectory, `${id}.glb`);
  let stage = 'read';
  try {
    const inputBytes = fs.readFileSync(donorPath);
    const donorTriangles = renderedTriangleCount(readGlbJson(inputBytes, `${id}.glb`));
    const io = await createSourceIo(inputBytes, `${id}.glb`);
    const document = await io.read(donorPath);
    const root = document.getRoot();
    for (const extension of root.listExtensionsUsed()) {
      if (extension.extensionName === DRACO_EXTENSION) extension.dispose();
    }

    stage = 'strip billboards';
    const removedNodes = stripBillboard(document);
    await document.transform(prune());

    stage = 'bake texture transforms';
    const bakedTransforms = bakeTextureTransforms(document);

    stage = 'rename materials';
    const { bark, leaves } = renameMaterials(document);

    stage = 'decimate branches';
    await document.transform(weld());
    const branches = decimateBranches(document, bark);

    stage = 'thin leaf cards';
    const leafThinning = thinLeafCards(document, leaves);

    stage = 'clean';
    const degenerateRemoved = dropDegenerateTriangles(document);
    await document.transform(weld(), dedup(), prune());

    stage = 'validate';
    const materials = root.listMaterials().map((material) => material.getName()).sort();
    if (materials.some((name) => BILLBOARD_MATERIAL.test(name))) {
      throw new Error('a billboard material survived billboard removal.');
    }
    if (materials.join('|') !== [MEADOW_BARK, MEADOW_LEAVES].sort().join('|')) {
      throw new Error(`expected exactly bark + leaves, found ${materials.join(', ')}.`);
    }
    assertEmbeddedTextures(document, id);

    root.getAsset().generator = 'SimCity-DnD meadow tree asset preparer';
    root.getAsset().extras = {
      preparedFrom: donorPath.replaceAll('\\', '/'),
      runtimeAsset: id,
      preparer: 'scripts/prepare-meadow-tree-assets.mjs',
      branchDecimation: branches,
      leafThinning,
    };

    stage = 'write';
    const outputBytes = await new NodeIO().registerExtensions(ALL_EXTENSIONS).writeBinary(document);
    const outputTriangles = renderedTriangleCount(readGlbJson(Buffer.from(outputBytes), id));
    if (outputTriangles !== triangleCount(document)) {
      throw new Error(`written triangle count ${outputTriangles} does not match ${triangleCount(document)}.`);
    }
    return {
      id,
      outputBytes,
      relativeOutput: `${outputDirectory}/${id}.glb`,
      donorTriangles,
      outputTriangles,
      branches,
      leafThinning,
      removedNodes,
      bakedTransforms,
      degenerateRemoved,
      bounds: sceneBounds(document),
    };
  } catch (error) {
    throw new Error(`${id}.glb: ${stage} failed: ${error.message}`);
  }
}

await MeshoptSimplifier.ready;
// Prepare every tree before writing any, so a failure leaves the sources intact.
const prepared = [];
for (const id of MEADOW_TREES) prepared.push(await prepareTree(id));
for (const record of prepared) {
  replaceFileAtomically(record.outputBytes, path.join(rootDir, record.relativeOutput));
}
for (const record of prepared) {
  const height = record.bounds.max[1] - record.bounds.min[1];
  console.log(
    `${record.id}: ${record.donorTriangles} -> ${record.outputTriangles} triangles | `
    + `branches ${record.branches.before} -> ${record.branches.after} | `
    + `leaves ${record.leafThinning.before} -> ${record.leafThinning.after} | `
    + `stripped [${record.removedNodes.join(', ')}] | uv transforms baked ${record.bakedTransforms} | `
    + `${record.degenerateRemoved} degenerate removed | height ${height.toFixed(2)} donor units | `
    + `${(record.outputBytes.length / 1024).toFixed(1)} KiB`,
  );
}
console.log(`prepared ${prepared.length} meadow tree sources`);
