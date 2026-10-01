import assert from 'node:assert/strict';
import test from 'node:test';
import { constructionStoneRoundingProfile } from '../src/editor/construction/config/ConstructionStoneRoundingProfiles.generated.js';
import { sampleStonePillow } from '../src/editor/construction/masonry/StonePillowField.js';
import { createRoundedOutline } from '../src/editor/construction/compile/PillowStoneOutline.js';
import { MasonryVertexWriter } from '../src/editor/construction/compile/MasonryVertexWriter.js';
import { writePillowStone } from '../src/editor/construction/compile/ConstructionPillowStoneMesher.js';

const profile = constructionStoneRoundingProfile('glade-sandstone');
const shade = out => { out[0] = 0.8; out[1] = 0.7; out[2] = 0.5; };

function mesh(corners, width, height, depth, seed, band) {
  const pillow = sampleStonePillow({ profile, seed, stableIndex: seed * 31, width, height, depth });
  const writer = new MasonryVertexWriter();
  const result = writePillowStone(writer, {
    corners, depth, position: [0, 0, 0], rotation: [0, 0, 0], pillow,
  }, { lod: profile.lod[band], shade });
  assert.ok(result, `seed ${seed}: stone must fit`);
  assert.equal(result.triangles, band === 'near' ? 96 : 64);
  return writer.toArrays();
}

test('worn sandstone stays closed and outward-facing for small, thin and leaning units', () => {
  for (let seed = 1; seed <= 120; seed += 1) {
    const width = 0.07 + (seed % 11) * 0.09;
    const height = 0.055 + (seed % 7) * 0.075;
    const depth = 0.06 + (seed % 5) * 0.15;
    const skew = width * 0.08;
    const corners = [[-width / 2, -height / 2], [width / 2, -height / 2],
      [width / 2 + skew, height / 2], [-width / 2 + skew, height / 2]];
    for (const band of ['near', 'coarse']) {
      const { positions, normals, indices, colors } = mesh(corners, width, height, depth, seed, band);
      assert.ok([...positions, ...normals, ...colors].every(Number.isFinite));
      for (let offset = 0; offset < positions.length; offset += 3) {
        const [x, y, z] = positions.slice(offset, offset + 3);
        const shearX = x - (y / height + 0.5) * skew;
        assert.ok(Math.abs(shearX) <= width / 2 + 1e-6);
        assert.ok(Math.abs(y) <= height / 2 + 1e-6);
        assert.ok(Math.abs(z) <= depth / 2 + profile.bulge.maximum * 1.75 + 1e-6);
        assert.ok(Math.abs(Math.hypot(...normals.slice(offset, offset + 3)) - 1) < 1e-5);
      }
      const edges = new Map();
      for (let i = 0; i < indices.length; i += 3) {
        const triangle = Array.from(indices.slice(i, i + 3));
        const [a, b, c] = triangle.map(index => Array.from(positions.slice(index * 3, index * 3 + 3)));
        const ab = b.map((v, axis) => v - a[axis]);
        const ac = c.map((v, axis) => v - a[axis]);
        const cross = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
        const normal = [0, 1, 2].map(axis => triangle.reduce((sum, index) => sum + normals[index * 3 + axis], 0));
        assert.ok(cross.reduce((sum, v, axis) => sum + v * normal[axis], 0) > 1e-12,
          `seed ${seed}, ${band}, triangle ${i / 3} folded or collapsed`);
        for (let edge = 0; edge < 3; edge += 1) {
          const a = triangle[edge], b = triangle[(edge + 1) % 3];
          const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
          const value = edges.get(key) ?? { count: 0, winding: 0 };
          value.count += 1; value.winding += a < b ? 1 : -1; edges.set(key, value);
        }
      }
      for (const { count, winding } of edges.values()) {
        assert.equal(count, 2, 'closed surface: every edge belongs to two triangles');
        assert.equal(winding, 0, 'adjacent triangles traverse their common edge in opposite directions');
      }
    }
  }
});

test('near edge midpoints preserve the coarse packed silhouette and stable wear samples', () => {
  const ring = [[-0.25, -0.2], [0.25, -0.2], [0.28, 0.2], [-0.22, 0.2]];
  const radii = [0.025, 0.032, 0.021, 0.035];
  const near = createRoundedOutline(ring, 0.03, 1, radii, 2);
  const coarse = createRoundedOutline(ring, 0.03, 1, radii, 1);
  for (let corner = 0; corner < 4; corner += 1) {
    for (let step = 0; step < 2; step += 1) {
      const n = corner * 3 + step, c = corner * 2 + step;
      assert.equal(near.pointX(n, 0), coarse.pointX(c, 0));
      assert.equal(near.pointY(n, 0), coarse.pointY(c, 0));
      assert.equal(near.wearIndex(n), coarse.wearIndex(c));
    }
    const start = corner * 3 + 1, end = ((corner + 1) % 4) * 3, mid = corner * 3 + 2;
    for (const coordinate of ['pointX', 'pointY']) {
      assert.ok(Math.abs(near[coordinate](mid, 0) - (near[coordinate](start, 0) + near[coordinate](end, 0)) / 2) < 1e-12);
    }
  }
});
