import { CUBIC_BEZIER_PATH_VERSION, normalizeConstructionPath } from './ConstructionSchema.js';
import { createCubicBezierPathFromStroke } from './curve/CubicBezierPath.js';

export const CONSTRUCTION_DRAW_SHAPES = Object.freeze(['freehand', 'line', 'circle']);

/** Returning to the start closes a freehand courtyard, including its preview. */
export function isUsableConstructionStroke(stroke, { closureTolerance = 0.5, minimumLength = 0.5 } = {}) {
  if (!Array.isArray(stroke) || stroke.length < 2) return { length: 0, closed: false, usable: false };
  let length = 0;
  for (let i = 1; i < stroke.length; i += 1) {
    length += Math.hypot(stroke[i].x - stroke[i - 1].x, stroke[i].z - stroke[i - 1].z);
  }
  const closed = stroke.length >= 3
    && Math.hypot(stroke.at(-1).x - stroke[0].x, stroke.at(-1).z - stroke[0].z) <= closureTolerance;
  return { length, closed, usable: length >= minimumLength };
}

/**
 * All creation gestures produce ordinary semantic curves. Preview and commit
 * share this function; shapes require no new persistence or compiler branches.
 * A circle is dragged from its centre to its rim using four cubic quarters.
 */
export function constructionPathFromGesture(stroke, { shape = 'freehand', id = 'preview' } = {}) {
  if (!CONSTRUCTION_DRAW_SHAPES.includes(shape)) throw new Error(`Unknown wall shape: ${shape}`);
  const options = { anchorPrefix: `${id}-anchor`, segmentPrefix: `${id}-segment` };
  if (shape === 'freehand') {
    const info = isUsableConstructionStroke(stroke);
    if (!info.usable) return null;
    const points = info.closed ? [...stroke.slice(0, -1), stroke[0]] : stroke;
    return createCubicBezierPathFromStroke(points, { ...options, closed: info.closed });
  }
  if (!stroke || stroke.length < 2) return null;
  const start = stroke[0];
  const end = stroke.at(-1);
  const radius = Math.hypot(end.x - start.x, end.z - start.z);
  if (radius < 0.5) return null;
  if (shape === 'line') return createCubicBezierPathFromStroke([start, end], options);
  const quarterHandle = radius * 4 * (Math.sqrt(2) - 1) / 3;
  const axes = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const anchors = axes.map(([x, z], i) => ({
    id: `${options.anchorPrefix}-${i + 1}`,
    position: [start.x + x * radius, start.z + z * radius],
  }));
  const segments = axes.map(([x, z], i) => {
    const next = (i + 1) % 4;
    const [nx, nz] = axes[next];
    return {
      id: `${options.segmentPrefix}-${i + 1}`,
      startAnchorId: anchors[i].id, endAnchorId: anchors[next].id,
      startHandle: [-z * quarterHandle, x * quarterHandle],
      endHandle: [nz * quarterHandle, -nx * quarterHandle],
    };
  });
  return normalizeConstructionPath({ version: CUBIC_BEZIER_PATH_VERSION, type: 'cubicBezier', closed: true, anchors, segments, features: [] });
}
