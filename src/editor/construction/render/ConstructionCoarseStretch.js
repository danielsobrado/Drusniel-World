import { scaleCorners } from '../masonry/CourseLattice.js';
import { coverageWithinSpan } from '../masonry/RuinSupportIntervals.js';

/**
 * Coarse LOD keeps every other field course and stretches each kept stone up
 * over the dropped course above it. This module decides whether a stone may
 * stretch (the course above must cover it) and how far (onto that course's own
 * top bed line).
 */

const MIN_STRETCH_COVERAGE_RATIO = 0.98;
const MAX_STRETCH_GAP = 0.05;

function stretchOverGap(placement, step) {
  if (!(step > 0)) return placement;
  const height = placement.height + step;
  const scaleY = height / placement.height;
  return {
    ...placement,
    y: placement.y + step / 2,
    height,
    ...(placement.corners ? { corners: scaleCorners(placement.corners, 1, scaleY) } : {}),
    ...(placement.mortarCorners
      ? { mortarCorners: scaleCorners(placement.mortarCorners, 1, scaleY) }
      : {}),
  };
}

/**
 * Height of the course above's top bed line at arc position `s`, read off its
 * cell footprints (`mortarCorners`), which tile the course with no joints.
 * Null where this module has no stone of that course.
 */
function bedLineAbove(above, s) {
  for (const stone of above) {
    const ring = stone.mortarCorners;
    if (!ring) continue;
    const [leftS, leftY] = [stone.s + ring[3][0], stone.y + ring[3][1]];
    const [rightS, rightY] = [stone.s + ring[2][0], stone.y + ring[2][1]];
    if (!(rightS > leftS) || s < leftS - 1e-6 || s > rightS + 1e-6) continue;
    return leftY + (rightY - leftY) * ((s - leftS) / (rightS - leftS));
  }
  return null;
}

/**
 * Stretch a lattice stone up over the dropped course by moving its two top
 * corners onto that course's own top bed line.
 *
 * Bed lines wave independently, so a uniform stretch by the course's mean step
 * left the stone short of the next kept course in some places and through it in
 * others — up to twice the bed amplitude, which read as a sliver of mortar at
 * every trough. Following the bed line meets the next course exactly, and ends a
 * clamped top course at the wall's ceiling instead of past it. Corners beyond
 * the course above's stones in this module fall back to the mean step.
 */
export function stretchToCourseAbove(placement, above, step) {
  if (!placement.corners || !placement.mortarCorners || !(step > 0)) {
    return stretchOverGap(placement, step);
  }
  const bedInset = (placement.jointWidths?.bed ?? 0) / 2;
  const toWorld = (ring) => ring.map(([x, y]) => [placement.s + x, placement.y + y]);
  const face = toWorld(placement.corners);
  const mortar = toWorld(placement.mortarCorners);
  for (const index of [2, 3]) {
    const bed = bedLineAbove(above, mortar[index][0]);
    const mortarTop = bed ?? mortar[index][1] + step;
    mortar[index][1] = Math.max(mortar[index][1], mortarTop);
    face[index][1] = Math.max(face[index][1], mortarTop - bedInset);
  }
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of face) {
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const y = (minY + maxY) / 2;
  const toLocal = (ring) => ring.map(([s, cornerY]) => [s - placement.s, cornerY - y]);
  return {
    ...placement,
    y,
    height: maxY - minY,
    corners: toLocal(face),
    mortarCorners: toLocal(mortar),
  };
}

/** Arc interval a placement occupies in its course. */
export function placementSpan(placement) {
  if (Array.isArray(placement.support?.span)) return placement.support.span;
  const width = placement.packedWidth ?? placement.width ?? 0;
  return [placement.s - width / 2, placement.s + width / 2];
}

/**
 * Whether `spans` cover the arc interval `span` closely enough for a stretched
 * stone to stand in for what they would have shown.
 *
 * @param clipRange the part of `span` this module owns, or null. Module
 *   boundaries wander per course, so a stone at a module's edge can reach past
 *   the neighbouring course's range here; that part lies against the next
 *   module's stones, which this module cannot see, so only the owned part is
 *   judged.
 */
export function spanCoveredBy([from, to], spans, clipRange = null) {
  let s0 = from;
  let s1 = to;
  // Legacy fixtures and non-lattice callers may omit horizontal dimensions. The
  // old reducer stretched those inputs unconditionally, so retain that contract.
  if (!(s1 - s0 > 0)) return true;
  if (clipRange) {
    s0 = Math.max(s0, clipRange[0]);
    s1 = Math.min(s1, clipRange[1]);
    if (!(s1 - s0 > 1e-6)) return true;
  }
  const width = s1 - s0;
  const coverage = coverageWithinSpan(s0, s1, spans);
  return coverage.ratio >= MIN_STRETCH_COVERAGE_RATIO
    && coverage.largestGap <= Math.min(MAX_STRETCH_GAP, width * 0.08);
}

/**
 * Whether a kept stone may stretch over the dropped course `above`: only where
 * that course covers it, so a stone under an opening or a ruin void stays put.
 *
 * @param aboveRange the arc range the course above occupies in this module
 */
export function courseCoversPlacement(placement, above, aboveRange = null) {
  if (!above || above.length === 0 || placement.ruin?.damageVoid) return false;
  return spanCoveredBy(placementSpan(placement), above.map(placementSpan), aboveRange);
}
