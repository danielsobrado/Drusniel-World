/**
 * Ground height along a wall's centreline, sampled once per module build.
 *
 * Soft-style stones are lifted by the ground under their own centre, so on a
 * slope two neighbours sit at different grades and every shared head joint
 * steps by the slope times the stone width. Draping instead shears each vertex
 * by the ground at its own position along the wall, so both stones either side
 * of a joint evaluate the same height there and the joint stays closed.
 *
 * Sampling the centreline once, at a fixed step, keeps the per-vertex cost to a
 * table lookup and makes a stone's shape independent of how many vertices it
 * has. Three.js-free; `groundHeightAt` is whatever the caller resolves terrain
 * with.
 */

const DEFAULT_STEP = 0.25;

/**
 * @param options.arcTable the wall's `CurveArcTable`
 * @param options.groundHeightAt `(canonicalX, canonicalZ) => number`
 * @param options.from, options.to arc range to cover; clamped to the wall
 */
export function createArcGroundTable({
  arcTable,
  groundHeightAt,
  from,
  to,
  step = DEFAULT_STEP,
}) {
  const start = Math.max(0, Math.min(from, to));
  const end = Math.min(arcTable.totalLength, Math.max(from, to));
  const span = Math.max(0, end - start);
  const count = Math.max(2, Math.ceil(span / step) + 1);
  const spacing = span > 0 ? span / (count - 1) : step;
  const heights = new Float64Array(count);
  for (let index = 0; index < count; index += 1) {
    const frame = arcTable.frameAt(start + index * spacing);
    heights[index] = groundHeightAt(frame.x, frame.z);
  }

  const locate = (s) => {
    const position = Math.min(count - 1, Math.max(0, (s - start) / spacing));
    const low = Math.min(count - 2, Math.floor(position));
    return { low, t: position - low };
  };

  return Object.freeze({
    start,
    end,
    heightAt(s) {
      const { low, t } = locate(s);
      return heights[low] + (heights[low + 1] - heights[low]) * t;
    },
    /** Rise per metre along the wall, zero past either end of the table. */
    slopeAt(s) {
      if (s < start || s > end) return 0;
      const { low } = locate(s);
      return (heights[low + 1] - heights[low]) / spacing;
    },
  });
}

/**
 * A per-stone drape for `writePillowStone`: maps a module-space point to its
 * arc position through the stone's own frame, then reads the table.
 */
export function createStoneDrape(ground, {
  s,
  centerX,
  centerZ,
  tangentX,
  tangentZ,
}) {
  return {
    tangentX,
    tangentZ,
    sample(x, z, out) {
      const along = s + (x - centerX) * tangentX + (z - centerZ) * tangentZ;
      out[0] = ground.heightAt(along);
      out[1] = ground.slopeAt(along);
      return out;
    },
  };
}
