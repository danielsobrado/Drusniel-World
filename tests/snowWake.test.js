import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { float, uniform, uv, vec3 } from 'three/tsl';
import {
  SNOW_WAKE_BERM_SHARE,
  SNOW_WAKE_LIFETIME,
  SNOW_WAKE_MAX_DEPTH,
  SNOW_WAKE_MAX_WIDTH,
  SnowWakeSpine,
  wakeCrossSection,
  wakeDepthForSpeed,
  wakeFade,
  wakeSurfaceAt,
  wakeWidthForSpeed,
} from '../src/editor/stylized/deformation/snowWakeMath.js';
import {
  createSnowWakeShading,
  createSnowWakeState,
} from '../src/editor/stylized/deformation/SnowWakeShading.js';

test('the spine drops old points and keeps a bounded count', () => {
  // A run has no end, so the trail must: once the ring is full the oldest sample
  // has to fall off the back or the spine grows without bound.
  const spine = new SnowWakeSpine({ capacity: 8, step: 0.1 });
  for (let i = 0; i < 40; i += 1) {
    spine.update(i * 0.05, i * 0.1, 0, 0, { rightX: 1, rightZ: 0, strength: 1, speed: 5 });
  }
  assert.equal(spine.count, 8);
  assert.ok(spine.count <= spine.capacity);
  const kept = Array.from({ length: spine.count }, (_, order) => spine.x[spine.indexAt(order)]);
  // The origin was laid first and has been overwritten: every kept sample is far
  // from it, so the trail is the recent stretch only.
  assert.ok(Math.min(...kept) > 1, `oldest kept sample should have moved on, got ${Math.min(...kept)}`);

  for (let i = 40; i < 400; i += 1) {
    spine.update(i * 0.05, i * 0.1, 0, 0, { rightX: 1, rightZ: 0, strength: 1, speed: 5 });
  }
  assert.equal(spine.count, 8, 'the count stays capped however long the run');
});

test('a stationary body lays no trail and a moving one does', () => {
  // A body standing still presses the snow it stands on, but it leaves no path,
  // so it must not stamp a wake. Only travel commits samples.
  const still = new SnowWakeSpine({ capacity: 16, step: 0.3 });
  for (let i = 0; i < 20; i += 1) {
    still.update(i, 5, 0, 5, { rightX: 1, rightZ: 0, strength: 1, speed: 0 });
  }
  assert.equal(still.count, 1, 'standing still commits only the seed sample');
  assert.equal(wakeSurfaceAt(still, 5, 5, { speed: 5, clock: 20 }), 0);

  const moving = new SnowWakeSpine({ capacity: 16, step: 0.3 });
  for (let i = 0; i < 20; i += 1) {
    moving.update(i, i * 0.3, 0, 0, { rightX: 1, rightZ: 0, strength: 1, speed: 5 });
  }
  assert.ok(moving.count > 2, 'travel commits a trail');
  const depth = wakeDepthForSpeed(5);
  const onTrail = wakeSurfaceAt(moving, 3, 0, { speed: 5, clock: 20 });
  assert.ok(onTrail < 0, 'the trail is cut into the snow');
  assert.ok(Math.abs(onTrail) > 0);
  assert.ok(Math.abs(onTrail) <= depth + 1e-9);
  // Away from the trail there is nothing to see.
  assert.equal(wakeSurfaceAt(moving, 60, 60, { speed: 5, clock: 20 }), 0);
});

test('the profile is deepest at the cut, zero outside the banks, and symmetric', () => {
  const depth = SNOW_WAKE_MAX_DEPTH;
  const width = 0.9;
  assert.equal(wakeCrossSection(0, depth, width), -depth, 'the cut centre is the deepest point');
  assert.equal(wakeCrossSection(width, depth, width), 0, 'the outer edge is untouched');
  assert.equal(wakeCrossSection(width * 2, depth, width), 0, 'past the banks stays flat');

  let deepest = Number.POSITIVE_INFINITY;
  let highest = Number.NEGATIVE_INFINITY;
  for (let lateral = -2; lateral <= 2.0001; lateral += 0.01) {
    const value = wakeCrossSection(lateral, depth, width);
    deepest = Math.min(deepest, value);
    highest = Math.max(highest, value);
    assert.equal(value, wakeCrossSection(-lateral, depth, width), 'the profile mirrors across the spine');
  }
  assert.equal(deepest, -depth, 'nothing is deeper than the cut centre');
  assert.ok(highest > 0, 'the two berms rise above the surface');
  assert.ok(highest <= depth * SNOW_WAKE_BERM_SHARE + 1e-12, 'the berms stay tied to the cut depth');
});

test('depth and width rise with speed and saturate', () => {
  // A sprint must cut deeper than a walk, but the value has to be bounded or a
  // runaway speed would tunnel through the terrain.
  assert.equal(wakeDepthForSpeed(0), 0);
  assert.equal(wakeWidthForSpeed(0), 0);
  assert.ok(wakeDepthForSpeed(1) < wakeDepthForSpeed(6));
  assert.ok(wakeDepthForSpeed(6) < wakeDepthForSpeed(12));
  assert.ok(wakeWidthForSpeed(1) < wakeWidthForSpeed(12));
  assert.ok(wakeDepthForSpeed(1e6) <= SNOW_WAKE_MAX_DEPTH + 1e-9);
  assert.ok(wakeWidthForSpeed(1e6) <= SNOW_WAKE_MAX_WIDTH + 1e-9);
  assert.ok(wakeDepthForSpeed(1e6) - wakeDepthForSpeed(1e3) < 1e-3, 'depth is flat once saturated');
});

