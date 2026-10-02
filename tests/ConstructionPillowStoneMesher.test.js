import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { constructionStoneRoundingProfile } from '../src/editor/construction/config/ConstructionStoneRoundingProfiles.generated.js';
import {
  estimatePillowStone,
  eulerXYZMatrix,
  writePillowStone,
} from '../src/editor/construction/compile/ConstructionPillowStoneMesher.js';
import { MasonryVertexWriter } from '../src/editor/construction/compile/MasonryVertexWriter.js';
import {
  createRoundedOutline,
  normalizeConvexQuad,
} from '../src/editor/construction/compile/PillowStoneOutline.js';
import { createRoundedStoneShader } from '../src/editor/construction/compile/RoundedStoneShading.js';
import { sampleStonePillow } from '../src/editor/construction/masonry/StonePillowField.js';

const PROFILE = constructionStoneRoundingProfile('rounded-fieldstone');
const NEAR = PROFILE.lod.near;
const COARSE = PROFILE.lod.coarse;

/** A leaning lattice-style face: tilted head joints and a sloped bed. */
const LEANING_QUAD = [[-0.46, -0.21], [0.43, -0.235], [0.47, 0.22], [-0.42, 0.24]];

function shader() {
  return createRoundedStoneShader({
    albedo: [0.78, 0.74, 0.68],
    grade: [1.02, 1, 0.97],
    weather: 0.01,
    occlusion: PROFILE.occlusion,
  });
}

function pillowFor(corners, depth = 0.8, stableIndex = 5) {
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  return sampleStonePillow({
    profile: PROFILE,
    seed: 3141,
    stableIndex,
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
    depth,
  });
}

function writeStone({
  corners = LEANING_QUAD,
  depth = 0.8,
  lod = NEAR,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  drape = null,
  exposure = null,
  pillow = pillowFor(corners, depth),
} = {}) {
  const writer = new MasonryVertexWriter();
  const result = writePillowStone(writer, { corners, depth, position, rotation, pillow }, {
    lod,
    shade: shader(),
    creviceReach: PROFILE.occlusion.creviceReach,
    drape,
    exposure,
  });
  return { writer, result, arrays: writer.toArrays(), pillow };
}

function insideConvex(ring, x, y, tolerance) {
  for (let index = 0; index < ring.length; index += 1) {
    const [ax, ay] = ring[index];
    const [bx, by] = ring[(index + 1) % ring.length];
    const edgeX = bx - ax;
    const edgeY = by - ay;
    const length = Math.hypot(edgeX, edgeY);
    const cross = (edgeX * (y - ay) - edgeY * (x - ax)) / length;
    if (cross < -tolerance) return false;
  }
  return true;
}

test('tessellation matches its estimate in both LOD bands', () => {
  for (const [lod, triangles] of [[NEAR, 256], [COARSE, 64]]) {
    const { result, arrays } = writeStone({ lod });
    const estimate = estimatePillowStone(lod);
    assert.equal(estimate.triangles, triangles);
    assert.equal(result.triangles, estimate.triangles);
    assert.equal(result.vertices, estimate.vertices);
    assert.equal(arrays.vertexCount, estimate.vertices);
    assert.equal(arrays.triangleCount, estimate.triangles);
  }
});

test('every vertex is finite, has a unit normal and a colour in range', () => {
  const { arrays } = writeStone();
  for (let vertex = 0; vertex < arrays.vertexCount; vertex += 1) {
    const offset = vertex * 3;
    for (let axis = 0; axis < 3; axis += 1) {
      assert.ok(Number.isFinite(arrays.positions[offset + axis]));
      const colour = arrays.colors[offset + axis];
      assert.ok(colour >= 0 && colour <= 1, `colour ${colour}`);
    }
    const length = Math.hypot(
      arrays.normals[offset],
      arrays.normals[offset + 1],
      arrays.normals[offset + 2],
    );
    assert.ok(Math.abs(length - 1) < 1e-5, `normal length ${length}`);
    assert.ok(Number.isFinite(arrays.uvs[vertex * 2]));
  }
});

