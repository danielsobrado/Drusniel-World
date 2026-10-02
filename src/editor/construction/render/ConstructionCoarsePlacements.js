import { constructionJointProfile } from '../config/ConstructionJointProfiles.generated.js';
import { constructionStyle, isConstructionStyleKey } from '../masonry/ConstructionStyleCatalog.js';
import { scaleCorners } from '../masonry/CourseLattice.js';
import { moduleCourseRange } from '../masonry/CurvedCoursePacker.js';
import {
  courseCoversPlacement,
  placementSpan,
  spanCoveredBy,
  stretchToCourseAbove,
} from './ConstructionCoarseStretch.js';

const CORNER_DIRECTIONS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

function cornerBounds(corners) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of corners) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * The outer quad of a split cell's leaves, in world coordinates, or null when a
 * leaf lacks the ring.
 *
 * Each corner is the leaf corner furthest along that corner's diagonal. Taking
 * the furthest arc position first, as this used to, picked the lower leaf's
 * top-right corner whenever the head joint leaned left — its corner sits a
 * little further along the wall than the upper leaf's — so a horizontally split
 * cell merged into a stone whose top sloped down to mid-course, opening a wedge
 * of mortar above it at every coarse LOD.
 */
function outerCornerRing(group, key) {
  if (!group.every((leaf) => Array.isArray(leaf[key]))) return null;
  return CORNER_DIRECTIONS.map(([alongS, alongY], slot) => {
    let best = null;
    let bestScore = -Infinity;
    for (const leaf of group) {
      const point = [leaf.s + leaf[key][slot][0], leaf.y + leaf[key][slot][1]];
      const score = point[0] * alongS + point[1] * alongY;
      if (score > bestScore + 1e-12) {
        best = point;
        bestScore = score;
      }
    }
    return best;
  });
}

function mergeCornerRing(group, key, s, y) {
  const world = outerCornerRing(group, key);
  return world ? world.map(([cornerS, cornerY]) => [cornerS - s, cornerY - y]) : null;
}

export function selectDominantPlacement(leaves) {
  return leaves.reduce((best, candidate) => {
    if (!best) return candidate;
    const bestArea = best.width * best.height;
    const candidateArea = candidate.width * candidate.height;
    if (candidateArea !== bestArea) return candidateArea > bestArea ? candidate : best;
    return candidate.stableIndex < best.stableIndex ? candidate : best;
  }, null);
}

function mergeCellLeaves(group) {
  const corners = outerCornerRing(group, 'corners');

  let minS = Infinity;
  let maxS = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [s, y] of corners) {
    minS = Math.min(minS, s);
    maxS = Math.max(maxS, s);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const s = (minS + maxS) / 2;
  const y = (minY + maxY) / 2;
  const dominant = selectDominantPlacement(group);
  const exposure = group.some(leaf => leaf.exposure) ? Object.fromEntries(
    ['start', 'end', 'top', 'bottom'].map(edge => [edge, group.some(leaf => leaf.exposure?.[edge])]),
  ) : null;
  // The merged stone occupies every leaf's arc, so its span must too: keeping
  // only the dominant leaf's span made a vertically split cell look half empty
  // to the coverage test, and the course below it then refused to stretch.
  const spans = group.map(placementSpan);
  const support = dominant.support
    ? Object.freeze({
      ...dominant.support,
      span: Object.freeze([
        Math.min(...spans.map(([from]) => from)),
        Math.max(...spans.map(([, to]) => to)),
      ]),
    })
    : dominant.support;
  const mergedMortarCorners = mergeCornerRing(group, 'mortarCorners', s, y);
  const jointWidths = dominant.jointWidths ? { ...dominant.jointWidths } : null;
  const packedWidth = mergedMortarCorners
    ? cornerBounds(mergedMortarCorners).width
    : maxS - minS;

  return {
    ...dominant,
    ...(exposure ? { exposure } : {}),
    support,
    s,
    y,
    corners: corners.map(([cornerS, cornerY]) => [cornerS - s, cornerY - y]),
    ...(mergedMortarCorners ? { mortarCorners: mergedMortarCorners } : {}),
    ...(jointWidths ? { jointWidths } : {}),
    ...(dominant.jointWidthsNear
      ? { jointWidthsNear: { ...dominant.jointWidthsNear } }
      : jointWidths
        ? { jointWidthsNear: { ...jointWidths } }
        : {}),
    width: maxS - minS,
    height: maxY - minY,
    packedWidth,
    bandHeight: 1,
  };
}

