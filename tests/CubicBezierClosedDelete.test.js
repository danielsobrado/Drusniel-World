import assert from 'node:assert/strict';
import test from 'node:test';
import {
  closeCubicBezierPath,
  controlPointsForSegment,
  createCubicBezierPathFromStroke,
  deleteCubicBezierAnchor,
  sampleCubicBezierPath,
} from '../src/editor/construction/curve/CubicBezierPath.js';
import { createCurveArcTable } from '../src/editor/construction/masonry/CurveArcTable.js';
import { normalizeConstructionPath } from '../src/editor/construction/ConstructionSchema.js';

/**
 * Six anchors with `segment-N` joining `anchor-N` to `anchor-(N+1)`, so the
 * closed contour reads segment-1 … segment-6 and wraps segment-6 back to
 * anchor-1.
 */
function hexagonLoop() {
  return createCubicBezierPathFromStroke([
    [0, 0], [10, 0], [14, 6], [8, 12], [0, 12], [-4, 6],
  ], { simplifyTolerance: 0.01, closed: true });
}

function endpointPairs(path) {
  return path.segments.map(({ id, startAnchorId, endAnchorId }) => [id, startAnchorId, endAnchorId]);
}

test('deleting a middle anchor of a closed loop preserves every survivor endpoint pair', () => {
  const loop = hexagonLoop();
  assert.equal(loop.anchors.length, 6);
  const before = new Map(loop.segments.map(({ id, startAnchorId, endAnchorId }) => (
    [id, [startAnchorId, endAnchorId]]
  )));

  const deleted = deleteCubicBezierAnchor(loop, 'anchor-3');

  // The exact surviving set: same ids, same endpoints, same direction.
  assert.deepEqual(endpointPairs(deleted), [
    ['segment-4', 'anchor-4', 'anchor-5'],
    ['segment-5', 'anchor-5', 'anchor-6'],
    ['segment-6', 'anchor-6', 'anchor-1'],
    ['segment-1', 'anchor-1', 'anchor-2'],
  ]);
  for (const [id, startAnchorId, endAnchorId] of endpointPairs(deleted)) {
    assert.deepEqual([startAnchorId, endAnchorId], before.get(id));
  }
  // Only the deleted anchor's two segments leave.
  assert.ok(!deleted.segments.some(({ id }) => id === 'segment-2' || id === 'segment-3'));
  assert.ok(!deleted.anchors.some(({ id }) => id === 'anchor-3'));
});

test('the reopened loop is one contour with a single seam and chained arc ranges', () => {
  const loop = hexagonLoop();
  const deleted = deleteCubicBezierAnchor(loop, 'anchor-3');

  // Reopening is the "eraser trick" contract: the loop loses the anchor and both
  // its segments and opens at the gap (`closed === false`), leaving one seam.
  assert.equal(deleted.closed, false);
  assert.equal(deleted.anchors.length, 5);
  assert.equal(deleted.segments.length, 4);

  const seams = [];
  for (let index = 0; index < deleted.segments.length; index += 1) {
    const previous = deleted.segments[(index - 1 + deleted.segments.length) % deleted.segments.length];
    if (previous.endAnchorId !== deleted.segments[index].startAnchorId) seams.push(index);
  }
  assert.deepEqual(seams, [0]);
  for (let index = 1; index < deleted.segments.length; index += 1) {
    assert.equal(deleted.segments[index - 1].endAnchorId, deleted.segments[index].startAnchorId);
  }

  const table = createCurveArcTable(sampleCubicBezierPath(deleted));
  assert.deepEqual(table.segmentIds, ['segment-4', 'segment-5', 'segment-6', 'segment-1']);
  const original = createCurveArcTable(sampleCubicBezierPath(loop));
  for (let index = 0; index < table.segmentIds.length; index += 1) {
    const id = table.segmentIds[index];
    const [start, end] = table.segmentRange(id);
    if (index > 0) {
      // Chained, not membership-derived: no unowned sliver at a joint.
      assert.equal(start, table.segmentRange(table.segmentIds[index - 1])[1]);
    }
    const [wasStart, wasEnd] = original.segmentRange(id);
    assert.ok(Math.abs((end - start) - (wasEnd - wasStart)) < 1e-9);
  }
  assert.equal(table.segmentRange(table.segmentIds.at(-1))[1], table.totalLength);

  // Closing it back up produces exactly one seam: the wrap-around segment.
  const reclosed = closeCubicBezierPath(deleted);
  assert.equal(reclosed.closed, true);
  assert.equal(reclosed.segments.length, reclosed.anchors.length);
  const wrap = reclosed.segments.at(-1);
  assert.equal(wrap.startAnchorId, reclosed.anchors.at(-1).id);
  assert.equal(wrap.endAnchorId, reclosed.anchors[0].id);
  assert.ok(!reclosed.segments.slice(0, -1).some(({ id }) => id === wrap.id));
});

test('deleting an anchor leaves every surviving segment geometrically identical', () => {
  const loop = hexagonLoop();
  const deleted = deleteCubicBezierAnchor(loop, 'anchor-3');

  for (const anchor of deleted.anchors) {
    const original = loop.anchors.find(({ id }) => id === anchor.id);
    assert.deepEqual(anchor.position, original.position);
  }
  for (const segment of deleted.segments) {
    const original = loop.segments.find(({ id }) => id === segment.id);
    assert.deepEqual(segment, original);
    assert.deepEqual(
      controlPointsForSegment(deleted, segment.id),
      controlPointsForSegment(loop, segment.id),
    );
  }
});

test('a feature on an unaffected segment still resolves after the delete', () => {
  const loop = hexagonLoop();
  const hosted = normalizeConstructionPath({
    ...loop,
    features: [{ id: 'door-1', kind: 'door', segmentId: 'segment-5', arcFraction: 0.4 }],
  });

  const deleted = deleteCubicBezierAnchor(hosted, 'anchor-3');
  assert.equal(deleted.features.length, 1);
  assert.equal(deleted.features[0].segmentId, 'segment-5');
  assert.equal(deleted.features[0].arcFraction, 0.4);

  const before = createCurveArcTable(sampleCubicBezierPath(hosted));
  const after = createCurveArcTable(sampleCubicBezierPath(deleted));
  const fromBefore = before.frameAt(before.toArc('segment-5', 0.4));
  const fromAfter = after.frameAt(after.toArc('segment-5', 0.4));
  assert.ok(Math.hypot(fromBefore.x - fromAfter.x, fromBefore.z - fromAfter.z) < 1e-6);
});
