import assert from 'node:assert/strict';
import test from 'node:test';
import { createCompaction } from '../src/editor/stylized/meadow/meadowGrassCompaction.js';
import { createMeadowTemplate } from '../src/editor/stylized/meadow/meadowGrassGeometry.js';
import { gradientNoise2dCpu } from '../src/editor/weather/wind/windNoise.js';

function compactPoint({ centerX, centerZ, x, z, tileSize = 8, cards = false }) {
  const template = createMeadowTemplate({ detail: 2, count: 1, tileSize, cards });
  const position = template.getAttribute('instancePosition').array;
  position[0] = x - centerX;
  position[2] = z - centerZ;
  const compaction = createCompaction({
    template, centerX, centerZ,
    sample: (_x, _z, _rank, out) => {
      Object.assign(out, { height: 0, strength: 1, shape: 0, path: 0 });
      return true;
    },
  });
  compaction.advance();
  template.dispose();
  return compaction.output.data.slice(2, 4);
}

test('meadow wind phase and stiffness follow the world point across tile sizes and LODs', () => {
  const point = { x: 7.75, z: -2.5 };
  const blade = compactPoint({ ...point, centerX: 4, centerZ: -4 });
  const card = compactPoint({ ...point, centerX: 32, centerZ: -32, tileSize: 64, cards: true });
  assert.deepEqual(card, blade, 'a card at the same world point must not reset the wind phase');
});

test('adjacent meadow tiles do not restart the same phase and stiffness pattern', () => {
  const first = compactPoint({ centerX: 4, centerZ: -4, x: 5, z: -3 });
  const next = compactPoint({ centerX: 12, centerZ: -4, x: 13, z: -3 });
  assert.notDeepEqual(first, next, 'tile-local wind attributes repeat at every tile');
});

test('wind phase is continuous across positive and negative tile boundaries at planet scale', () => {
  for (const boundary of [8, -8, 16000000, -4200000]) {
    const left = compactPoint({ centerX: boundary - 4, centerZ: -4, x: boundary - 0.001, z: -3 });
    const right = compactPoint({ centerX: boundary + 4, centerZ: -4, x: boundary + 0.001, z: -3 });
    assert.ok(Math.abs(left[0] - right[0]) < 0.01, `wind phase jumps at ${boundary}`);
    assert.ok(Math.abs(left[1] - right[1]) < 0.01, `stiffness jumps at ${boundary}`);
  }
});

test('compaction preserves surviving stems motion when a lower LOD keeps a prefix', () => {
  const outputs = [128, 32].map((count) => {
    const template = createMeadowTemplate({ detail: count === 128 ? 5 : 2, count, tileSize: 8 });
    const compaction = createCompaction({ template, centerX: 16000004, centerZ: -7999996,
      sample: (_x, _z, rank, out) => {
        Object.assign(out, { height: 0, strength: 1, shape: 0, path: 0 });
        return rank % 3 !== 0;
      },
    });
    compaction.advance();
    template.dispose();
    return compaction.output;
  });
  assert.deepEqual(outputs[1].data.slice(0, outputs[1].count * 4),
    outputs[0].data.slice(0, outputs[1].count * 4));
});

test('cached wind sampling matches the world noise throughout blade and card tiles', () => {
  for (const tileSize of [8, 64]) {
    for (const centerX of [4, -4, 16000004]) {
      for (let i = 0; i < 20; i += 1) {
        const x = centerX + (i / 20 - 0.5) * tileSize;
        const z = -4 + ((i * 7 % 20) / 20 - 0.5) * tileSize;
        const data = compactPoint({ centerX, centerZ: -4, x, z, tileSize });
        const bounded = (value) => Math.max(0, Math.min(1, value));
        assert.ok(Math.abs(data[0] - bounded(gradientNoise2dCpu(x * 0.2, z * 0.2)) * Math.PI * 2) < 1e-5);
        assert.ok(Math.abs(data[1] - bounded(gradientNoise2dCpu(x * 0.3, z * 0.3))) < 1e-5);
      }
    }
  }
});
