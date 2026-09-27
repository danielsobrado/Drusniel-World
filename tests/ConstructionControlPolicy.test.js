import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GRID_SIZE,
  adjustDelta,
  motionPrecision,
  resolveAnchorSnap,
  snappedValue,
  snappingEnabled,
} from '../src/editor/construction/curve/CurveSnapping.js';
import {
  EditorController,
  anchorSnapOptions,
  applyCutFeatures,
  constructionsNear,
} from '../src/editor/EditorController.js';
import { ConstructionStore } from '../src/editor/construction/ConstructionStore.js';
import { normalizeConstructionRecord } from '../src/editor/construction/ConstructionSchema.js';
import { createCurveArcTable } from '../src/editor/construction/masonry/CurveArcTable.js';
import {
  createCubicBezierPathFromStroke,
  sampleCubicBezierPath,
} from '../src/editor/construction/curve/CubicBezierPath.js';

/**
 * The wall tool's control policy, held in one place.
 *
 * The phase 11 findings that live here are 1, 3 and 5: the tool must stay in
 * draw mode after a committed stroke, a cut must show its opening before
 * release, and one modifier must not mean two opposite things. The gestures
 * belong to browser-coupled controllers, so this pins the policy they read —
 * the pure helpers each handler calls — and drives the two pointer handlers
 * through a prototype object, the way `ConstructionCutArming` already does.
 */

/** Step arithmetic lands on binary fractions, so compare with a tolerance. */
function close(actual, expected, message = undefined) {
  assert.ok(
    Math.abs(actual - expected) < 1e-12,
    message ?? `expected ${expected}, got ${actual}`,
  );
}

/**
 * A nearly straight wall that still keeps three segments. Perfectly collinear
 * points are simplified away, which would leave one segment and hide any
 * placement mistake behind a degenerate arc domain.
 */
function straightWall(id, { length = 24, z = 0 } = {}) {
  return normalizeConstructionRecord({
    version: 1,
    id,
    revision: 1,
    seed: 5,
    kind: 'wall',
    style: { key: 'coursed-rubble', version: 1 },
    dimensions: { height: 3.5, thickness: 0.8 },
    path: createCubicBezierPathFromStroke([
      [0, z], [length / 3, z + 0.01], [(length * 2) / 3, z - 0.01], [length, z],
    ], { simplifyTolerance: 0.001 }),
    features: [],
  });
}

/** An arc table matching a record, as `ConstructionView.arcTableFor` returns. */
function arcTableFor(record) {
  return createCurveArcTable(sampleCubicBezierPath(record.path));
}

/**
 * An `EditorController` carrying only what a pointer gesture touches, so the
 * real handler code runs without a renderer, terrain or DOM behind it.
 */
function pointerEditor({ store, view }) {
  const editor = Object.create(EditorController.prototype);
  editor.constructionStore = store;
  editor.constructionView = view;
  editor.constructionMode = 'draw';
  editor.constructionHeight = 2.4;
  editor.constructionThickness = 0.6;
  editor.constructionOpening = { kind: null, profile: 'round', dressed: true };
  editor.constructionStepSnap = false;
  editor.constructionStroke = null;
  editor.constructionDrawing = false;
  editor.constructionAnchorDrag = null;
  editor.constructionCutStroke = false;
  editor.constructionCutArmed = false;
  editor.selectedConstructionId = null;
  editor.selectedAnchorId = null;
  editor.selectedObjectId = null;
  editor.hoveredArc = null;
  editor.pendingTopEdit = null;
  editor.pendingTopEditTimer = null;
  editor.undoStack = [];
  editor.redoStack = [];
  editor.emitState = () => {};
  editor.emitMap = () => {};
  editor.emitNotice = () => {};
  editor.canvas = {
    setPointerCapture: () => {},
    hasPointerCapture: () => true,
    releasePointerCapture: () => {},
  };
  return editor;
}

/** A view that records drafts instead of building geometry. */
function draftView(mutations = { drafts: [] }) {
  return {
    drafts: mutations.drafts,
    setDraft(record, options) {
      mutations.drafts.push({ record, options });
    },
    clearDraft() {},
    setSelection() {},
    arcTableFor: () => null,
  };
}