function canMergeSplitCell(group) {
  if (group.some((placement) => placement.ruin?.damageVoid)) return false;
  const clusterIds = new Set(
    group.map((placement) => placement.ruin?.clusterId).filter((value) => value != null),
  );
  return clusterIds.size <= 1;
}

function mergeSplitCells(field) {
  const cells = new Map();
  const merged = [];
  for (const placement of field) {
    if (placement.cellIndex == null || !placement.corners) {
      merged.push(placement);
      continue;
    }
    const group = cells.get(placement.cellIndex);
    if (group) group.push(placement);
    else cells.set(placement.cellIndex, [placement]);
  }
  for (const group of cells.values()) {
    if (group.length === 1 || !canMergeSplitCell(group)) merged.push(...group);
    else merged.push(mergeCellLeaves(group));
  }
  return merged;
}

export function amplifyCoarseJoints(placement, profile) {
  if (placement.contourPolygons) return placement;
  if (!placement.corners || !placement.jointWidths || !placement.mortarCorners) {
    return placement;
  }
  if (!(profile.coarseLodMultiplier > 1) || placement.coarseJointsAmplified) {
    return placement;
  }

  const nearWidths = placement.jointWidthsNear ?? placement.jointWidths;
  const mortarBounds = cornerBounds(placement.mortarCorners);
  if (!(mortarBounds.width > 0) || !(mortarBounds.height > 0)) return placement;

  const finalHead = Math.min(
    nearWidths.head * profile.coarseLodMultiplier,
    Math.max(0, mortarBounds.width - profile.minimumRenderedWidth),
  );
  const finalBed = Math.min(
    nearWidths.bed * profile.coarseLodMultiplier,
    Math.max(0, mortarBounds.height - profile.minimumRenderedHeight),
  );
  const scaleX = Math.max(0.01, 1 - finalHead / mortarBounds.width);
  const scaleY = Math.max(0.01, 1 - finalBed / mortarBounds.height);

  return {
    ...placement,
    corners: scaleCorners(placement.mortarCorners, scaleX, scaleY),
    width: mortarBounds.width * scaleX,
    height: mortarBounds.height * scaleY,
    packedWidth: mortarBounds.width,
    jointWidthsNear: { head: nearWidths.head, bed: nearWidths.bed },
    jointWidths: { head: finalHead, bed: finalBed },
    coarseJointsAmplified: true,
  };
}

function courseMeanY(course) {
  return course.reduce((total, placement) => total + placement.y, 0) / course.length;
}

function courseIndexSpan(course) {
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const placement of course) {
    const index = placement.courseIndex ?? placement.support?.courseIndex;
    if (index == null) continue;
    minimum = Math.min(minimum, index);
    maximum = Math.max(maximum, index);
  }
  return { minimum, maximum };
}

/**
 * @param options.styleKey catalog layout policy and coarse joint profile
 * @param options.courseRangeAt optional `(courseIndex) => [from, to]`, the arc
 *   range each course occupies in this module (`moduleCourseRange`). With it, a
 *   stone at a module edge is not refused a stretch just because the course
 *   above continues in the next module, and a dropped stone that no stretched
 *   stone below replaces — over an arch, beside a jamb — is kept instead of
 *   leaving a hole. Ignored for ruined walls, where a gap in the course above
 *   across the seam may be a real void.
 */
