/**
 * Shared steps for turning grass-test's generated trees into canonical runtime
 * sources: decode the donor (Draco, once), strip the billboard impostor it
 * carries — this project bakes its own — clean the geometry so the runtime
 * optimizer has nothing left to drop, and write every output atomically.
 *
 * Used by prepare-alpine-tree-assets.mjs and prepare-meadow-tree-assets.mjs.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';

export const DRACO_EXTENSION = 'KHR_draco_mesh_compression';
/** The donor's baked billboard: `Tree1_Billboard`, `Tree7_Billboard`, … */
export const BILLBOARD_MATERIAL = /_Billboard$/;

export function hash(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export function glbExtensionsUsed(bytes) {
  const jsonLength = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8')).extensionsUsed ?? [];
}

export async function createSourceIo(inputBytes, inputPath) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  if (!glbExtensionsUsed(inputBytes).includes(DRACO_EXTENSION)) return io;
  let draco3d;
  try {
    draco3d = (await import('draco3dgltf')).default;
  } catch {
    throw new Error(
      `${inputPath} uses ${DRACO_EXTENSION}. Install the optional decoder `
      + '(`npm install draco3dgltf`) so the donor can be decoded once into an '
      + 'uncompressed canonical source.',
    );
  }
  return io.registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() });
}

export function triangleCount(document) {
  let triangles = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const count = primitive.getIndices()?.getCount()
        ?? primitive.getAttribute('POSITION')?.getCount()
        ?? 0;
      const mode = primitive.getMode();
      if (mode === 4) triangles += Math.floor(count / 3);
      else if (mode === 5 || mode === 6) triangles += Math.max(0, count - 2);
    }
  }
  return triangles;
}

export function primitiveTriangles(primitive) {
  return Math.floor(
    (primitive.getIndices()?.getCount() ?? primitive.getAttribute('POSITION').getCount()) / 3,
  );
}

export function primitiveVertices(primitive) {
  return primitive.getAttribute('POSITION')?.getCount() ?? 0;
}

export function sceneBounds(document) {
  // `getDefaultScene` is on the root, not the document: `io.read` hands back a
  // Document and the scene accessors live on `getRoot()`.
  const root = document.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  const bounds = getBounds(scene);
  return {
    min: [...bounds.min].map((value) => Number(value.toFixed(6))),
    max: [...bounds.max].map((value) => Number(value.toFixed(6))),
  };
}

export function boundsDelta(before, after) {
  return Math.max(
    ...before.min.map((value, axis) => Math.abs(value - after.min[axis])),
    ...before.max.map((value, axis) => Math.abs(value - after.max[axis])),
  );
}

/**
 * Removes degenerate triangles — repeated index or zero area — so the authored
 * count equals the count gltfpack would emit. Mirrors the tropical preparer.
 */
export function dropDegenerateTriangles(document) {
  let removed = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      if (primitive.getMode() !== 4) continue;
      const position = primitive.getAttribute('POSITION');
      if (!position) continue;
      const indices = primitive.getIndices();
      const vertexCountValue = position.getCount();
      const source = indices ? indices.getArray() : null;
      const indexCount = indices ? indices.getCount() : vertexCountValue;
      const at = (index) => (source ? source[index] : index);
      const positions = [];
      for (let index = 0; index < vertexCountValue; index += 1) {
        positions.push(position.getElement(index, []));
      }
      const kept = [];
      for (let triangle = 0; triangle < indexCount; triangle += 3) {
        const a = at(triangle);
        const b = at(triangle + 1);
        const c = at(triangle + 2);
        if (a === b || b === c || a === c) {
          removed += 1;
          continue;
        }
        const pa = positions[a];
        const pb = positions[b];
        const pc = positions[c];
        const ux = pb[0] - pa[0];
        const uy = pb[1] - pa[1];
        const uz = pb[2] - pa[2];
        const vx = pc[0] - pa[0];
        const vy = pc[1] - pa[1];
        const vz = pc[2] - pa[2];
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        if (nx === 0 && ny === 0 && nz === 0) {
          removed += 1;
          continue;
        }
        kept.push(a, b, c);
      }
      if (kept.length === indexCount) continue;
      if (kept.length === 0) {
        throw new Error(`every triangle of ${primitive.getMaterial()?.getName()} is degenerate.`);
      }
      const componentType = indices?.getComponentType() ?? 5125;
      const ArrayType = componentType === 5125
        ? Uint32Array
        : (componentType === 5123 ? Uint16Array : Uint8Array);
      const accessor = indices ?? document.createAccessor();
      accessor.setType('SCALAR');
      accessor.setArray(new ArrayType(kept));
      if (!indices) primitive.setIndices(accessor);
    }
  }
  return removed;
}

export function assertEmbeddedTextures(document, label) {
  for (const texture of document.getRoot().listTextures()) {
    if (texture.getImage() == null) {
      throw new Error(
        `${label}: texture "${texture.getName() || texture.getURI()}" has no embedded image; `
        + 'the donor\'s external texture could not be resolved.',
      );
    }
  }
}

/** 1. Strips the inherited billboard nodes and everything only they use. */
export function stripBillboard(document) {
  const root = document.getRoot();
  const billboardMeshes = new Set(root.listMeshes().filter((mesh) => {
    const primitives = mesh.listPrimitives();
    return primitives.length > 0
      && primitives.every((primitive) => BILLBOARD_MATERIAL.test(primitive.getMaterial()?.getName() ?? ''));
  }));
  const removedNodes = [];
  const parentsLeftEmpty = new Set();
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh || !billboardMeshes.has(mesh)) continue;
    for (const parent of node.listParents()) {
      if (parent.propertyType === 'Node') parentsLeftEmpty.add(parent);
    }
    removedNodes.push(node.getName() || '(unnamed)');
    node.dispose();
  }
  for (const node of root.listNodes()) {
    if (node.getMesh() || node.listChildren().length > 0) continue;
    if (parentsLeftEmpty.has(node) || /(_low|_lod\d*)$/i.test(node.getName())) {
      removedNodes.push(node.getName() || '(unnamed)');
      node.dispose();
    }
  }
  return removedNodes;
}

export function replaceFileAtomically(bytes, targetPath) {
  const temporaryPath = `${targetPath}.prepare-${process.pid}.tmp`;
  const displacedPath = `${targetPath}.prepare-${process.pid}.previous`;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(temporaryPath, bytes);
  const displaced = fs.existsSync(targetPath);
  try {
    if (displaced) fs.renameSync(targetPath, displacedPath);
    fs.renameSync(temporaryPath, targetPath);
    fs.rmSync(displacedPath, { force: true });
  } catch (error) {
    if (displaced && fs.existsSync(displacedPath) && !fs.existsSync(targetPath)) {
      fs.renameSync(displacedPath, targetPath);
    }
    throw error;
  } finally {
    fs.rmSync(temporaryPath, { force: true });
    fs.rmSync(displacedPath, { force: true });
  }
}