test('Ctrl is one snapping predicate: anchors and handles read the same rule', () => {
  assert.equal(snappingEnabled({ ctrlKey: true }), false);
  assert.equal(snappingEnabled({ ctrlKey: false }), true);
  assert.equal(snappingEnabled({}), true, 'snapping is on by default');

  // The anchor drag feeds it straight into the resolver: a collinear
  // straightening, which no grid is involved in.
  const path = createCubicBezierPathFromStroke([[0, 0], [5, 0.3], [10, 0]], {
    simplifyTolerance: 0.01,
  });
  const anchorId = path.anchors[1].id;
  const candidate = { x: 5, z: 0.3 };
  assert.equal(resolveAnchorSnap({
    candidate, path, anchorId, ...anchorSnapOptions(false, {}),
  }).kind, 'straight');
  assert.equal(resolveAnchorSnap({
    candidate, path, anchorId, enabled: snappingEnabled({ ctrlKey: true }),
  }), null);

  // And both handles read it, for a step that is on.
  close(adjustDelta(1.06, {}, { step: 0.1 }), 1.1);
  close(
    adjustDelta(1.06, { ctrlKey: true }, { step: 0.1 }),
    1.06,
    'Ctrl must suppress the step, not switch it on',
  );
  close(snappedValue(0.83, {}, 0.1), 0.8);
  close(snappedValue(0.83, { ctrlKey: true }, 0.1), 0.83);
});

test('Shift still yields finer motion under the height and thickness handles', () => {
  assert.equal(motionPrecision({}, 0.2), 1);
  assert.equal(motionPrecision({ shiftKey: true }, 0.2), 0.2);

  // Height: 10 px of drag at 0.02 m/px is 0.2 m, and 0.04 m under Shift.
  close(adjustDelta(10 * 0.02, {}, { precisionMultiplier: 0.2 }), 0.2);
  close(adjustDelta(10 * 0.02, { shiftKey: true }, { precisionMultiplier: 0.2 }), 0.04);

  // Thickness: the same factor, and it still scales a quantised value.
  close(snappedValue(1 + 0.4 * 0.25, { shiftKey: true }, null), 1.1);
  close(snappedValue(1 + 0.4, {}, null), 1.4);
  close(snappedValue(1.44, {}, 0.1), 1.4);
  close(snappedValue(1.44, { shiftKey: true }, 0.1), 1.4, 'Shift does not undo the step');
});

test('grid snapping is opt-in, and Ctrl suppresses it like every other snap', () => {
  // A candidate on the 0.5 m grid, far from every anchor, curve and bearing
  // this path can offer — so only the grid branch could answer it.
  const path = createCubicBezierPathFromStroke([[0, 0], [6, 4], [13, -2], [20, 3]], {
    simplifyTolerance: 0.01,
  });
  const anchorId = path.anchors.at(-1).id;
  const candidate = { x: 35, z: 8.5 };
  const resolve = (options) => resolveAnchorSnap({ candidate, path, anchorId, ...options });

  // What the wall tool runs with: free placement until the toggle asks.
  assert.deepEqual(anchorSnapOptions(false, {}), { enabled: true, gridSize: null });
  assert.equal(resolve(anchorSnapOptions(false, {})), null, 'the grid is not implicit');
  const grid = resolve(anchorSnapOptions(true, {}));
  assert.deepEqual(anchorSnapOptions(true, {}), { enabled: true, gridSize: GRID_SIZE });
  assert.equal(grid.kind, 'grid');
  assert.deepEqual(grid.position, [35, 8.5]);

  assert.deepEqual(
    anchorSnapOptions(true, { ctrlKey: true }),
    { enabled: false, gridSize: null },
    'Ctrl suppresses the grid too',
  );
  assert.equal(resolve(anchorSnapOptions(true, { ctrlKey: true })), null);
  assert.equal(resolve({ gridSize: GRID_SIZE, enabled: snappingEnabled({ ctrlKey: true }) }), null);
});

