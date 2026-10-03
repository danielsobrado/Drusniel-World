import * as THREE from 'three/webgpu';
import { hash2d } from '/src/editor/stylized/meadow/meadowGrassGeometry.js';
import { MasonryVertexWriter } from '/src/editor/construction/compile/MasonryVertexWriter.js';
import { writeGroundDetail } from '/src/editor/construction/compile/ConstructionGroundDetailMesher.js';

/** Sparse clustered accents, using the wall's production ground-detail mesher. */
export function addGardenFlowers(scene, { wallDistance, groundHeightAt, path }) {
  const writer = new MasonryVertexWriter();
  const color = new THREE.Color();
  let count = 0;
  for (let i = 0; i < 900; i += 1) {
    const x = hash2d(i, 91) * 24 - 12, z = hash2d(i, 113) * 24 - 12;
    if (wallDistance(x, z) < 0.25) continue;
    if (path && z > -2 && z < 13 && Math.abs(x - path.center[0]) < path.radius + 0.3) continue;
    const patch = Math.sin(x * 0.55 + 1.2) * Math.sin(z * 0.43);
    if (patch < 0.15 || hash2d(i, 71) > 0.7) continue;
    writeGroundDetail(writer, {
      s: 0, side: 1, offset: 0, angle: hash2d(i, 37) * Math.PI * 2,
      height: 0.48 + hash2d(i, 53) * 0.2, color: '#758746', flower: true,
    }, {
      arcTable: { frameAt: () => ({ x, z, normalX: 1, normalZ: 0 }) },
      moduleOrigin: { x: 0, z: 0 }, groundHeightAt, color,
    });
    count += 1;
  }
  const arrays = writer.toArrays();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(arrays.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(arrays.normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(arrays.colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(arrays.indices, 1));
  const material = new THREE.MeshLambertNodeMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  scene.add(mesh);
  return { count, triangles: arrays.indices.length / 3, dispose: () => material.dispose() };
}
