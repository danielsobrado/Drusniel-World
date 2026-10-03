/**
 * Rounded outlines of one convex stone face, for the pillow-stone mesher.
 *
 * Each corner's arc centre is inset by its radius along both adjacent edges.
 * At inset `t`, its arc has radius `cornerRadius − t`. Different corner radii
 * share the same edge offset, so their connecting strips stay tangent.
 * That is a rounded rectangle for a rectangular stone and a rounded
 * parallelogram for a leaning lattice stone, and every ring has the same point
 * count, so consecutive rings stitch into bands with no topology change. The
 * outward normal of a ring point is simply its arc direction.
 *
 * Pure math, Three.js-free.
 */

const EPSILON = 1e-9;

function signedArea(ring) {
  let total = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [x0, y0] = ring[index];
    const [x1, y1] = ring[(index + 1) % ring.length];
    total += x0 * y1 - x1 * y0;
  }
  return total / 2;
}

/**
 * Counter-clockwise copy of a strictly convex quad, or null.
 *
 * Lattice faces are convex by construction (`CourseLattice`), and box stones
 * are rectangles or parallelograms, but a degenerate or folded quad is rejected
 * here so the caller can fall back rather than mesh inside out.
 */
export function normalizeConvexQuad(corners) {
  if (!Array.isArray(corners) || corners.length !== 4) return null;
  const ring = corners.map((corner) => [corner[0], corner[1]]);
  if (!ring.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))) return null;
  if (signedArea(ring) < 0) ring.reverse();
  for (let index = 0; index < 4; index += 1) {
    const [ax, ay] = ring[index];
    const [bx, by] = ring[(index + 1) % 4];
    const [cx, cy] = ring[(index + 2) % 4];
    const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    if (!(cross > EPSILON)) return null;
  }
  return ring;
}

/** Outward unit normals of a counter-clockwise ring's edges, or null. */
function edgeNormals(ring) {
  const normals = [];
  for (let index = 0; index < ring.length; index += 1) {
    const [x0, y0] = ring[index];
    const [x1, y1] = ring[(index + 1) % ring.length];
    const length = Math.hypot(x1 - x0, y1 - y0);
    if (!(length > EPSILON)) return null;
    normals.push([(y1 - y0) / length, -(x1 - x0) / length]);
  }
  return normals;
}

/**
 * The quad with every edge moved inward by `distance`, or null once an edge
 * would flip — the inset has swallowed the stone.
 */
function insetQuad(ring, normals, radii) {
  const core = [];
  for (let index = 0; index < 4; index += 1) {
    const before = normals[(index + 3) % 4];
    const after = normals[index];
    const [x, y] = ring[index];
    const distance = radii[index];
    const lineBefore = before[0] * x + before[1] * y - distance;
    const lineAfter = after[0] * x + after[1] * y - distance;
    const determinant = before[0] * after[1] - before[1] * after[0];
    if (!(determinant > EPSILON)) return null;
    core.push([
      (lineBefore * after[1] - lineAfter * before[1]) / determinant,
      (before[0] * lineAfter - after[0] * lineBefore) / determinant,
    ]);
  }
  for (let index = 0; index < 4; index += 1) {
    const [ax, ay] = core[index];
    const [bx, by] = core[(index + 1) % 4];
    const [ox, oy] = ring[index];
    const [px, py] = ring[(index + 1) % 4];
    if (!((bx - ax) * (px - ox) + (by - ay) * (py - oy) > EPSILON)) return null;
  }
  return core;
}

/** Four corner arcs (or one sample per corner), plus optional edge midpoints. */
export function outlinePointCount(arcSegments, edgeSegments = 1) {
  return 4 * (arcSegments + edgeSegments);
}