test('rounding only removes material inside the face quad', () => {
  const ring = normalizeConvexQuad(LEANING_QUAD);
  const { arrays, pillow } = writeStone();
  const reach = 0.4 + Math.max(pillow.front.bulge, pillow.back.bulge) * 1.75;
  for (let vertex = 0; vertex < arrays.vertexCount; vertex += 1) {
    const x = arrays.positions[vertex * 3];
    const y = arrays.positions[vertex * 3 + 1];
    const z = arrays.positions[vertex * 3 + 2];
    assert.ok(insideConvex(ring, x, y, 1e-6), `vertex ${vertex} (${x}, ${y}) leaves the quad`);
    assert.ok(Math.abs(z) <= reach + 1e-6, `vertex ${vertex} z ${z}`);
  }
});

test('uneven corner wear stays inside a leaning stone with unchanged mesh cost', () => {
  const profile = constructionStoneRoundingProfile('glade-sandstone');
  const ring = normalizeConvexQuad(LEANING_QUAD);
  for (let stableIndex = 0; stableIndex < 40; stableIndex += 1) {
    const pillow = sampleStonePillow({ profile, seed: 3141, stableIndex, width: 0.93, height: 0.475, depth: 0.8 });
    const { result, arrays } = writeStone({ pillow, lod: profile.lod.near });
    assert.equal(result.triangles, estimatePillowStone(profile.lod.near).triangles);
    for (let vertex = 0; vertex < arrays.vertexCount; vertex += 1) {
      assert.ok(insideConvex(ring, arrays.positions[vertex * 3], arrays.positions[vertex * 3 + 1], 1e-6));
      const normal = arrays.normals.slice(vertex * 3, vertex * 3 + 3);
      assert.ok(Math.abs(Math.hypot(...normal) - 1) < 1e-5);
    }
  }
});

test('intermediate uneven bevel rings keep their elliptic slope normals', () => {
  const profile = constructionStoneRoundingProfile('glade-sandstone');
  const pillow = sampleStonePillow({ profile, seed: 3141, stableIndex: 17, width: 0.93, height: 0.475, depth: 0.8 });
  const lod = { ...profile.lod.near, rimRings: 3 };
  const { result, arrays } = writeStone({ pillow, lod });
  assert.equal(result.triangles, estimatePillowStone(lod).triangles);
  const outline = createRoundedOutline(normalizeConvexQuad(LEANING_QUAD), pillow.cornerRadius,
    lod.arcSegments, pillow.cornerRadii, lod.edgeSegments);
  for (let point = 0; point < outline.pointCount; point += 1) {
    const index = outline.wearIndex(point);
    const width = Math.min(pillow.front.edgeRadius * pillow.front.rimWidths[index], outline.insetLimit(point) * 0.9);
    const depth = Math.min(pillow.front.edgeRadius * pillow.front.rimDepths[index], 0.4 * 0.6);
    const angle = Math.PI / 6;
    const nx = Math.cos(angle) * depth, nz = Math.sin(angle) * width;
    const length = Math.hypot(nx, nz);
    const offset = (outline.pointCount + point) * 3;
    assert.ok(Math.abs(arrays.normals[offset] - nx / length * outline.normalX(point)) < 1e-6);
    assert.ok(Math.abs(arrays.normals[offset + 1] - nx / length * outline.normalY(point)) < 1e-6);
    assert.ok(Math.abs(arrays.normals[offset + 2] - nz / length) < 1e-6);
  }
});

