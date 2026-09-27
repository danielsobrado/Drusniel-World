import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { GpuVoxelChunk } from '../src/editor/voxel/GpuVoxelChunk.js';

const CHUNK_SOURCE = new URL('../src/editor/voxel/GpuVoxelChunk.js', import.meta.url);
const WORLD_SOURCE = new URL('../src/editor/voxel/GpuVoxelWorld.js', import.meta.url);

async function readSources() {
  return Promise.all([
    readFile(CHUNK_SOURCE, 'utf8'),
    readFile(WORLD_SOURCE, 'utf8'),
  ]);
}

test('builds per-slot storage buffers, geometry attributes, and indirect drawing', async () => {
  const [source] = await readSources();

  assert.match(source, /StorageBufferAttribute/);
  assert.match(source, /IndirectStorageBufferAttribute/);
  assert.match(source, /geometry\.setAttribute\('position', positionBuffer\)/);
  assert.match(source, /geometry\.setAttribute\('normal', normalBuffer\)/);
  assert.match(source, /geometry\.setIndirect\(drawBuffer\)/);
});

test('regenerates one chunk by running the init, density, smooth, classify and emit passes in order', async () => {
  const passes = [];
  let inFlight = 0;
  const chunk = new GpuVoxelChunk({
    terrainView: {
      renderer: {
        async computeAsync(node) {
          inFlight += 1;
          assert.equal(inFlight, 1, 'compute passes must be serialized');
          await Promise.resolve();
          passes.push(node);
          inFlight -= 1;
        },
      },
    },
    worldLayout: { enabled: true },
    descriptor: { key: 'test-chunk' },
  });
  chunk.computeInit = 'init';
  chunk.computeDensity = 'density';
  chunk.computeSmooth = 'smooth';
  chunk.computeClassify = 'classify';
  chunk.computeEmit = 'emit';

  await chunk.regeneratePasses();

  assert.deepEqual(passes, ['init', 'density', 'smooth', 'classify', 'emit']);
  assert.equal(inFlight, 0);
  assert.equal(chunk.activeComputePromise, null);
  assert.equal(chunk.rebuilding, false);
});

test('refuses to regenerate before its compute passes exist', async () => {
  const chunk = new GpuVoxelChunk({
    terrainView: { renderer: { async computeAsync() {} } },
    worldLayout: { enabled: true },
    descriptor: { key: 'unprepared-chunk' },
  });

  await assert.rejects(
    () => chunk.regeneratePasses(),
    /resources are not initialized/,
  );
});

test('feeds streamed chunk offsets through reusable shader uniforms', async () => {
  const [chunkSource, worldSource] = await readSources();

  assert.match(chunkSource, /descriptor\.offsetX/);
  assert.match(chunkSource, /descriptor\.offsetZ/);
  assert.match(worldSource, /offsetX: uniform\(0\)/);
  assert.match(worldSource, /slot\.shaderDescriptor\.offsetX\.value = descriptor\.offsetX/);
  assert.match(worldSource, /slot\.shaderDescriptor\.offsetZ\.value = descriptor\.offsetZ/);
});

test('reuses a fixed slot pool and regenerates only changed assignments or stamps', async () => {
  const [, source] = await readSources();

  assert.match(source, /createVoxelStreamingPlan/);
  assert.match(source, /signature === slot\.signature/);
  assert.match(source, /slot\.chunk\.setStamps\(selected\)/);
  assert.match(source, /Array\.from\([\s\S]*layout\.slotCount/);
});

test('serializes reassignment until active GPU rebuilds finish', async () => {
  const [, source] = await readSources();

  assert.match(source, /pendingFocusWorld/);
  assert.match(source, /slot\.chunk\.getStatus\(\)\.rebuilding/);
  assert.match(source, /this\.pendingFocusWorld && !rebuilding/);
});

test('does not introduce GPU-to-CPU readbacks', async () => {
  const sources = (await readSources()).join('\n');

  assert.doesNotMatch(
    sources,
    /getArrayBufferAsync|mapAsync|readRenderTargetPixels|readRenderTargetPixelsAsync/,
  );
});

test('does not embed Infinity into TSL voxel field constants', async () => {
  const [source] = await readSources();

  // Unbounded layouts use Infinity for totalCells*; baking that into TSL emits
  // invalid WGSL `Infinity.0`. Center offsets must be finite before Fn().
  assert.match(source, /Number\.isFinite\(layout\.totalCellsX\)/);
  assert.match(source, /Number\.isFinite\(layout\.totalCellsZ\)/);
  assert.doesNotMatch(source, /\.sub\(\s*layout\.totalCellsX\s*\*\s*0\.5\s*\)/);
  assert.doesNotMatch(source, /\.sub\(\s*layout\.totalCellsZ\s*\*\s*0\.5\s*\)/);
  assert.match(source, /chunkCellsX\s*\*\s*layout\.voxelSize/);
});
