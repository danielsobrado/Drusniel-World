import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import yaml from 'js-yaml';
import { ConstructionEditAudio } from '../src/editor/construction/ConstructionEditAudio.js';
import { AudioBus } from '../src/editor/audio/audio_bus.js';
import { defaultAudioConfig } from '../src/editor/audio/audio_config.js';

test('gesture sound requires travel and time, and stops on cancellation', () => {
  const events = [];
  let now = 0;
  const audio = new ConstructionEditAudio({ emit: id => events.push(id), now: () => now });
  audio.begin('draw', { x: 0, z: 0 });
  now = 500;
  audio.move({ x: 0, z: 0 });
  audio.move({ x: 0.02, z: 0 });
  assert.deepEqual(events, []);
  audio.move({ x: 1, z: 0 });
  audio.move({ x: 2, z: 0 });
  assert.deepEqual(events, ['construction.draw']);
  now += 120;
  audio.move({ x: 2, z: 0 });
  audio.end();
  now += 120;
  audio.move({ x: 3, z: 0 });
  assert.equal(events.length, 2);
  audio.begin('move', { x: 0, y: 0, z: 0 });
  audio.move({ x: 0, y: 1, z: 0 });
  assert.equal(events.at(-1), 'construction.move', 'height drags have no horizontal travel');
});

test('history plays one event per wall operation and ignores other tools', () => {
  const events = [];
  const audio = new ConstructionEditAudio({ emit: id => events.push(id) });
  audio.commit({ kind: 'terrain' });
  audio.commit({ kind: 'construction', before: null, after: {} });
  audio.commit({ kind: 'construction', before: {}, after: null });
  audio.commit({ kind: 'construction-batch', changes: [{}, {}] });
  audio.history({ kind: 'construction' }, 'undo');
  audio.history({ kind: 'construction' }, 'redo');
  assert.deepEqual(events, ['construction.place', 'construction.remove', 'construction.place', 'construction.undo', 'construction.redo']);
});

test('construction sounds use world volume, cooldown and master mute', () => {
  const bus = new AudioBus();
  const calls = [];
  let enabled = true;
  bus.synthManager = { isInitialized: () => true, isEnabled: () => enabled,
    playSynth: (...args) => calls.push(args) };
  bus.config = structuredClone(defaultAudioConfig);
  bus.config.global.world_volume = 0.25;
  bus.emitAudio('construction.draw');
  bus.emitAudio('construction.draw');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2], bus.config.events['construction.draw'].volume * 0.25);
  enabled = false;
  bus.emitAudio('construction.place');
  enabled = true;
  bus.config.global.world_volume = 0;
  bus.emitAudio('construction.move');
  assert.equal(calls.length, 1);
});

test('audio YAML and runtime JSON stay in sync, including recordings', () => {
  const source = yaml.load(fs.readFileSync(new URL('../config/audio_events.yaml', import.meta.url), 'utf8'));
  const runtime = JSON.parse(fs.readFileSync(new URL('../src/editor/audio/audio_events_defaults.json', import.meta.url), 'utf8'));
  assert.deepEqual(runtime, source);
});
