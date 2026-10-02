import * as THREE from 'three/webgpu';
import { MasonryVertexWriter } from './MasonryVertexWriter.js';
import { planWallGrowth } from '../masonry/WallGrowth.js';
import { CONSTRUCTION_MATERIAL_SLOT } from '../render/ConstructionMaterialSlots.js';
import { createGrowthSurfaceSampler } from './ConstructionGrowthSurface.js';
import { writeIvyLeaf, writeIvyStem } from './ConstructionIvyMesher.js';

/** A single batched leaf mesh per occupied module; no textures or update loop. */
export function buildConstructionGrowth({ record, materials, arcTable, moduleOrigin, groundHeightAt, pathInterval, placements, lodBand = 'near' }) {
  if (!materials.growth) return null;
  const leaves = planWallGrowth(record, arcTable, pathInterval);
  if (!leaves.length) return null;
  const writer = new MasonryVertexWriter({ vertices: leaves.length * 60, indices: leaves.length * 90 });
  const faceAt = createGrowthSurfaceSampler({ record, placements, arcTable });
  const color = new THREE.Color();
  for (const leaf of leaves) {
    const surface = faceAt(leaf.s, leaf.y, leaf.radius, leaf.side);
    const pointAt = (s, y, outward, rooted = false, face = surface) => {
      const frame = arcTable.frameAt(s);
      const offset = leaf.side * (face + outward);
      const x = frame.x + frame.normalX * offset; const z = frame.z + frame.normalZ * offset;
      return [x - moduleOrigin.x, rooted ? groundHeightAt(x, z) + 0.005
        : Math.max(0.015, y) + groundHeightAt(frame.x, frame.z), z - moduleOrigin.z];
    };
    if (leaf.stem) {
      color.set('#657143');
      writeIvyStem(writer, leaf.stem, (s, y, outward, rooted) => pointAt(s, y, outward, rooted,
        faceAt(s, y, 0.012, leaf.side)), color);
    }
    color.set('#71804a');
    const { from, to } = leaf.petiole;
    const ds = to[0] - from[0]; const dy = to[1] - from[1];
    const distanceSquared = ds * ds + dy * dy || 1;
    const startFace = faceAt(from[0], from[1], 0.012, leaf.side) + 0.014;
    const endFace = surface + leaf.outward + leaf.fold;
    writeIvyStem(writer, leaf.petiole, (s, y, outward) => {
      const t = Math.max(0, Math.min(1, ((s - from[0]) * ds + (y - from[1]) * dy) / distanceSquared));
      return pointAt(s, y, outward, false, startFace + (endFace - startFace) * t);
    }, color, { radius: 0.004, outward: 0 });
    color.set(leaf.color);
    writeIvyLeaf(writer, leaf, pointAt, color);
  }
  const arrays = writer.toArrays();
  const geometry = new THREE.BufferGeometry();
  for (const [name, values, size] of [['position', arrays.positions, 3], ['normal', arrays.normals, 3],
    ['color', arrays.colors, 3], ['uv', arrays.uvs, 2]]) geometry.setAttribute(name, new THREE.BufferAttribute(values, size));
  geometry.setIndex(new THREE.BufferAttribute(arrays.indices, 1));
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, materials.growth);
  mesh.userData.constructionMaterialSlot = CONSTRUCTION_MATERIAL_SLOT.GROWTH;
  mesh.userData.constructionGrowthLeaves = leaves.length;
  mesh.castShadow = lodBand !== 'coarse'; mesh.receiveShadow = true;
  return mesh;
}