test('ageing returns the surface to flat and never past it', () => {
  assert.equal(wakeFade(0), 1);
  assert.equal(wakeFade(SNOW_WAKE_LIFETIME), 0);
  assert.equal(wakeFade(SNOW_WAKE_LIFETIME * 4), 0);
  assert.equal(wakeFade(1e9), 0, 'an old mark is exactly flat, never lifted');

  let previous = Number.POSITIVE_INFINITY;
  for (let age = 0; age <= SNOW_WAKE_LIFETIME * 1.5; age += SNOW_WAKE_LIFETIME / 64) {
    const fade = wakeFade(age);
    assert.ok(fade >= 0 && fade <= 1, 'a mark only ever settles toward flat');
    assert.ok(fade <= previous + 1e-12, 'settling is monotone');
    previous = fade;
  }

  const depth = SNOW_WAKE_MAX_DEPTH;
  const width = 0.8;
  for (let lateral = -1; lateral <= 1; lateral += 0.05) {
    // `=== 0` not `assert.equal`: a positive value times a zero fade is -0 for a
    // cut, and -0 === 0 already says "flat" (Object.is would not).
    assert.ok(
      wakeCrossSection(lateral, depth, width) * wakeFade(SNOW_WAKE_LIFETIME) === 0,
      'an aged profile is flat: neither a cut nor a bank is left',
    );
  }

  // And through the spine the surface the shader would draw ages to zero, not
  // past it: read the trail a whole lifetime after it was laid.
  const spine = new SnowWakeSpine({ capacity: 16, step: 0.3 });
  for (let i = 0; i < 10; i += 1) {
    spine.update(i, i * 0.3, 0, 0, { rightX: 1, rightZ: 0, strength: 1, speed: 5 });
  }
  assert.ok(wakeSurfaceAt(spine, 1.5, 0, { speed: 5, clock: 9 }) < 0, 'still a cut while fresh');
  assert.equal(wakeSurfaceAt(spine, 1.5, 0, { speed: 5, clock: 9 + SNOW_WAKE_LIFETIME }), 0);
});

test('the shading compiles to nothing when disabled', () => {
  // Off must remove the wake from the shader, not run it and multiply by zero.
  const shading = createSnowWakeShading({
    terrainUv: uv(),
    chunkWorldSize: 128,
    chunkCenter: uniform(new THREE.Vector2(1, 2)),
    snow: float(1),
    state: createSnowWakeState({ capacity: 8, step: 0.3 }),
    config: { enabled: false },
  });
  assert.equal(shading, null);
});

test('the enabled shading assembles against a live spine', () => {
  // Built in plain JavaScript so TSL API misuse fails here rather than as a
  // silent blank in the browser.
  const state = createSnowWakeState();
  state.record(0, 0, 0, 0, { rightX: 1, rightZ: 0, strength: 1, speed: 6 });
  state.record(1, 0.5, 0, 0.1, { rightX: 1, rightZ: 0, strength: 1, speed: 6 });
  state.sync(1);
  assert.equal(state.uniforms.count.value, 2);
  assert.equal(state.uniforms.points.array[0].z > 0, true, 'a moved sample carries a depth');

  const shading = createSnowWakeShading({
    terrainUv: uv(),
    chunkWorldSize: 128,
    chunkCenter: uniform(new THREE.Vector2(1, 2)),
    snow: float(1),
    state,
    config: { enabled: true },
  });
  assert.ok(shading, 'an enabled wake returns nodes');
  assert.ok(shading.height, 'it exposes a height offset');
  assert.ok(shading.apply(vec3(1, 1, 1)), 'it tints the snow colour');
});

test('the recorder lays a trail along the walk, banked across its heading', async () => {
  const { SnowWakeRecorder } = await import('../src/editor/stylized/deformation/SnowWakeRecorder.js');
  const recorder = new SnowWakeRecorder();
  for (let frame = 0; frame <= 60; frame += 1) {
    // Walking +x at 3 m/s.
    recorder.update(frame / 60, { x: frame * 0.05, y: 0, z: 10, grounded: true, inWater: false });
  }
  const { spine, uniforms } = recorder.state;
  assert.ok(spine.count >= 8, `samples ${spine.count}`);
  const newest = spine.indexAt(spine.count - 1);
  // Right of +x is -z in these axes; the banks lie across the path.
  assert.ok(Math.abs(spine.rightX[newest]) < 1e-6);
  assert.equal(Math.abs(spine.rightZ[newest]), 1);
  assert.ok(Math.abs(spine.speed[newest] - 3) < 0.3, `speed ${spine.speed[newest]}`);
  assert.equal(uniforms.count.value, spine.count);
  // The circle holds the whole trail and its banks.
  const b = uniforms.bounds.value;
  for (let order = 0; order < spine.count; order += 1) {
    const i = spine.indexAt(order);
    assert.ok(Math.hypot(spine.x[i] - b.x, spine.z[i] - b.y) + 0.5 < b.z);
  }
});

test('an airborne or swimming body leaves no profile, and nobody walking only ages it', async () => {
  const { SnowWakeRecorder } = await import('../src/editor/stylized/deformation/SnowWakeRecorder.js');
  const recorder = new SnowWakeRecorder();
  recorder.update(0, { x: 0, y: 0, z: 0, grounded: false, inWater: false });
  recorder.update(0.5, { x: 1, y: 0, z: 0, grounded: true, inWater: true });
  const { spine } = recorder.state;
  for (let order = 0; order < spine.count; order += 1) assert.equal(spine.strength[spine.indexAt(order)], 0);
  const before = spine.count;
  recorder.update(1, null);
  assert.equal(spine.count, before);
});
