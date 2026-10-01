import * as THREE from 'three/webgpu';
import { MasonryVertexWriter } from './MasonryVertexWriter.js';
import { planWallGrowth } from '../masonry/WallGrowth.js';
import { CONSTRUCTION_MATERIAL_SLOT } from '../render/ConstructionMaterialSlots.js';

/** A single batched leaf mesh per occupied module; no textures or update loop. */
export function buildConstructionGrowth({ record, materials, arcTable, moduleOrigin, groundHeightAt, pathInterval }) {
  if (!materials.growth) return null;
  const leaves = planWallGrowth(record, arcTable, pathInterval);
  if (!leaves.length) return null;
  const writer = new MasonryVertexWriter({ vertices: leaves.length * 5, indices: leaves.length * 12 });
  const color = new THREE.Color();
  for (const leaf of leaves) {
    if (leaf.stem) {
      const { from, to } = leaf.stem;
      const length = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1;
      const dx = -(to[1] - from[1]) / length * 0.008;
      const dy = (to[0] - from[0]) / length * 0.008;
      const start = writer.vertexCount;
      writer.reserve(4, 6);
      color.set('#687148');
      for (const [point, sign] of [[from, -1], [to, -1], [to, 1], [from, 1]]) {
        const frame = arcTable.frameAt(point[0] + dx * sign);
        const outward = leaf.side * (record.dimensions.thickness / 2 + leaf.outward - 0.01);
        const worldX = frame.x + frame.normalX * outward;
        const worldZ = frame.z + frame.normalZ * outward;
        const height = leaf.stem.rooted && point === from
          ? groundHeightAt(worldX, worldZ) + 0.005
          : Math.max(0.005, point[1] + dy * sign) + groundHeightAt(frame.x, frame.z);
        writer.vertex(worldX - moduleOrigin.x, height, worldZ - moduleOrigin.z,
          frame.normalX * leaf.side, 0, frame.normalZ * leaf.side,
          color.r, color.g, color.b, 0, 0);
      }
      writer.triangle(start, start + 1, start + 2); writer.triangle(start, start + 2, start + 3);
    }
    color.set(leaf.color);
    const start = writer.vertexCount;
    writer.reserve(5, 12);
    const c = Math.cos(leaf.angle); const s = Math.sin(leaf.angle);
    const r = leaf.radius;
    for (const [x, y, fold] of [[0, 0, 0.018], [0, r, 0], [-r * 0.7, 0, 0], [0, -r, 0], [r * 0.7, 0, 0]]) {
      const dx = x * c - y * s;
      const dy = x * s + y * c;
      const frame = arcTable.frameAt(leaf.s + dx);
      const outward = leaf.side * (record.dimensions.thickness / 2 + leaf.outward + fold);
      const nx = frame.normalX * leaf.side; const nz = frame.normalZ * leaf.side;
      const shade = fold ? 1.06 : 0.94;
      writer.vertex(frame.x + frame.normalX * outward - moduleOrigin.x,
        Math.max(0.015, leaf.y + dy) + groundHeightAt(frame.x, frame.z),
        frame.z + frame.normalZ * outward - moduleOrigin.z,
        nx, 0.15, nz, color.r * shade, color.g * shade, color.b * shade, x / r * 0.5 + 0.5, y / r * 0.5 + 0.5);
    }
    for (let i = 0; i < 4; i += 1) writer.triangle(start, start + 1 + i, start + 1 + (i + 1) % 4);
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
  mesh.receiveShadow = true;
  return mesh;
}
