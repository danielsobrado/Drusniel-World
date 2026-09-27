import assert from 'node:assert/strict';
import test from 'node:test';
import { isUsableConstructionStroke } from '../src/editor/EditorController.js';
import {
  createCubicBezierPathFromStroke,
  findCubicBezierSelfIntersections,
} from '../src/editor/construction/curve/CubicBezierPath.js';

/**
 * A closed courtyard stroke: walk each side of a square and return to the
 * first sample, sampled as `onConstructionPointerMove` appends them (every
 * step or more). The accumulated perimeter is `4 * side`; the endpoint
 * distance is zero.
 */
function squareCourtyard(side = 10, step = 0.25, returnOffset = null) {
  const corners = [
    { x: 0, z: 0 },
    { x: side, z: 0 },
    { x: side, z: side },
    { x: 0, z: side },
    { x: 0, z: 0 },
  ];
  const points = [corners[0]];
  for (let index = 1; index < corners.length; index += 1) {
    const from = corners[index - 1];
    const to = corners[index];
    const count = Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / step);
    for (let sample = 1; sample <= count; sample += 1) {
      points.push({
        x: from.x + (to.x - from.x) * (sample / count),
        z: from.z + (to.z - from.z) * (sample / count),
      });
    }
  }
  if (returnOffset) points[points.length - 1] = { ...returnOffset };
  return points;
}

/** Straight stroke of `length` metres sampled every `step`, ending far from its start. */
function openStroke(length = 12, step = 0.5) {
  const points = [{ x: 0, z: 0 }];
  for (let travelled = step; travelled <= length; travelled += step) {
    points.push({ x: travelled, z: 0 });
  }
  return points;
}

test('a 40 m square courtyard returning to its start is accepted and closed', () => {
  const stroke = squareCourtyard(10);
  const result = isUsableConstructionStroke(stroke);

  assert.equal(result.closed, true);
  assert.equal(result.usable, true);
  assert.ok(
    Math.abs(result.length - 40) < 0.01,
    `expected ~40 m perimeter, got ${result.length}`,
  );
});

test('a genuinely tiny stroke is still rejected', () => {
  const stroke = [
    { x: 0, z: 0 },
    { x: 0.12, z: 0 },
    { x: 0.24, z: 0 },
    { x: 0.36, z: 0 },
  ];
  const result = isUsableConstructionStroke(stroke);

  assert.ok(result.length < 0.5);
  assert.equal(result.usable, false);
});

test('a single-sample stroke is still rejected', () => {
  const result = isUsableConstructionStroke([{ x: 3, z: 4 }]);

  assert.deepEqual(result, { length: 0, closed: false, usable: false });
});

test('a long open stroke ending away from its start stays usable and open', () => {
  const stroke = openStroke();
  const result = isUsableConstructionStroke(stroke);

  assert.equal(result.usable, true);
  assert.equal(result.closed, false);
  assert.ok(result.length >= 0.5);
});

test('the reported length is accumulated, not the endpoint distance', () => {
  const stroke = squareCourtyard(10);
  const endpointDistance = Math.hypot(
    stroke.at(-1).x - stroke[0].x,
    stroke.at(-1).z - stroke[0].z,
  );
  const result = isUsableConstructionStroke(stroke);

  // Endpoint distance is ~0 for a loop, yet the length is its ~40 m perimeter.
  assert.ok(endpointDistance < 1e-9);
  assert.ok(result.length > 39.9 && result.length < 40.1);
});

test('a closed loop fits to a single-seam closed path with no self-intersection', () => {
  const stroke = squareCourtyard(10);
  const { closed } = isUsableConstructionStroke(stroke);

  // The same normalisation the controller applies before fitting.
  const points = closed ? [...stroke.slice(0, -1), stroke[0]] : stroke;
  const path = createCubicBezierPathFromStroke(points, {
    closed,
    anchorPrefix: 'a',
    segmentPrefix: 's',
  });

  assert.equal(path.closed, true);
  assert.equal(path.anchors.length, 4);
  assert.equal(path.segments.length, path.anchors.length);
  assert.equal(findCubicBezierSelfIntersections(path).length, 0);
});

test('a near-return within the closure tolerance still closes on one seam', () => {
  const stroke = squareCourtyard(10, 0.25, { x: 0.3, z: 0.2 });
  const { closed } = isUsableConstructionStroke(stroke);

  assert.equal(closed, true);
  const points = [...stroke.slice(0, -1), stroke[0]];
  const path = createCubicBezierPathFromStroke(points, { closed, anchorPrefix: 'a', segmentPrefix: 's' });

  assert.equal(path.anchors.length, 4);
  assert.equal(path.segments.length, path.anchors.length);
  assert.equal(findCubicBezierSelfIntersections(path).length, 0);
});