test('a T-junction takes the nearest centreline, with stable ids breaking ties', () => {
  const path = createCubicBezierPathFromStroke([[0, 0], [6, 4], [13, -2], [20, 3]], {
    simplifyTolerance: 0.01,
  });
  const anchorId = path.anchors.at(-1).id;
  const far = createCubicBezierPathFromStroke([[0, 20.6], [20, 20.6]], {
    simplifyTolerance: 0.01,
  });
  const near = createCubicBezierPathFromStroke([[0, 20.3], [20, 20.3]], {
    simplifyTolerance: 0.01,
  });
  const candidate = { x: 10, z: 20.4 };

  const nearest = resolveAnchorSnap({
    candidate,
    path,
    anchorId,
    // The far wall is listed first: first-acceptable would pick it.
    others: [{ constructionId: 'construction-9', path: far }],
  });
  assert.equal(nearest.kind, 'curve');
  assert.equal(nearest.constructionId, 'construction-9');

  const ranked = resolveAnchorSnap({
    candidate,
    path,
    anchorId,
    others: [
      { constructionId: 'construction-9', path: far },
      { constructionId: 'construction-2', path: near },
    ],
  });
  assert.equal(ranked.constructionId, 'construction-2');
  assert.ok(Math.abs(ranked.position[1] - 20.3) < 1e-6);

  // Equal distance: the ids decide, so the answer cannot depend on the order
  // the store happened to list the walls in.
  const left = createCubicBezierPathFromStroke([[0, 20.6], [20, 20.6]], { simplifyTolerance: 0.01 });
  const right = createCubicBezierPathFromStroke([[0, 20.2], [20, 20.2]], { simplifyTolerance: 0.01 });
  const tie = resolveAnchorSnap({
    candidate,
    path,
    anchorId,
    others: [
      { constructionId: 'construction-9', path: left },
      { constructionId: 'construction-2', path: right },
    ],
  });
  assert.equal(tie.constructionId, 'construction-2');
});

test('drawing several walls never needs a trip back to draw mode', () => {
  const store = new ConstructionStore();
  const drafts = [];
  const editor = pointerEditor({ store, view: draftView({ drafts }) });
  let pointer = { x: 0, z: 0 };
  editor.pickCanonicalConstructionPoint = () => ({ ...pointer });

  const dragWall = (from, to) => {
    pointer = { ...from };
    editor.onConstructionPointerDown({ pointerId: 1, button: 0 });
    assert.equal(editor.constructionDrawing, true, 'a ground drag must start a stroke');
    for (let step = 1; step <= 8; step += 1) {
      const t = step / 8;
      pointer = { x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t };
      editor.onConstructionPointerMove({ pointerId: 1 });
    }
    editor.onConstructionPointerUp({ pointerId: 1 });
  };

  dragWall({ x: 0, z: 0 }, { x: 6, z: 0 });
  assert.equal(editor.constructionMode, 'draw', 'the tool stays in draw mode');
  assert.equal(editor.selectedConstructionId, 'construction-1', 'the new wall is selected');
  dragWall({ x: 0, z: 3 }, { x: 6, z: 3 });

  assert.equal(store.size, 2, 'the second drag drew a wall instead of editing the first');
  assert.equal(editor.constructionMode, 'draw');
  assert.equal(editor.selectedConstructionId, 'construction-2');
  assert.equal(editor.undoStack.length, 2, 'one history entry per stroke');
});

test('an edit-mode selection is still available after drawing', () => {
  const editor = pointerEditor({ store: new ConstructionStore(), view: draftView() });
  editor.objectMap = { getById: () => null };
  editor.objectView = { setSelection: () => {} };
  editor.updatePreviews = () => {};

  editor.selectConstructionMode('edit');
  assert.equal(editor.constructionMode, 'edit');
  editor.selectConstructionMode('draw');
  assert.equal(editor.constructionMode, 'draw');
});

