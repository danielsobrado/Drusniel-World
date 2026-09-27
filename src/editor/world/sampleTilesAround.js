/**
 * Terrain tiles on rings around a canonical point: the centre, then
 * `directions` samples on each ring. Canonical Z runs opposite to cell Z, as
 * everywhere in canonical space. Tiles that are not integers (nothing loaded)
 * are left out.
 *
 * @param {object} options
 * @param {(cellX: number, cellZ: number) => number} options.getTile
 * @param {number} options.tileSize metres per cell
 * @param {number} options.x canonical metres
 * @param {number} options.z canonical metres
 * @param {number[]} options.rings radii in metres; 0 samples the centre once
 * @param {number} options.directions samples per ring
 */
export function sampleTilesAround({ getTile, tileSize, x, z, rings, directions }) {
  const tiles = [];
  for (const point of ringPoints({ x, z, rings, directions })) {
    const tile = getTile(Math.floor(point.x / tileSize), Math.floor(-point.z / tileSize));
    if (Number.isInteger(tile)) tiles.push(tile);
  }
  return tiles;
}

/**
 * The canonical points `sampleTilesAround` visits: the centre once for a zero
 * ring, then `directions` evenly round each ring. Each carries its offset from
 * the centre, for callers that need the bearing of what they find.
 */
export function ringPoints({ x, z, rings, directions }) {
  const points = [];
  for (const radius of rings) {
    const steps = radius === 0 ? 1 : directions;
    for (let step = 0; step < steps; step += 1) {
      const angle = (step / steps) * Math.PI * 2;
      const dx = Math.cos(angle) * radius;
      const dz = Math.sin(angle) * radius;
      points.push({ x: x + dx, z: z + dz, dx, dz });
    }
  }
  return points;
}

/** Share of `tiles` that are one of `tileIds`, 0..1. */
export function tileShare(tiles, tileIds) {
  if (!tiles.length) return 0;
  const wanted = tileIds instanceof Set ? tileIds : new Set(tileIds);
  let count = 0;
  for (const tile of tiles) if (wanted.has(tile)) count += 1;
  return count / tiles.length;
}
