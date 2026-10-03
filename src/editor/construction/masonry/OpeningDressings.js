import { openingArchContour } from './OpeningContour.js';

const TRIM = 0.22;
const JOINT = 0.006;
// Keep the backing behind the reveal even where two dressed stones meet.
const REVEAL_RECESS = 0.06;

function polylineSamples(points) {
  const distances = [0];
  for (let i = 1; i < points.length; i += 1) distances.push(distances[i - 1]
    + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  const at = distance => {
    let i = 1;
    while (i < points.length - 1 && distances[i] < distance) i += 1;
    const t = (distance - distances[i - 1]) / Math.max(1e-9, distances[i] - distances[i - 1]);
    return points[i - 1].map((v, axis) => v + (points[i][axis] - v) * t);
  };
  return { distances, at, length: distances.at(-1) };
}

function dressing(points, thickness) {
  const outer = points.map(([s, y], i) => {
    const before = points[Math.max(0, i - 1)];
    const after = points[Math.min(points.length - 1, i + 1)];
    const dx = after[0] - before[0]; const dy = after[1] - before[1];
    const length = Math.hypot(dx, dy) || 1;
    return [s - dy / length * TRIM, y + dx / length * TRIM];
  });
  const ring = [...points, ...outer.slice().reverse()];
  const xs = ring.map(p => p[0]); const ys = ring.map(p => p[1]);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  const s = (Math.max(...xs) + Math.min(...xs)) / 2;
  const y = (Math.max(...ys) + Math.min(...ys)) / 2;
  const local = values => values.map(([x, h]) => [x - s, h - y]);
  // Backing retreats from the reveal, while the visible arch stone spans its depth.
  const innerCore = points.map((p, i) => p.map((v, axis) => v + (outer[i][axis] - v) * (REVEAL_RECESS / TRIM)));
  return {
    category: 'voussoir', s, y, width, height, depth: thickness * 1.06,
    offsetNormal: 0, roll: 0,
    contourPolygons: [[local(ring)]],
    mortarPolygons: [[local([...innerCore, ...outer.slice().reverse()])]],
  };
}

/** Dress the same sampled contour used to cut field stones, through the wall. */
export function layoutOpening(opening, { thickness, minWidth = 0.2 }) {
  if (!opening.dressed) return { jambs: [], voussoirs: [], keystone: null };
  const right = openingArchContour(opening);
  const spring = right[0][1] - opening.sill;
  const jambs = [];
  const rows = Math.max(1, Math.round(spring / 0.27));
  const jambHeight = spring / rows;
  if (jambHeight > 0.01) for (const side of [-1, 1]) for (let row = 0; row < rows; row += 1) {
    const rectangle = (bottom, top, left = -TRIM / 2, right = TRIM / 2) => [
      [left, bottom], [right, bottom], [right, top], [left, top],
    ];
    jambs.push({ category: 'ashlar', s: opening.s + side * (opening.width / 2 + TRIM / 2 + 0.018),
      y: opening.sill + (row + 0.5) * jambHeight, width: TRIM, height: jambHeight - JOINT,
      depth: thickness * 1.06, offsetNormal: 0, roll: 0,
      contourPolygons: [[rectangle(-(jambHeight - JOINT) / 2, (jambHeight - JOINT) / 2)]],
      mortarPolygons: [[rectangle(-jambHeight / 2, jambHeight / 2,
        -TRIM / 2 + (side > 0 ? REVEAL_RECESS : 0), TRIM / 2 - (side < 0 ? REVEAL_RECESS : 0))]],
    });
  }
  if (opening.profile === 'flat') return { jambs, voussoirs: [], keystone: {
    category: 'ashlar', s: opening.s, y: opening.sill + opening.height + TRIM / 2 + 0.018,
    width: opening.width + TRIM * 2, height: TRIM, depth: thickness * 1.06, offsetNormal: 0, roll: 0,
  } };
  const arch = [...right.map(([s, y]) => [2 * opening.s - s, y]), ...right.slice().reverse()];
  const line = polylineSamples(arch);
  const targetCount = Math.max(9, Math.ceil(line.length / Math.max(0.2, minWidth, 0.28)));
  const count = targetCount % 2 ? targetCount : targetCount + 1;
  const voussoirs = [];
  for (let i = 0; i < count; i += 1) {
    const start = i / count * line.length + JOINT / 2;
    const end = (i + 1) / count * line.length - JOINT / 2;
    const points = [line.at(start), ...arch.filter((_, j) => line.distances[j] > start && line.distances[j] < end), line.at(end)];
    voussoirs.push(dressing(points, thickness));
  }
  // Promote the middle wedge instead of overlapping it with a separate box.
  const [keystone] = voussoirs.splice(Math.floor(count / 2), 1);
  keystone.category = 'ashlar';
  return { jambs, voussoirs, keystone };
}
