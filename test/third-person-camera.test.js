import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createThirdPersonCameraSettings,
  ThirdPersonCamera,
} from '../src/editor/player/ThirdPersonCamera.js';
import {
  CAMERA_VIEW_THIRD,
  ViewModeController,
} from '../src/editor/player/ViewModeController.js';
import { PLAYER_MODE_WALK } from '../src/editor/player/playerConstants.js';

function status() {
  return {
    position: { x: 0, y: 1.7, z: 0 },
    footY: 0,
    yaw: 0,
    pitch: 0,
  };
}

test('third-person camera validates resolved settings', () => {
  assert.throws(
    () => createThirdPersonCameraSettings({ occlusionSamples: 0 }),
    /occlusionSamples/,
  );
  assert.throws(
    () => createThirdPersonCameraSettings({ distance: 0.5 }),
    /minDistance must not exceed distance/,
  );
});

test('third-person camera reaches the configured boom on flat ground', () => {
  const view = new ThirdPersonCamera({
    terrain: { heightAt: () => 0 },
    fovDegrees: 68,
    farPlane: 5000,
  });

  view.update(0, status());

  assert.ok(Math.abs(view.camera.position.z - view.settings.distance) < 1e-6);
  assert.ok(Math.abs(view.camera.position.x - view.settings.shoulder) < 1e-6);
});

test('third-person camera detects an obstruction between clear endpoints', () => {
  const terrain = {
    heightAt: (_x, z) => (z >= 1.45 && z <= 2.05 ? 2 : 0),
  };
  const view = new ThirdPersonCamera({
    terrain,
    fovDegrees: 68,
    farPlane: 5000,
  });

  view.update(0, status());

  assert.ok(
    view.camera.position.z < 1.45,
    `camera passed through the bank to z=${view.camera.position.z}`,
  );
});

test('third-person camera detects minimum-width construction ribbons', () => {
  const terrain = {
    heightAt: (_x, z) => (z >= 1.62 && z <= 1.72 ? 2 : 0),
  };
  const view = new ThirdPersonCamera({
    terrain,
    fovDegrees: 68,
    farPlane: 5000,
  });

  view.update(0, status());

  assert.ok(
    view.camera.position.z < 1.62,
    `camera skipped the narrow wall and reached z=${view.camera.position.z}`,
  );
});

test('third-person occlusion follows the shoulder-offset path', () => {
  const terrain = {
    heightAt: (x, z) => (x > 0.15 && z >= 1.4 && z <= 2.1 ? 2 : 0),
  };
  const view = new ThirdPersonCamera({
    terrain,
    fovDegrees: 68,
    farPlane: 5000,
  });

  view.update(0, status());

  assert.ok(
    view.camera.position.z < 1.4,
    `camera ignored shoulder-path obstruction and reached z=${view.camera.position.z}`,
  );
});

test('third-person view follows the player camera far range', () => {
  const thirdPersonCamera = new ThirdPersonCamera({
    terrain: { heightAt: () => 0 },
    fovDegrees: 68,
    farPlane: 5000,
  });
  const controller = Object.create(ViewModeController.prototype);
  controller.mode = PLAYER_MODE_WALK;
  controller.cameraView = CAMERA_VIEW_THIRD;
  controller.thirdPersonCamera = thirdPersonCamera;
  controller.playerController = { camera: { far: 24000 } };

  const activeCamera = controller.camera;

  assert.equal(activeCamera, thirdPersonCamera.camera);
  assert.equal(activeCamera.far, 24000);
});

test('a lifted camera sits above the boom and tilts down to keep the pivot in aim', () => {
  const flat = { heightAt: () => 0 };
  const level = new ThirdPersonCamera({ terrain: flat, fovDegrees: 52, farPlane: 5000, config: { distance: 4, pivotHeight: 1, shoulder: 0 } });
  const lifted = new ThirdPersonCamera({ terrain: flat, fovDegrees: 52, farPlane: 5000, config: { distance: 4, pivotHeight: 1, shoulder: 0, lift: 0.5 } });
  level.update(1 / 60, status());
  lifted.update(1 / 60, status());
  assert.ok(Math.abs(lifted.camera.position.y - level.camera.position.y - 0.5) < 1e-9);
  assert.ok(Math.abs(lifted.camera.rotation.x + Math.atan2(0.5, 4)) < 1e-9, 'pitched down by atan(lift / boom)');
  // Aimed at the pivot (0, 1, 0): the view ray passes through it.
  const forward = lifted.camera.getWorldDirection(lifted.camera.position.clone());
  const toPivot = { x: -lifted.camera.position.x, y: 1 - lifted.camera.position.y, z: -lifted.camera.position.z };
  const length = Math.hypot(toPivot.x, toPivot.y, toPivot.z);
  assert.ok(Math.abs(forward.y - toPivot.y / length) < 1e-6);
  assert.throws(() => createThirdPersonCameraSettings({ lift: -1 }), /lift/);
});

test('third-person camera takes its own lens when configured', () => {
  const follow = new ThirdPersonCamera({ terrain: { heightAt: () => 0 }, fovDegrees: 68, farPlane: 5000 });
  assert.equal(follow.camera.fov, 68);
  const own = new ThirdPersonCamera({
    terrain: { heightAt: () => 0 }, fovDegrees: 68, farPlane: 5000, config: { fovDegrees: 45 },
  });
  assert.equal(own.camera.fov, 45);
  assert.throws(() => createThirdPersonCameraSettings({ fovDegrees: 180 }), /fovDegrees/);
});
