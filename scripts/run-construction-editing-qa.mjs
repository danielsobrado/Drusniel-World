import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
};
const base = arg('url', 'http://127.0.0.1:5183');
const out = path.resolve(arg('out', 'tmp/construction-editing'));
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: !process.argv.includes('--headed'),
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=default'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/?fixture=construction-ring&constructionStyle=glade-sandstone`);
  await page.waitForFunction(() => window.__editor?.constructionView?.entries?.size > 0, null, { timeout: 180000 });
  await page.evaluate(async () => {
    const { controller: c, terrainView: t } = window.__editor;
    const camera = c.editorCamera;
    const ground = t.getCanonicalHeight(0, 0) ?? 0;
    camera.viewSize = 32; camera.resize(1440, 1000);
    camera.controls.target.set(0, ground, 0);
    camera.camera.position.set(18, ground + 28, 22); camera.controls.update();
    c.selectConstructionMode('draw');
    window.qaDraft = null;
    const setDraft = c.constructionView.setDraft.bind(c.constructionView);
    c.constructionView.setDraft = (record, options) => { window.qaDraft = record; return setDraft(record, options); };
    const { audioBus } = await import('/src/editor/audio/audio_bus.js');
    window.qaAudio = [];
    // Tap the gesture emitter directly: a running Vite server may have a
    // timestamped audio module after HMR, separate from this QA dynamic import.
    const emit = c.constructionAudio.emit;
    c.constructionAudio.emit = (id) => { window.qaAudio.push(id); return emit(id); };
    window.qaAudioBus = audioBus;
  });
  const screen = (x, z, y = 0) => page.evaluate(async ([x, z, height]) => {
    const { Vector3 } = await import('/node_modules/three/build/three.webgpu.js');
    const { controller: c, terrainView: t } = window.__editor;
    const bounds = c.canvas.getBoundingClientRect();
    const p = new Vector3(x, (t.getCanonicalHeight(x, z) ?? 0) + height, z).project(c.activeCamera);
    return { x: bounds.left + (p.x + 1) * bounds.width / 2, y: bounds.top + (1 - p.y) * bounds.height / 2 };
  }, [x, z, y]);
  const state = () => page.evaluate(() => {
    const c = window.__editor.controller;
    return { size: c.constructionStore.size, history: c.undoStack.length, selected: c.selectedConstructionId,
      drawing: c.constructionDrawing, mode: c.constructionMode,
      record: c.constructionStore.get(c.selectedConstructionId), draft: window.qaDraft,
      audio: window.qaAudio.slice(), gestureAudio: c.constructionAudio?.gesture,
      direct: c.constructionGizmo.directDrag?.kind ?? null };
  });
  const baseline = await state();
  await page.locator('[data-wall-shape="circle"]').click();
  const centre = await screen(0, 0);
  const rim = await screen(4, 0);
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(rim.x, rim.y, { steps: 24 });
  const preview = await state();
  assert.equal(preview.size, baseline.size);
  assert.equal(preview.draft.path.closed, true);
  assert.equal(preview.draft.path.anchors.length, 4);
  await page.mouse.up();
  const circle = await state();
  assert.equal(circle.size, baseline.size + 1);
  assert.equal(circle.history, baseline.history + 1);
  assert.equal(circle.mode, 'draw');
  assert.deepEqual(circle.record.path.anchors.map(a => a.position), preview.draft.path.anchors.map(a => a.position));
  await page.keyboard.press('Control+z');
  assert.equal((await state()).size, baseline.size);
  await page.keyboard.press('Control+Shift+z');
  assert.equal((await state()).size, circle.size);

  // Let the compiler finish so the next pointer hits the visible authored wall.
  await page.waitForFunction(id => {
    const entry = window.__editor.constructionView.entries.get(id);
    return entry && [...entry.modules.values()].some(module => module.meshes.length);
  }, circle.record.id, { timeout: 90000 });
  const body = await screen(2.8, 2.8, 1.2);
  await page.mouse.click(body.x, body.y);
  assert.equal((await state()).selected, circle.record.id);
  await page.mouse.move(body.x, body.y);
  await page.mouse.down();
  await page.mouse.move(body.x + 50, body.y, { steps: 15 });
  const moving = await state();
  assert.equal(moving.direct, 'move-all');
  assert.deepEqual(moving.record.path, circle.record.path, 'drag preview must leave authored wall untouched');
  await page.keyboard.press('Escape');
  assert.equal((await state()).direct, null);
  await page.mouse.up();
  assert.deepEqual((await state()).record.path, circle.record.path);

  // Finish a body drag as one edit, then undo it.
  await page.mouse.move(body.x, body.y);
  await page.mouse.down();
  await page.mouse.move(body.x + 50, body.y, { steps: 15 });
  await page.mouse.up();
  const moved = await state();
  assert.equal(moved.history, circle.history + 1);
  assert.notDeepEqual(moved.record.path.anchors, circle.record.path.anchors);
  await page.keyboard.press('Control+z');
  assert.deepEqual((await state()).record.path, circle.record.path);

  await page.locator('[data-wall-shape="line"]').click();
  const from = await screen(-3, 8);
  const to = await screen(3, 8);
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 20 });
  await page.keyboard.press('Escape'); await page.mouse.up();
  assert.equal((await state()).size, circle.size, 'Escape cancels drawing');
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 20 }); await page.mouse.up();
  const line = await state();
  assert.equal(line.record.path.anchors.length, 2);

  // Alt on an existing wall must reach the cut tool, even with a shape selected.
  await page.mouse.move(body.x, body.y); await page.keyboard.down('Alt');
  await page.mouse.down();
  const cutting = await page.evaluate(() => window.__editor.controller.constructionCutStroke);
  assert.equal(cutting, true);
  await page.keyboard.press('Escape'); await page.mouse.up(); await page.keyboard.up('Alt');
  await page.screenshot({ path: path.join(out, 'creation-controls.png') });

  const audio = await page.evaluate(async () => {
    const { ProceduralAudio } = await import('/src/editor/audio/procedural_audio.js');
    const bus = window.qaAudioBus;
    let calls = 0;
    const play = bus.synthManager.playSynth.bind(bus.synthManager);
    bus.synthManager.playSynth = (...args) => { calls++; return play(...args); };
    bus.setAudioEnabled(false); bus.emitAudio('construction.place', { force: true });
    const mutedCalls = calls;
    bus.setAudioEnabled(true); bus.emitAudio('construction.place', { force: true });
    const enabledCalls = calls;
    const buffers = [];
    for (const kind of ['draw', 'move', 'cut', 'place', 'remove']) {
      const context = new OfflineAudioContext(1, 24000, 48000);
      const synth = new ProceduralAudio(); synth.init(context);
      const config = bus.config.events[`construction.${kind}`];
      synth.playSynth(config.synth, config, config.volume * bus.config.global.world_volume);
      const result = (await context.startRendering()).getChannelData(0);
      const peak = result.reduce((m, value) => Math.max(m, Math.abs(value)), 0);
      const rms = Math.sqrt(result.reduce((sum, value) => sum + value * value, 0) / result.length);
      buffers.push({ kind, peak, rms, samples: Array.from(result) });
    }
    return { mutedCalls, enabledCalls, buffers, events: window.qaAudio };
  });
  assert.equal(audio.mutedCalls, 0);
  assert.equal(audio.enabledCalls, 1);
  assert.ok(audio.events.includes('construction.draw'));
  assert.ok(audio.events.includes('construction.move'));
  assert.ok(audio.events.includes('construction.undo'));
  for (const buffer of audio.buffers) {
    assert.ok(Number.isFinite(buffer.rms) && buffer.rms > 0 && buffer.peak < 0.5, `audio envelope ${buffer.kind}`);
  }
  const samples = audio.buffers.flatMap(buffer => buffer.samples);
  const wav = Buffer.alloc(44 + samples.length * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(96000, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((sample, i) => wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), 44 + i * 2));
  fs.writeFileSync(path.join(out, 'stone-editing-sounds.wav'), wav);
  audio.buffers = audio.buffers.map(({ samples, ...stats }) => stats);
  assert.deepEqual(errors, []);
  const report = { circle: { anchors: circle.record.path.anchors.length, previewMatches: true },
    bodyMove: { committed: true, undo: true, escapeCancels: true }, line: { anchors: line.record.path.anchors.length },
    altCutOnWall: cutting, audio, errors };
  fs.writeFileSync(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