export function coarsePlacements(placements, { styleKey = null, courseRangeAt = null } = {}) {
  if (!Array.isArray(placements) || placements.length === 0) return placements ?? [];
  // Geometry tessellation supplies the distance reduction for these styles.
  // Keep identity, joints, opening masks and crown slices exactly as solved.
  if (isConstructionStyleKey(styleKey)
    && constructionStyle(styleKey).coarseLayout === 'preserve') return placements;
  const field = [];
  const rest = [];
  for (const placement of placements) {
    // Footing stones are a course of their own height: pairing them with the
    // course above would stretch them by the wrong step, and there are few
    // enough of them to keep whole.
    //
    // Stones fitted around an opening keep the opening's contour, so they are
    // kept whole too; and because they leave the courses, no stone below is
    // judged covered by them and stretched into the void.
    // Crown stones retain the exposed edge used to recess their mortar.
    if (placement.category === 'field'
      && !placement.footing && !placement.openingFit && !placement.exposure?.top) field.push(placement);
    else rest.push(placement);
  }
  if (field.length === 0) return placements;

  const courses = new Map();
  for (const placement of mergeSplitCells(field)) {
    const key = placement.courseIndex != null
      ? `course:${placement.courseIndex}`
      : `y:${Math.round(placement.y * 50) / 50}`;
    if (!courses.has(key)) courses.set(key, []);
    courses.get(key).push(placement);
  }

  const jointProfile = constructionJointProfile(styleKey);
  const ordered = [...courses.values()].sort((a, b) => courseMeanY(a) - courseMeanY(b));
  const moduleAware = typeof courseRangeAt === 'function'
    && !placements.some((placement) => placement.ruin);
  // The arc range a course occupies in this module, when the caller knows it.
  const ownedRange = (stones) => {
    const courseIndex = stones?.[0]?.courseIndex;
    return moduleAware && Number.isInteger(courseIndex) ? courseRangeAt(courseIndex) : null;
  };
  const merged = [];

  for (let index = 0; index < ordered.length; index += 2) {
    const course = ordered[index];
    const above = ordered[index + 1];
    let step = 0;
    let ruinGap = false;
    if (above) {
      const belowSpan = courseIndexSpan(course);
      const aboveSpan = courseIndexSpan(above);
      ruinGap = Number.isFinite(belowSpan.maximum)
        && Number.isFinite(aboveSpan.minimum)
        && aboveSpan.minimum - belowSpan.maximum > 1;
      if (!ruinGap) step = Math.max(0, courseMeanY(above) - courseMeanY(course));
    }

    const aboveRange = ownedRange(above);
    const stretchedSpans = [];
    for (const placement of course) {
      const mayStretch = !ruinGap && courseCoversPlacement(placement, above, aboveRange);
      const stretched = mayStretch ? stretchToCourseAbove(placement, above, step) : placement;
      if (mayStretch) stretchedSpans.push(placementSpan(placement));
      merged.push(amplifyCoarseJoints(stretched, jointProfile));
    }
    if (moduleAware && above && !ruinGap) {
      // A dropped stone only disappears where stretched stones below take its
      // place. Where they do not, keeping it overlaps a stretched neighbour a
      // little, which reads far better at this range than the mortar a hole
      // would show.
      const courseRange = ownedRange(course);
      for (const placement of above) {
        if (!spanCoveredBy(placementSpan(placement), stretchedSpans, courseRange)) {
          merged.push(amplifyCoarseJoints(placement, jointProfile));
        }
      }
    }
  }

  return [...rest, ...merged];
}

/**
 * Coarse placements for one planned module, aware of where its seams run.
 *
 * @param options.record the construction record the module was planned from
 * @param options.module a plan module (`placements`, `pathInterval`)
 * @param options.totalLength the planned wall's arc length
 */
export function coarsePlacementsForModule({ record, module, totalLength }) {
  const style = constructionStyle(record.style.key);
  const arcRange = module.pathInterval ?? [0, totalLength];
  const wallRange = [0, totalLength ?? arcRange[1]];
  return coarsePlacements(module.placements ?? [], {
    styleKey: record.style.key,
    courseRangeAt: (course) => moduleCourseRange({
      seed: record.seed,
      targetWidth: style.targetWidth,
      arcRange,
      wallRange,
      course,
    }),
  });
}
