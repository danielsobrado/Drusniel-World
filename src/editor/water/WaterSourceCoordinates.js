/** An imported atlas coordinate `[x, y]` as a world cell position, or null. */
export function atlasToWorldCell(source, point) {
  if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
    return null;
  }
  return {
    x: source.bounds.minCellX + point[0] / source.atlas.width * source.bounds.widthCells,
    z: source.bounds.minCellZ + point[1] / source.atlas.height * source.bounds.heightCells,
  };
}