test('every triangle faces the way its vertices say the surface faces', () => {
  const { arrays } = writeStone();
  const { positions, normals, indices } = arrays;
  const at = (index, array) => [array[index * 3], array[index * 3 + 1], array[index * 3 + 2]];
  for (let triangle = 0; triangle < indices.length; triangle += 3) {
    const [a, b, c] = [indices[triangle], indices[triangle + 1], indices[triangle + 2]];
    const [pa, pb, pc] = [at(a, positions), at(b, positions), at(c, positions)];
    const e1 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
    const e2 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    const face = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    const summed = [0, 1, 2].map((axis) => (
      at(a, normals)[axis] + at(b, normals)[axis] + at(c, normals)[axis]
    ));
    const dot = face[0] * summed[0] + face[1] * summed[1] + face[2] * summed[2];
    assert.ok(dot > 0, `triangle ${triangle / 3} is wound inward`);
  }
});

test('each face domes proud of its nominal plane, peaking near its centre', () => {
  const depth = 0.8;
  const { arrays, pillow } = writeStone({ depth });
  let front = -Infinity;
  let back = Infinity;
  for (let vertex = 0; vertex < arrays.vertexCount; vertex += 1) {
    const z = arrays.positions[vertex * 3 + 2];
    front = Math.max(front, z);
    back = Math.min(back, z);
  }
  assert.ok(pillow.front.bulge > 0 && pillow.back.bulge > 0);
  assert.ok(front > depth / 2 + pillow.front.bulge * 0.2);
  assert.ok(back < -depth / 2 - pillow.back.bulge * 0.2);
});

test('rolled rims shade darker than the dome they roll away from', () => {
  const { arrays } = writeStone();
  let rimLuma = 0;
  let rimCount = 0;
  let domeLuma = 0;
  let domeCount = 0;
  for (let vertex = 0; vertex < arrays.vertexCount; vertex += 1) {
    const z = arrays.positions[vertex * 3 + 2];
    const luma = arrays.colors[vertex * 3] + arrays.colors[vertex * 3 + 1] + arrays.colors[vertex * 3 + 2];
    if (z > 0.4) {
      domeLuma += luma;
      domeCount += 1;
    } else if (z > 0 && z < 0.34) {
      rimLuma += luma;
      rimCount += 1;
    }
  }
  assert.ok(rimCount > 0 && domeCount > 0);
  assert.ok(rimLuma / rimCount < (domeLuma / domeCount) * 0.85);
});

test('a drape shears vertices by the ground and keeps normals unit length', () => {
  const slope = 0.2;
  const drape = {
    tangentX: 1,
    tangentZ: 0,
    sample(x, z, out) {
      out[0] = slope * x;
      out[1] = slope;
      return out;
    },
  };
  const flat = writeStone().arrays;
  const draped = writeStone({ drape }).arrays;
  for (let vertex = 0; vertex < flat.vertexCount; vertex += 1) {
    const x = flat.positions[vertex * 3];
    const lifted = flat.positions[vertex * 3 + 1] + slope * x;
    assert.ok(Math.abs(draped.positions[vertex * 3 + 1] - lifted) < 1e-5);
    const length = Math.hypot(
      draped.normals[vertex * 3],
      draped.normals[vertex * 3 + 1],
      draped.normals[vertex * 3 + 2],
    );
    assert.ok(Math.abs(length - 1) < 1e-5);
  }
});

test('open tops and ends lose contact shading without changing geometry or buried edges', () => {
  const base = writeStone().arrays;
  for (const edge of ['top', 'start', 'end']) {
    const open = writeStone({ exposure: { [edge]: true } }).arrays;
    for (const key of ['positions', 'normals', 'indices', 'uvs']) {
      assert.deepEqual(open[key], base[key], `${edge} changed ${key}`);
    }
    let lightened = 0;
    let unchanged = 0;
    for (let vertex = 0; vertex < base.vertexCount; vertex += 1) {
      const offset = vertex * 3;
      const outward = edge === 'top' ? base.normals[offset + 1]
        : base.normals[offset] * (edge === 'start' ? -1 : 1);
      const gain = open.colors[offset] - base.colors[offset];
      if (outward > 0.9) {
        assert.ok(gain > 0.03, `${edge} retains contact shadow`);
        lightened += 1;
      } else if (outward <= 0) {
        assert.equal(gain, 0, `${edge} lightened a buried edge`);
        unchanged += 1;
      }
    }
    assert.ok(lightened > 0 && unchanged > 0);
  }
});

