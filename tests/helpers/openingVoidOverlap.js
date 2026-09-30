import { openingHalfWidthAt } from '../../src/editor/construction/masonry/OpeningLayout.js';

/**
 * The material of a packed stone's cell in wall arc/height coordinates, as
 * polygons of rings (outer boundary first, then holes).
 *
 * A stone fitted over an opening carries the polygons its cell was cut to
 * (`mortarPolygons`); every other stone is its solved quad (`mortarCorners`).
 */
export function stoneCellPolygons(stone) {
  const world = (ring) => ring.map(([s, y]) => [stone.s + s, stone.y + y]);
  if (stone.mortarPolygons) return stone.mortarPolygons.map((polygon) => polygon.map(world));
  return [[world(stone.mortarCorners)]];
}

/**
 * Does a stone reach into an opening's void by more than `depth`?
 *
 * "By more than `depth`" means the stone contains a point whose four
 * neighbours `depth` away along each axis are all inside the void — the void
 * eroded by `depth`. The void is convex for every profile, so that is a point at
 * least `depth / sqrt(2)` from the void's edge in any direction.
 *
 * @param polygon rings of `[s, y]` world points, outer boundary first.
 * @param opening `{ s, width, height, sill, profile }` in arc coordinates.
 */
export function reachesIntoVoid(polygon, opening, depth, { step = 0.002 } = {}) {
  const ys = polygon[0].map(([, y]) => y);
  const from = Math.max(Math.min(...ys), opening.sill);
  const to = Math.min(Math.max(...ys), opening.sill + opening.height);
  for (let y = from; y <= to; y += step) {
    const half = Math.min(
      openingHalfWidthAt(opening, y) - depth,
      openingHalfWidthAt(opening, y - depth),
      openingHalfWidthAt(opening, y + depth),
    );
    if (!(half > 0)) continue;
    for (const [low, high] of rowIntervals(polygon, y)) {
      if (Math.min(high, opening.s + half) - Math.max(low, opening.s - half) > 1e-9) return true;
    }
  }
  return false;
}

/** Where the horizontal line at `y` lies inside a polygon, even-odd over its rings. */
function rowIntervals(polygon, y) {
  const crossings = [];
  for (const ring of polygon) {
    for (let index = 0; index < ring.length; index += 1) {
      const [s0, y0] = ring[index];
      const [s1, y1] = ring[(index + 1) % ring.length];
      if ((y0 > y) === (y1 > y)) continue;
      crossings.push(s0 + (s1 - s0) * ((y - y0) / (y1 - y0)));
    }
  }
  crossings.sort((a, b) => a - b);
  const intervals = [];
  for (let index = 0; index + 1 < crossings.length; index += 2) {
    intervals.push([crossings[index], crossings[index + 1]]);
  }
  return intervals;
}
