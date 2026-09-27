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
