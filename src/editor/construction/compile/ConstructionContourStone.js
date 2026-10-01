import * as THREE from 'three/webgpu';
import { createStoneVertexEmitter, eulerXYZMatrix } from './ConstructionPillowStoneMesher.js';
import { WORKSHOP_UV_DENSITY } from '../../workshop/ProceduralWorkshopGeometry.js';

/** Write a fitted polygon, including concave shoulders, into a module's batch. */
export function writeContourStone(writer, { polygons, depth, position, rotation, bevel = 0.006 }, {
  shade, drape = null, exposure = null,
}) {
  const shapes = polygons.map(([outer, ...holes]) => {
    const shape = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x, y)));
    shape.holes = holes.map(ring => new THREE.Path(ring.map(([x, y]) => new THREE.Vector2(x, y))));
    return shape;
  });
  if (!shapes.length) return { triangles: 0, vertices: 0 };
  const points = polygons.flat(2);
  const ys = points.map(point => point[1]);
  const xs = points.map(point => point[0]);
  const bounds = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  const edge = Math.min(bevel, depth * 0.1, (bounds.maxY - bounds.minY) * 0.08,
    (bounds.maxX - bounds.minX) * 0.08);
  // Negative offset keeps the outermost bevel inside the resolved footprint.
  const geometry = new THREE.ExtrudeGeometry(shapes, {
    depth: depth - edge * 2, steps: 1, curveSegments: 1,
    bevelEnabled: edge > 0, bevelSize: edge, bevelThickness: edge,
    bevelOffset: -edge, bevelSegments: 1,
  });
  const emit = createStoneVertexEmitter(writer, {
    matrix: eulerXYZMatrix(rotation), position, bounds, shade, drape,
    uvDensity: WORKSHOP_UV_DENSITY, exposure,
  });
  const start = writer.vertexCount;
  try {
    const p = geometry.attributes.position;
    const n = geometry.attributes.normal;
    writer.reserve(p.count, p.count);
    for (let i = 0; i < p.count; i += 1) {
      emit(p.getX(i), p.getY(i), p.getZ(i) - depth / 2 + edge,
        n.getX(i), n.getY(i), n.getZ(i), 0);
    }
    for (let i = 0; i < p.count; i += 3) writer.triangle(start + i, start + i + 1, start + i + 2);
    return { vertices: p.count, triangles: p.count / 3 };
  } finally { geometry.dispose(); }
}
