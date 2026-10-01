/** Exposed edges in the stone's local face plane, derived before meshing. */
export function constructionStoneExposure(placement, { totalLength, closed = false }) {
  const halfWidth = (placement.packedWidth ?? placement.width) / 2;
  // Coarse merging centers the visible face; asymmetric joints can leave that
  // center slightly offset from the logical cell. Use its resolved boundary.
  const bounds = placement.mortarCorners?.map(([x]) => placement.s + x);
  const start = bounds ? Math.min(...bounds) : placement.s - halfWidth;
  const end = bounds ? Math.max(...bounds) : placement.s + halfWidth;
  return {
    top: placement.exposure?.top || placement.ruin?.exposedTop || placement.category === 'coping',
    bottom: placement.exposure?.bottom === true,
    start: placement.exposure?.start || (!closed && start <= 1e-6),
    end: placement.exposure?.end || (!closed && end >= totalLength - 1e-6),
  };
}

/**
 * Recess only open boundaries. Interior cells keep their shared footprint so
 * mortar still fills joints across module seams. Interpolating along each quad
 * edge preserves sloped bed lines and cannot invert a narrow terminal cell.
 */
export function recessExposedMortar(corners, exposure, recess) {
  if (!exposure || !(exposure.top || exposure.bottom || exposure.start || exposure.end)) return corners;
  const result = corners.map(corner => [...corner]);
  const inset = (index, opposite) => {
    const source = corners[index];
    const target = corners[opposite];
    const fraction = Math.min(0.25, recess / Math.max(1e-6, Math.hypot(
      target[0] - source[0], target[1] - source[1],
    )));
    result[index][0] += (target[0] - source[0]) * fraction;
    result[index][1] += (target[1] - source[1]) * fraction;
  };
  if (exposure.start) { inset(0, 1); inset(3, 2); }
  if (exposure.end) { inset(1, 0); inset(2, 3); }
  if (exposure.top) { inset(2, 1); inset(3, 0); }
  if (exposure.bottom) { inset(0, 3); inset(1, 2); }
  return result;
}
