import assert from 'node:assert/strict';
import test from 'node:test';
import { createCubicBezierPathFromStroke } from '../src/editor/construction/curve/CubicBezierPath.js';
import {
  SNAP_ACQUIRE_PIXELS,
  SNAP_RELEASE_PIXELS,
  resolveAnchorSnap,
  snapRadiiFor,
} from '../src/editor/construction/curve/CurveSnapping.js';

/** Phase 11 §5.3: screen-space snap radii and acquire/release hysteresis. */

const wall = (points, prefix) => createCubicBezierPathFromStroke(points, {
  simplifyTolerance: 0.01,
  anchorPrefix: `${prefix}-anchor`,
  segmentPrefix: `${prefix}-segment`,
});

// The dragged wall's free end sits at (0, 0); two other walls end nearby.
const dragged = wall([[-10, 0], [-5, 0], [0, 0]], 'dragged');
const draggedEnd = dragged.anchors.at(-1).id;
const others = [
  { constructionId: 'a', path: wall([[1, 0], [6, 0], [12, 0]], 'a') },
  { constructionId: 'b', path: wall([[1.6, 0.4], [6, 4], [12, 8]], 'b') },
];

function snapAt(x, z, extra = {}) {
  return resolveAnchorSnap({
    candidate: { x, z },
    path: dragged,
    anchorId: draggedEnd,
    others,
    gridSize: null,
    ...extra,
  });
}

test('snap radii are a fixed screen distance at every zoom', () => {
  const close = snapRadiiFor(0.01);
  const far = snapRadiiFor(0.2);
  assert.ok(Math.abs(close.worldRadius - SNAP_ACQUIRE_PIXELS * 0.01) < 1e-9);
  assert.ok(Math.abs(far.worldRadius - SNAP_ACQUIRE_PIXELS * 0.2) < 1e-9);
  assert.ok(far.releaseRadius > far.worldRadius, 'release is wider than acquire');
  assert.ok(Math.abs(far.releaseRadius / far.worldRadius - SNAP_RELEASE_PIXELS / SNAP_ACQUIRE_PIXELS) < 1e-9);
  assert.equal(snapRadiiFor(0).worldRadius, 0.75, 'an unknown scale keeps the old radius');
  assert.ok(snapRadiiFor(10).worldRadius <= 8, 'bounded at extreme zoom');
});

test('from far away the same pointer offset still acquires the endpoint', () => {
  const pointer = [1.9, 0.1];
  assert.notEqual(snapAt(...pointer, snapRadiiFor(0.01))?.kind, 'anchor', 'close up, 0.3 m is far');
  const far = snapAt(...pointer, snapRadiiFor(0.15));
  assert.equal(far?.kind, 'anchor');
});

test('a held target survives inside the release band, then lets go', () => {
  const radii = { worldRadius: 0.6, releaseRadius: 1.2 };
  const held = snapAt(1.2, 0, radii);
  assert.equal(held.constructionId, 'a');
  // Now nearer wall b's endpoint, but still inside a's release radius.
  const kept = snapAt(1.55, 0.35, { ...radii, held });
  assert.equal(kept.constructionId, 'a', 'no flicker to the other endpoint');
  assert.deepEqual(kept.position, held.position);
  // Without hysteresis the nearer endpoint wins.
  assert.equal(snapAt(1.55, 0.35, radii).constructionId, 'b');
  // Past the release radius the hold ends.
  const released = snapAt(2.4, 1.0, { ...radii, held });
  assert.notEqual(released?.constructionId, 'a');
});

test('a stronger snap takes over inside the band; Ctrl drops it at once', () => {
  const radii = { worldRadius: 0.6, releaseRadius: 1.5 };
  const onCurve = snapAt(4, 0.3, radii);
  assert.equal(onCurve.kind, 'curve');
  const endpoint = snapAt(1.3, 0.1, { ...radii, held: onCurve });
  assert.equal(endpoint.kind, 'anchor', 'an explicit join outranks a held centreline');
  assert.equal(snapAt(1.2, 0, { ...radii, held: endpoint, enabled: false }), null);
});
