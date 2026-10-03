import { normalizeConstructionRecord } from '/src/editor/construction/ConstructionSchema.js';
import { createCubicBezierPathFromStroke, sampleCubicBezierPath } from '/src/editor/construction/curve/CubicBezierPath.js';
import { createCurveArcTable } from '/src/editor/construction/masonry/CurveArcTable.js';

export const GARDEN_SCENES = Object.freeze(['meadow-closeup', 'meadow-curve', 'arched-courtyard']);

const curve = [[-5, 3], [-5, 0], [-3, -3], [0, -4], [3, -3], [5, 0], [5, 3]];
const openCircle = (radius) => Array.from({ length: 32 }, (_, i) => {
  const angle = Math.PI / 2 + 0.325 + i / 31 * (Math.PI * 2 - 0.65);
  return [Math.cos(angle) * radius, Math.sin(angle) * radius];
});

function wall(id, points, { styleKey, growth, height, top = 'flat', closed = false, arches = [] }) {
  const path = createCubicBezierPathFromStroke(points, { closed, simplifyTolerance: 0.02 });
  const arcTable = createCurveArcTable(sampleCubicBezierPath(path));
  const record = normalizeConstructionRecord({
    version: 1, id, revision: 1, seed: 3141, kind: 'wall', path,
    style: { key: styleKey, version: 1, growth },
    dimensions: { height, thickness: 0.8 }, top: { style: top },
    features: arches.map((fraction, i) => ({
      id: `${id}-arch-${i}`, kind: 'arch',
      ...arcTable.fromArc(fraction * arcTable.totalLength),
      width: 3.5, height: 5.6, sill: 0, profile: 'round', dressed: true,
    })),
  });
  return { record, arcTable };
}

/** Fixed semantic compositions corresponding to the supplied reference views. */
export function constructionGardenScene(id, { styleKey, growth }) {
  if (!GARDEN_SCENES.includes(id)) return null;
  const shared = { styleKey, growth };
  if (id === 'arched-courtyard') return {
    walls: [
      wall(`${id}-outer`, curve.map(([x, z]) => [x * 1.4, z * 1.65]),
        { ...shared, height: 7.8, arches: [0.15, 0.38, 0.62, 0.85] }),
      wall(`${id}-inner`, openCircle(2.7), { ...shared, height: 4.5 }),
    ],
    camera: { position: [14, 15, 21], target: [0, 3.4, 0], zoom: 0.95 },
    path: { center: [0, 0], radius: 1.05 },
  };
  if (id === 'meadow-closeup') return {
    walls: [wall(id, [[-7, 0], [7, 0]], { ...shared, height: 3.2, top: 'crenellated' })],
    camera: { position: [2, 3.8, 12], target: [0, 1.8, 0], zoom: 3 },
    trees: { height: 3.5, positions: [[-6, -3], [-3, -4], [0, -5], [3, -4], [6, -3]] },
    path: null,
  };
  return {
    walls: [wall(id, curve, { ...shared, height: 1.8, top: 'crenellated' })],
    camera: { position: [10, 11, 15], target: [0, 0.8, -0.4], zoom: 1.55 },
    path: null,
  };
}