/**
 * Build the rounded-outline sampler for one face quad.
 *
 * @param ring counter-clockwise convex quad from `normalizeConvexQuad`
 * @param cornerRadius default in-plane corner radius
 * @param arcSegments segments per quarter-ish corner arc; 0 keeps the solved
 *   quad's corners with bisector normals for a four-corner distant bevel
 * @param cornerRadii optional four radii; their minimum is the deepest valid inset
 * @param edgeSegments 1 for straight edges, 2 to sample wear at their midpoints
 * @returns null when the corner radius does not fit the quad
 */
export function createRoundedOutline(ring, cornerRadius, arcSegments, cornerRadii = null, edgeSegments = 1) {
  if (!(cornerRadius > 0) || !(arcSegments >= 0) || !Number.isInteger(arcSegments)) return null;
  const radii = cornerRadii ?? [cornerRadius, cornerRadius, cornerRadius, cornerRadius];
  if (radii.length !== 4 || !radii.every(radius => Number.isFinite(radius) && radius > 0)) return null;
  const normals = edgeNormals(ring);
  if (!normals) return null;
  const core = insetQuad(ring, normals, radii);
  if (!core) return null;

  const pointCount = outlinePointCount(arcSegments, edgeSegments);
  const directionX = new Float64Array(pointCount);
  const directionY = new Float64Array(pointCount);
  const coreX = new Float64Array(pointCount);
  const coreY = new Float64Array(pointCount);
  const radiusAt = new Float64Array(pointCount);
  const wearIndex = new Uint8Array(pointCount);
  let point = 0;
  for (let corner = 0; corner < 4; corner += 1) {
    const before = normals[(corner + 3) % 4];
    const after = normals[corner];
    const start = Math.atan2(before[1], before[0]);
    let sweep = Math.atan2(after[1], after[0]) - start;
    while (sweep <= 0) sweep += Math.PI * 2;
    for (let step = 0; step <= arcSegments; step += 1) {
      const angle = start + sweep * (arcSegments === 0 ? 0.5 : step / arcSegments);
      directionX[point] = Math.cos(angle);
      directionY[point] = Math.sin(angle);
      // A four-point distant outline must retain the solved silhouette.
      // Sampling only the arc bisectors moved every edge inward; beside a
      // sloping bed that could expose backing across a whole narrow stone.
      coreX[point] = arcSegments === 0 ? ring[corner][0] - radii[corner] * directionX[point] : core[corner][0];
      coreY[point] = arcSegments === 0 ? ring[corner][1] - radii[corner] * directionY[point] : core[corner][1];
      radiusAt[point] = radii[corner];
      wearIndex[point] = corner * 2;
      point += 1;
    }
    // The midpoint is collinear on the packed silhouette. Its independently
    // inset bevel makes the face edge uneven without opening the bed joint.
    const next = (corner + 1) % 4;
    for (let step = 1; step < edgeSegments; step += 1) {
      const t = step / edgeSegments;
      directionX[point] = after[0];
      directionY[point] = after[1];
      coreX[point] = core[corner][0] * (1 - t) + core[next][0] * t;
      coreY[point] = core[corner][1] * (1 - t) + core[next][1] * t;
      radiusAt[point] = radii[corner] * (1 - t) + radii[next] * t;
      wearIndex[point] = corner * 2 + 1;
      point += 1;
    }
  }

  let centroidX = 0;
  let centroidY = 0;
  for (const [x, y] of core) {
    centroidX += x / 4;
    centroidY += y / 4;
  }

  return Object.freeze({
    pointCount,
    cornerRadius: Math.min(...radii),
    insetLimit: (index) => radiusAt[index],
    wearIndex: (index) => wearIndex[index],
    centroid: Object.freeze([centroidX, centroidY]),
    /** Outward unit normal of ring point `index` (the same at every inset). */
    normalX: (index) => directionX[index],
    normalY: (index) => directionY[index],
    /** Ring point `index` at inset `inset`, `0 <= inset <= cornerRadius`. */
    pointX: (index, inset) => coreX[index] + (radiusAt[index] - inset) * directionX[index],
    pointY: (index, inset) => coreY[index] + (radiusAt[index] - inset) * directionY[index],
  });
}