test('a cut stroke previews its opening during the drag and mutates no masonry', () => {
  const record = straightWall('construction-1');
  const arcTable = arcTableFor(record);
  const drafts = [];
  let writes = 0;
  const editor = pointerEditor({
    store: {
      list: () => [record],
      get: () => record,
      update: () => { writes += 1; },
    },
    view: { ...draftView({ drafts }), arcTableFor: () => arcTable },
  });
  editor.constructionCutStroke = true;
  editor.constructionDrawing = true;
  editor.constructionStroke = [{ x: 12, z: -4 }, { x: 12, z: 0 }];
  editor.pickCanonicalConstructionPoint = () => ({ x: 12, z: 2.5 });

  editor.onConstructionPointerMove({ pointerId: 1 });

  assert.equal(writes, 0, 'the drag must not write to the store');
  assert.equal(record.features.length, 0, 'the preview is a copy, not the record');
  assert.equal(drafts.length, 1, 'the drag must show a draft');
  const [{ record: draft, options }] = drafts;
  assert.equal(options.constructionId, 'construction-1');
  assert.equal(draft.features.length, 1);
  const [opening] = draft.features;
  assert.equal(opening.kind, 'arch');
  assert.ok(opening.width > 0.5, `the arcade gap needs a width, got ${opening.width}`);
  assert.ok(opening.height > 0.5);
  const s = arcTable.toArc(opening.segmentId, opening.arcFraction);
  assert.ok(Math.abs(s - 12) < 0.5, `the gap must appear where the stroke crossed, got s=${s}`);
});

test('the opening previewed during the drag is the one the release commits', () => {
  const store = new ConstructionStore([straightWall('construction-1')]);
  const arcTable = arcTableFor(store.get('construction-1'));
  const drafts = [];
  const editor = pointerEditor({
    store,
    view: { ...draftView({ drafts }), arcTableFor: () => arcTable },
  });
  editor.constructionCutStroke = true;
  editor.constructionDrawing = true;
  editor.constructionStroke = [{ x: 12, z: -4 }, { x: 12, z: 0 }];
  editor.pickCanonicalConstructionPoint = () => ({ x: 12, z: 2.5 });

  editor.onConstructionPointerMove({ pointerId: 1 });
  const [previewed] = drafts[0].record.features;

  editor.onConstructionPointerUp({ pointerId: 1 });

  const [committed] = store.get('construction-1').features;
  assert.ok(committed, 'the release must carve the opening');
  assert.deepEqual(
    [committed.id, committed.segmentId, committed.arcFraction, committed.kind, committed.width],
    [previewed.id, previewed.segmentId, previewed.arcFraction, previewed.kind, previewed.width],
  );
});

test('applyCutFeatures copies the record and reports the segments it dirties', () => {
  const record = straightWall('construction-1');
  const [cut] = [{
    constructionId: 'construction-1',
    segmentId: record.path.segments[1].id,
    arcFraction: 0.5,
    kind: 'arch',
    width: 2.2,
    height: 2.5,
  }];

  const { record: after, dirtySegmentIds } = applyCutFeatures(record, [cut], {
    styleFor: (entry) => ({ kind: entry.kind, height: entry.height, sill: 0, profile: 'round', dressed: true }),
  });

  assert.notEqual(after, record);
  assert.equal(record.features.length, 0, 'the input record is never written');
  assert.equal(after.features.length, 1);
  assert.equal(after.features[0].segmentId, cut.segmentId);
  assert.equal(after.path.features, after.features, 'features live on the path too');
  assert.deepEqual(dirtySegmentIds, [cut.segmentId]);
});

test('constructionsNear offers only the walls a cut stroke can reach, nearest first', () => {
  const records = [
    straightWall('construction-1'),
    straightWall('construction-9', { z: 2.5 }),
    straightWall('construction-2', { z: 40 }),
  ];

  // A cut that crosses the first wall and stops short of the second: the wall it
  // crosses is nearer to the stroke than the one it only approaches.
  assert.deepEqual(
    constructionsNear(records, [{ x: 12, z: -4 }, { x: 12, z: 2.3 }])
      .map(({ record }) => record.id),
    ['construction-1', 'construction-9'],
  );

  // Reaching past both leaves the rectangles tied, so the tip decides.
  assert.deepEqual(
    constructionsNear(records, [{ x: 12, z: -4 }, { x: 12, z: 2.6 }])
      .map(({ record }) => record.id),
    ['construction-9', 'construction-1'],
  );

  assert.deepEqual(constructionsNear(records, []), []);
});
