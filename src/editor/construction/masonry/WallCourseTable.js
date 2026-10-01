/**
 * The vertical course grid of one wall: where each course's bed line sits.
 *
 * Every course was `courseHeight` tall until a style could declare a footing —
 * a taller first course of big stones sitting in the ground. The grid stays a
 * pure function of wall-wide values (style, course height, wall height), so
 * the two modules either side of a seam lay identical courses.
 *
 * Without a footing the table reproduces the uniform grid exactly, including
 * its floating-point arithmetic, so styles that do not opt in pack
 * bit-identically to before. Three.js-free.
 */

/**
 * Footing course height: tall enough to read as footing stones, but never more
 * than 40% of a low wall, and never shorter than an ordinary course.
 */
export function footingCourseHeight({ courseHeight, footing, wallHeight }) {
  if (!footing) return 0;
  return Math.min(
    footing.heightRatio * courseHeight,
    Math.max(courseHeight, 0.4 * wallHeight),
  );
}

/**
 * @param options.courseHeight ordinary course height
 * @param options.footing the style's footing descriptor, or null
 * @param options.wallHeight wall-wide top height the footing is sized against
 * @param options.bodyHeight tallest body height this module has to fill
 * @returns `{ footingHeight, count, baseAt, heightOf, centerAt }`. `baseAt` is
 *   null for a uniform grid so `CourseLattice` keeps its own arithmetic.
 */
export function createWallCourseTable({
  courseHeight,
  footing = null,
  wallHeight,
  bodyHeight,
}) {
  const footingHeight = footingCourseHeight({ courseHeight, footing, wallHeight });
  if (!(footingHeight > 0)) {
    return Object.freeze({
      footingHeight: 0,
      // Ceil, not round: the top course is trimmed to the wall profile, so
      // overshooting costs nothing and rounding down would leave bare wall.
      count: Math.max(1, Math.ceil(bodyHeight / courseHeight)),
      baseAt: null,
      heightOf: () => courseHeight,
      centerAt: (course) => (course + 0.5) * courseHeight,
    });
  }

  const baseAt = (course) => (course <= 0 ? 0 : footingHeight + (course - 1) * courseHeight);
  const heightOf = (course) => (course === 0 ? footingHeight : courseHeight);
  return Object.freeze({
    footingHeight,
    count: 1 + Math.max(0, Math.ceil((bodyHeight - footingHeight) / courseHeight)),
    baseAt,
    heightOf,
    centerAt: (course) => baseAt(course) + heightOf(course) / 2,
  });
}

/**
 * The fitted grid ends this far above the body top, so the top course still
 * overshoots and the lattice clamps it flush to the capstones. Ending exactly at
 * the body would leave that course its ordinary half-bed-joint inset — a gap
 * under the caps wider than a joint on wide-jointed styles.
 */
const TOP_CLAMP_MARGIN = 0.06;

/** How far a fitted course may stray from the style's own height. */
const FIT_RANGE = Object.freeze([0.8, 1.25]);

/**
 * Course height that lays whole courses from the ground to the capstones.
 *
 * With the style's height the courses rarely divide the body exactly, and the
 * packer drops a top course that is mostly above the coping, so up to half a
 * course of bare backing showed under the caps (0.19 m on a 3.2 m rounded
 * wall). Stretching or trimming that course instead leaves slivers. Fitting
 * the height keeps every course whole. The fit is a pure function of wall-wide
 * inputs — the authored top base, not the local profile — so every module
 * shares one grid, and a raised section still adds whole courses above it.
 *
 * @param options.courseHeight the style's course height
 * @param options.footing the style's footing descriptor, or null
 * @param options.wallHeight authored top base height
 * @param options.copingHeight capstone height
 * @param options.fitUncapped fit the body of a crenellated crown without coping
 * @returns the fitted height, or `courseHeight` when no fit lies within range
 */
export function fitWallCourseHeight({ courseHeight, footing = null, wallHeight, copingHeight = 0, fitUncapped = false }) {
  if ((!(copingHeight > 0) && !fitUncapped) || !(courseHeight > 0) || !(wallHeight > 0)) return courseHeight;
  const body = wallHeight - copingHeight + TOP_CLAMP_MARGIN;
  const footingOf = (height) => footingCourseHeight({ courseHeight: height, footing, wallHeight });
  const idealCount = (body - footingOf(courseHeight)) / courseHeight;
  if (!Number.isFinite(idealCount)) return courseHeight;
  // A short wall can consist of its footing alone. The two adjacent integer
  // counts bracket the nominal height, so any farther count is a worse fit.
  const minimumCount = footing ? 0 : 1;
  const counts = new Set([
    Math.max(minimumCount, Math.floor(idealCount)),
    Math.max(minimumCount, Math.ceil(idealCount)),
  ]);
  let best = courseHeight;
  let distance = Infinity;
  for (const count of counts) {
    let low = courseHeight * FIT_RANGE[0];
    let high = courseHeight * FIT_RANGE[1];
    const heightOf = (height) => footingOf(height) + count * height;
    if (heightOf(low) > body || heightOf(high) < body) continue;
    // Total height is monotone even where the footing hits its wall-height
    // cap. Bisection also converges for one-course walls, where iteratively
    // subtracting the footing oscillates instead of finding the fit.
    for (let iteration = 0; iteration < 36; iteration += 1) {
      const middle = (low + high) / 2;
      if (heightOf(middle) < body) low = middle;
      else high = middle;
    }
    const fitted = (low + high) / 2;
    if (Math.abs(fitted - courseHeight) < distance) {
      best = fitted;
      distance = Math.abs(fitted - courseHeight);
    }
  }
  return best;
}