test('a quad that cannot be rounded reports null and writes nothing', () => {
  const writer = new MasonryVertexWriter();
  const folded = [[0, 0], [1, 1], [1, 0], [0, 1]];
  const result = writePillowStone(writer, {
    corners: folded,
    depth: 0.8,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    pillow: pillowFor(LEANING_QUAD),
  }, { lod: NEAR, shade: shader() });
  assert.equal(result, null);
  assert.equal(writer.vertexCount, 0);
  assert.equal(writer.indexCount, 0);
  assert.equal(normalizeConvexQuad(folded), null);
});

test('an over-large corner radius does not fit the quad', () => {
  const ring = normalizeConvexQuad([[-0.2, -0.1], [0.2, -0.1], [0.2, 0.1], [-0.2, 0.1]]);
  assert.ok(createRoundedOutline(ring, 0.09, 2));
  assert.equal(createRoundedOutline(ring, 0.11, 2), null);
});

test('eulerXYZMatrix agrees with Three.js', () => {
  const rotation = [0.12, -1.3, 0.4];
  const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = eulerXYZMatrix(rotation);
  const three = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rotation)).elements;
  // Three.js stores column-major.
  const expected = [three[0], three[4], three[8], three[1], three[5], three[9], three[2], three[6], three[10]];
  [m0, m1, m2, m3, m4, m5, m6, m7, m8].forEach((value, index) => {
    assert.ok(Math.abs(value - expected[index]) < 1e-12, `element ${index}`);
  });
});

test('the writer narrows indices and appends plain blocks', () => {
  const writer = new MasonryVertexWriter({ vertices: 2, indices: 3 });
  writer.reserve(3, 3);
  const a = writer.vertex(0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0);
  const b = writer.vertex(1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0);
  const c = writer.vertex(0, 1, 0, 0, 0, 1, 1, 1, 1, 0, 1);
  writer.triangle(a, b, c);
  writer.append({
    positions: new Float32Array(9),
    normals: new Float32Array(9),
    colors: new Float32Array(9),
    uvs: new Float32Array(6),
  });
  const arrays = writer.toArrays();
  assert.equal(arrays.vertexCount, 6);
  assert.equal(arrays.triangleCount, 2);
  assert.ok(arrays.indices instanceof Uint16Array);
  assert.deepEqual([...arrays.indices], [0, 1, 2, 3, 4, 5]);
});

test('a flat face profile keeps the default dome exact and flattens the plateau', async () => {
  const { faceProfile } = await import('../src/editor/construction/compile/ConstructionPillowStoneMesher.js');
  for (const rho of [0, 0.25, 0.5, 0.75, 1]) {
    const dome = faceProfile(rho, 0);
    const falloff = 1 - rho * rho;
    assert.equal(dome.profile, falloff * falloff, 'flatness 0 is bit-identical');
    assert.equal(dome.slopeProfile, -4 * rho * falloff);
  }
  // A plateau stays near full height further out, and meets the rim flat.
  assert.ok(faceProfile(0.5, 1).profile > faceProfile(0.5, 0).profile);
  assert.equal(faceProfile(1, 1).profile, 0);
  assert.ok(Math.abs(faceProfile(1, 1).slopeProfile) === 0);
  // The derivative matches the profile numerically.
  const h = 1e-6;
  for (const rho of [0.3, 0.6, 0.9]) {
    const numeric = (faceProfile(rho + h, 1).profile - faceProfile(rho - h, 1).profile) / (2 * h);
    assert.ok(Math.abs(numeric - faceProfile(rho, 1).slopeProfile) < 1e-5);
  }
});
