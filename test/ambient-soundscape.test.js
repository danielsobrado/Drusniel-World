import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyFootstepSurface } from '../src/editor/audio/footstep_surface.js';
import { seaBearing, soundscapeWeights } from '../src/editor/audio/soundscape_weights.js';
import { AmbientSoundscape, panToward } from '../src/editor/audio/ambient_soundscape.js';
import { SampleBank } from '../src/editor/audio/sample_bank.js';

test('footfalls take their sound from water, snow, biome and beach', () => {
  const ground = { inWater: false, heightAboveSea: 40, snow: 0 };
  assert.equal(classifyFootstepSurface({ ...ground, inWater: true, tileId: 12 }), 'water');
  assert.equal(classifyFootstepSurface({ ...ground, tileId: 6, snow: 0.8 }), 'snow');
  assert.equal(classifyFootstepSurface({ ...ground, tileId: 12 }), 'mud');
  assert.equal(classifyFootstepSurface({ ...ground, tileId: 1 }), 'sand');
  assert.equal(classifyFootstepSurface({ ...ground, tileId: 2 }), 'gravel');
  assert.equal(classifyFootstepSurface({ ...ground, tileId: 13 }), 'gravel');
  assert.equal(classifyFootstepSurface({ ...ground, tileId: 6 }), 'leaves');
  assert.equal(classifyFootstepSurface({ ...ground, tileId: 4 }), 'grass');
  assert.equal(classifyFootstepSurface({ ...ground, tileId: 4, heightAboveSea: 0.6 }), 'sand');
});

const DAY = { heightAboveSea: 50, rain: 0, wind: 0.3, night: false, underwater: false };

test('the ground and water around the listener pick the beds', () => {
  const forest = soundscapeWeights({ ...DAY, tiles: [6, 6, 6, 6, 8, 4] });
  assert.ok(forest.forest > 0.9);
  assert.ok(forest.birds > 0.5);
  assert.equal(forest.wetland, 0);

  const marsh = soundscapeWeights({ ...DAY, tiles: [12, 12, 12, 4], water: [0, 2, 2, 0] });
  assert.ok(marsh.wetland > 0.9);
  assert.ok(marsh.lake > 0.5);
  assert.ok(marsh.frogs > 0);

  const peak = soundscapeWeights({ ...DAY, tiles: [11, 11, 11], heightAboveSea: 1400, wind: 1, snowCountry: 1 });
  assert.equal(peak.alpine, 1);
  assert.equal(peak.meadow, 0, 'snow country has its own wind');
  assert.equal(peak.birds, 0);

  const beach = soundscapeWeights({ ...DAY, tiles: [4, 4], water: [1, 1, 0, 0], heightAboveSea: 1 });
  assert.ok(beach.surf > 0.9 && beach.waves > 0.9 && beach.seagulls > 0.5);
  const cliff = soundscapeWeights({ ...DAY, tiles: [4, 4], water: [1, 1, 0, 0], heightAboveSea: 60 });
  assert.ok(cliff.surf > 0.9 && cliff.waves === 0, 'high above the sea, surf but no single waves');

  const jungle = soundscapeWeights({ ...DAY, tiles: [7, 7, 5, 5] });
  assert.ok(jungle.jungleDay > 0.9 && jungle.jungleCalls > 0.9);
  assert.ok(soundscapeWeights({ ...DAY, tiles: [7, 7], night: true }).jungleNight > 0.9);

  const river = soundscapeWeights({ ...DAY, tiles: [4], water: [3, 0, 0, 0] });
  assert.ok(river.stream > 0.5);
});

test('waves pan toward the sea', () => {
  const points = [{ dx: 0, dz: 0 }, { dx: 30, dz: 0 }, { dx: -30, dz: 0 }, { dx: 0, dz: 30 }];
  const bearing = seaBearing(points, [0, 1, 0, 0]);
  assert.deepEqual(bearing, { x: 1, z: 0 });
  assert.equal(seaBearing(points, [0, 0, 0, 0]), null);
  // Facing -z (yaw 0), east is to the right.
  assert.ok(panToward({ yaw: 0 }, bearing) > 0.99);
});

test('rain crossfades light to heavy and silences birds; night brings crickets', () => {
  const tiles = [4, 4, 6, 6];
  const light = soundscapeWeights({ ...DAY, tiles, rain: 0.25 });
  const heavy = soundscapeWeights({ ...DAY, tiles, rain: 1 });
  assert.equal(soundscapeWeights({ ...DAY, tiles }).rainLight, 0);
  assert.ok(light.rainLight > light.rainHeavy);
  assert.ok(heavy.rainHeavy > heavy.rainLight);
  assert.equal(heavy.birds, 0);

  const night = soundscapeWeights({ ...DAY, tiles, night: true });
  assert.equal(night.birds, 0);
  assert.ok(night.crickets > 0.5);

  const under = soundscapeWeights({ ...DAY, tiles, underwater: true });
  assert.ok(Object.values(under).every((weight) => weight === 0));
});

function fakeAudio() {
  const param = (value) => ({ value });
  const node = () => ({ connect() {}, disconnect() {} });
  const started = [];
  const context = {
    createGain: () => ({ ...node(), gain: param(1) }),
    createStereoPanner: () => ({ ...node(), pan: param(0) }),
    createBufferSource: () => ({
      ...node(),
      playbackRate: param(1),
      start() { started.push(this); },
      stop() {},
    }),
    decodeAudioData: async () => ({ duration: 10 }),
  };
  return { context, started };
}

test('beds fade toward their weights and the fall roar follows distance', async () => {
  const { context, started } = fakeAudio();
  const bank = new SampleBank({ getContext: () => context, getDestination: () => ({}), fetchBytes: async () => new ArrayBuffer(8) });
  const soundscape = new AmbientSoundscape({ bank, getContext: () => context, getDestination: () => ({ connect() {} }), random: () => 0.5 });
  const weights = soundscapeWeights({ ...DAY, tiles: [6, 6, 6, 6] });
  const listener = { x: 0, z: 0, yaw: 0 };
  const fall = { x: 50, z: 0, drop: 20 };

  soundscape.update(0.1, { weights, listener, fall });
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (let frame = 0; frame < 120; frame += 1) soundscape.update(0.1, { weights, listener, fall });

  const forest = soundscape.beds.get('forest');
  assert.ok(Math.abs(forest.gain.gain.value - 0.35) < 0.01, `forest gain ${forest.gain.gain.value}`);
  assert.equal(soundscape.beds.has('wetland'), false);
  assert.ok(soundscape.roar.gain.gain.value > 0.2);
  // The fall lies east; yaw 0 faces -z, so east is to the right.
  assert.ok(soundscape.roarPanner.pan.value > 0.7);
  // Birds called at least once over twelve seconds of forest.
  assert.ok(started.length > 2);

  for (let frame = 0; frame < 120; frame += 1) soundscape.update(0.1, { weights, listener, fall: null });
  assert.ok(soundscape.roar.gain.gain.value < 0.01);

  for (let frame = 0; frame < 120; frame += 1) soundscape.update(0.1, { weights, listener, enabled: false });
  assert.ok(soundscape.bus.gain.value < 0.01, 'muting audio silences the beds');
});
