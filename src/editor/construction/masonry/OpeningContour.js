import polygonClipping from 'polygon-clipping';
import { OPENING_CLEARANCE, openingHalfWidthAt, openingVerticalSpan } from './OpeningLayout.js';

// The contour is shared by all detail tiers. Sampling error is below a mortar joint.
export const OPENING_CONTOUR_TOLERANCE = 0.001;

/** Right-hand boundary, from springing to crown, sampled from the canonical void. */
export function openingArchContour(opening, clearance = OPENING_CLEARANCE) {
  const { sill, crown } = openingVerticalSpan(opening);
  if (opening.profile === 'flat') return [[opening.s + opening.width / 2 + clearance, crown + clearance]];
  let low = sill;
  let high = crown;
  for (let i = 0; i < 40; i += 1) {
    const mid = (low + high) / 2;
    if (openingHalfWidthAt(opening, mid) >= opening.width / 2 - 1e-10) low = mid;
    else high = mid;
  }
  const point = y => [opening.s + openingHalfWidthAt(opening, y) + clearance, y];
  const result = [point(low)];
  const split = (a, b, depth) => {
    const mid = point((a[1] + b[1]) / 2);
    const dx = b[0] - a[0]; const dy = b[1] - a[1];
    const error = Math.abs(dx * (mid[1] - a[1]) - dy * (mid[0] - a[0])) / Math.hypot(dx, dy);
    if (depth < 16 && (error > OPENING_CONTOUR_TOLERANCE || Math.hypot(dx, dy) > 0.12)) {
      split(a, mid, depth + 1); split(mid, b, depth + 1);
    } else result.push(b);
  };
  split(result[0], point(crown), 0);
  return result;
}

/** Closed 2D void polygon in wall arc/height coordinates. */
export function openingVoidPolygon(opening, clearance = OPENING_CLEARANCE) {
  const right = openingArchContour(opening, clearance);
  const half = opening.width / 2 + clearance;
  const leftBase = [opening.s - half, opening.sill];
  return [[leftBase, [opening.s + half, opening.sill], ...right,
    ...right.slice().reverse().map(([s, y]) => [2 * opening.s - s, y]), leftBase]];
}

/** Resolve the material remaining in one logical cell, retaining holes and islands. */
export function fitOpeningContour(corners, s, y, voids) {
  const ring = corners.map(([x, height]) => [s + x, y + height]);
  const result = polygonClipping.difference([[...ring, ring[0]]], ...voids);
  return result.map(polygon => polygon.map(boundary => boundary.slice(0, -1)
    .map(([x, height]) => [x - s, height - y])))
    .filter(polygon => Math.abs(polygonArea(polygon[0])) > 0.001);
}

export function polygonArea(ring) {
  return ring.reduce((sum, [x, y], i) => {
    const next = ring[(i + 1) % ring.length];
    return sum + x * next[1] - next[0] * y;
  }, 0) / 2;
}
