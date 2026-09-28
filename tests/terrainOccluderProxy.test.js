import assert from 'node:assert/strict';
import test from 'node:test';

import { createTerrainOccluderGeometry } from '../src/editor/world/terrainOccluderProxy.js';

test('the occluder follows the page heights, upright, around the chunk centre', () => {
  const chunkSize = 8;
  const heights = new Float32Array((chunkSize + 1) ** 2).map((_, index) => Math.floor(index / (chunkSize + 1)));
  const geometry = createTerrainOccluderGeometry({ heights, chunkSize, tileSize: 2, step: 4, sink: 0.5 });
  const position = geometry.getAttribute('position');
  assert.equal(position.count, 9, '3 x 3 samples at step 4');
  assert.deepEqual([position.getX(0), position.getY(0), position.getZ(0)], [-8, -0.5, 8], 'cell (0, 0) is north-west, sunk');
  // Row 2 is cell z 8: canonical z runs against cell z.
  assert.deepEqual([position.getX(8), position.getY(8), position.getZ(8)], [8, 7.5, -8]);
  assert.equal(geometry.index.count, 2 * 2 * 6);
});
