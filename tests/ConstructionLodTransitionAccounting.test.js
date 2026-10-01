import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { ConstructionStore } from '../src/editor/construction/ConstructionStore.js';
import { normalizeConstructionRecord } from '../src/editor/construction/ConstructionSchema.js';
import { createCubicBezierPathFromStroke } from '../src/editor/construction/curve/CubicBezierPath.js';
import { planConstruction } from '../src/editor/construction/planning/ConstructionPlanner.js';
import { disposeConstructionMaterials } from '../src/editor/construction/render/ConstructionMaterials.js';
import { ConstructionView } from '../src/editor/construction/render/ConstructionView.js';

/** Wall handoff §4B: a transition is counted once, not once per waiting frame. */

const VIEWPORT_HEIGHT = 600;

test.afterEach(() => disposeConstructionMaterials());

test('frames spent waiting for a queued build are not new transition starts', () => {
  const store = new ConstructionStore();
  const view = new ConstructionView({
    terrainView: {
      scene: new THREE.Scene(),
      floatingOrigin: { toRender: (x, z) => ({ x, z }), toCanonical: (x, z) => ({ x, z }) },
      getCanonicalHeight: () => 0,
      renderer: { domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: VIEWPORT_HEIGHT }) } },
    },
    store,
    compilerClient: null,
  });
  const record = store.add(normalizeConstructionRecord({
    version: 1, id: 'construction-1', revision: 1, seed: 4, kind: 'wall',
    style: { key: 'rounded-fieldstone', version: 1 },
    dimensions: { height: 3.5, thickness: 0.8 },
    top: { style: 'flat' },
    path: createCubicBezierPathFromStroke([[0, 0], [8, 2], [16, 0], [24, 2], [32, 0], [40, 0]], { simplifyTolerance: 0.01 }),
    features: [],
  }));
  const plan = planConstruction(record);
  view.applyPlan(record, plan);
  const camera = new THREE.PerspectiveCamera(60, 800 / VIEWPORT_HEIGHT, 0.1, 1000);
  camera.position.set(20, 6, 26);
  camera.lookAt(20, 1.5, 0);
  camera.updateMatrixWorld();

  // Classify repeatedly without draining the build queue.
  for (let frame = 0; frame < 6; frame += 1) view.updateLod(camera, VIEWPORT_HEIGHT);
  const started = view.stats.lodTransitionsStarted;
  assert.ok(started > 0 && started <= plan.modules.length, `${started} starts for ${plan.modules.length} modules`);
  assert.ok(view.stats.lodTransitionWaitFrames > 0, 'waiting frames are reported separately');

  // Draining the queue completes each started transition exactly once.
  for (let frame = 0; frame < plan.modules.length * 3; frame += 1) {
    view.update();
    view.updateLod(camera, VIEWPORT_HEIGHT);
  }
  assert.equal(view.stats.queueDepth, 0);
  assert.equal(view.stats.lodTransitionsStarted, view.stats.lodTransitionsCompleted);
  view.dispose();
});
