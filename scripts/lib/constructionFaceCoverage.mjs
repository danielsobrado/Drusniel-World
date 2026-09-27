import { sampleCubicBezierPath } from '../../src/editor/construction/curve/CubicBezierPath.js';
import { createCurveArcTable } from '../../src/editor/construction/masonry/CurveArcTable.js';
import { openingHalfWidthAt } from '../../src/editor/construction/masonry/OpeningLayout.js';

/**
 * How much of a wall's face no stone covers, measured the way a viewer sees
 * it: every module's stones pooled along the whole wall, so a module seam is
 * not mistaken for a hole; each stone's exact quad rather than its bounding
 * box, so leaning joints do not hide a gap; and the openings themselves left
 * out, since they are meant to be open.
 */

function worldRing(placement) {
  const ring = placement.mortarCorners ?? placement.corners;
  if (ring) return ring.map(([s, y]) => [placement.s + s, placement.y + y]);
  const halfWidth = (placement.packedWidth ?? placement.width ?? 0) / 2;
  const halfHeight = (placement.height ?? 0) / 2;
  if (!(halfWidth > 0) || !(halfHeight > 0)) return null;
  return [
    [placement.s - halfWidth, placement.y - halfHeight],
    [placement.s + halfWidth, placement.y - halfHeight],
    [placement.s + halfWidth, placement.y + halfHeight],
    [placement.s - halfWidth, placement.y + halfHeight],
  ];
}

/** Vertical extent of a quad where the vertical line at `s` crosses it. */
function extentAt(ring, s) {
  const ys = [];
  for (let index = 0; index < ring.length; index += 1) {
    const [s0, y0] = ring[index];
    const [s1, y1] = ring[(index + 1) % ring.length];
    if (s < Math.min(s0, s1) || s > Math.max(s0, s1)) continue;
    if (Math.abs(s1 - s0) < 1e-9) {
      ys.push(y0, y1);
      continue;
    }
    ys.push(y0 + (y1 - y0) * ((s - s0) / (s1 - s0)));
  }
  return ys.length ? [Math.min(...ys), Math.max(...ys)] : null;
}

/** Covered intervals of one column, with joints up to `jointTolerance` closed. */
function coveredColumn(rings, s, jointTolerance) {
  const spans = rings
    .map((ring) => extentAt(ring, s))
    .filter(Boolean)
    .sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [bottom, top] of spans) {
    const last = merged.at(-1);
    if (last && bottom <= last[1] + jointTolerance) last[1] = Math.max(last[1], top);
    else merged.push([bottom, top]);
  }
  return merged;
}

/**
 * Share of the wall body, from the ground to `bodyTop`, that no stone covers
 * outside the openings.
 *
 * @param placements every module's placements, field stones and dressings
 * @param options.length the wall's arc length
 * @param options.bodyTop height of the wall body below any capstones
 * @param options.openings openings in arc coordinates (`s`, `width`, `sill`,
 *   `height`, `profile`), whose voids are not counted
 */
export function uncoveredFaceShare(placements, {
  length,
  bodyTop,
  openings = [],
  step = 0.05,
  rise = 0.01,
  jointTolerance = 0.02,
  topTolerance = 0.05,
}) {
  const rings = placements.map(worldRing).filter(Boolean);
  const top = bodyTop - topTolerance;
  let uncovered = 0;
  let counted = 0;
  for (let s = step / 2; s < length; s += step) {
    const covered = coveredColumn(rings, s, jointTolerance);
    for (let y = rise / 2; y < top; y += rise) {
      if (openings.some((opening) => Math.abs(s - opening.s) <= openingHalfWidthAt(opening, y))) {
        continue;
      }
      counted += 1;
      if (!covered.some(([bottom, upper]) => y >= bottom && y <= upper)) uncovered += 1;
    }
  }
  return counted > 0 ? uncovered / counted : 0;
}

/** A record's features in arc coordinates, as the planner hands them to the packer. */
export function wallOpenings(record) {
  const arcTable = createCurveArcTable(sampleCubicBezierPath(record.path));
  return record.features.map((feature) => ({
    ...feature,
    s: arcTable.toArc(feature.segmentId, feature.arcFraction),
  }));
}
