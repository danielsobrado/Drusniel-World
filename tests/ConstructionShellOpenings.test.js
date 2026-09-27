import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { normalizeConstructionRecord } from '../src/editor/construction/ConstructionSchema.js';
import {
  createCubicBezierPathFromStroke,
  sampleCubicBezierPath,
} from '../src/editor/construction/curve/CubicBezierPath.js';
import {
  buildShellGeometry,
  buildWallGeometry,
  sampleShellPath,
} from '../src/editor/construction/render/ConstructionShell.js';
import { createCurveArcTable } from '../src/editor/construction/masonry/CurveArcTable.js';
import { openingHalfWidthAt } from '../src/editor/construction/masonry/OpeningLayout.js';
import { planConstruction } from '../src/editor/construction/planning/ConstructionPlanner.js';
import { buildModuleMasonry } from '../src/editor/construction/compile/ConstructionMasonryBuilder.js';
import {
  createConstructionMaterials,
  disposeConstructionMaterials,
} from '../src/editor/construction/render/ConstructionMaterials.js';

const ORIGIN = { x: 0, z: 0 };
const BASE = -0.08;

/**
 * A three-segment wall. Collinear anchors are simplified away, which would
 * leave one segment and break every fixture that addresses `segment-2`.
 */
function wallPath(length = 12) {
  return createCubicBezierPathFromStroke([
    [0, 0], [length / 3, 0.01], [(length * 2) / 3, -0.01], [length, 0],
  ], { simplifyTolerance: 0.001 });
}

function doorwayRecord({ features = [] } = {}) {
  return normalizeConstructionRecord({
    version: 1,
    id: 'construction-1',
    revision: 1,
    seed: 5,
    kind: 'wall',
    style: { key: 'coursed-rubble', version: 1, materials: {} },
    dimensions: { height: 3.5, thickness: 0.8 },
    path: wallPath(),
    features,
  });
}

function doorFeature(overrides = {}) {
  return {
    id: 'opening-door',
    kind: 'door',
    segmentId: 'segment-2',
    arcFraction: 0.5,
    width: 1.2,
    height: 2.2,
    sill: 0,
    profile: 'flat',
    ...overrides,
  };
}

function createTerrainView() {
  return { getCanonicalHeight: () => 0 };
}

/** The opening's arc coordinate in the shell's own sampling. */
function shellArcOf(record, segmentId, arcFraction) {
  const sampled = sampleShellPath(record);
  const order = [];
  const ends = new Map();
  for (const point of sampled.points) {
    if (!ends.has(point.segmentId)) order.push(point.segmentId);
    ends.set(point.segmentId, Math.max(ends.get(point.segmentId) ?? 0, point.distance));
  }
  let previousEnd = 0;
  for (let index = 0; index < order.length; index += 1) {
    const id = order[index];
    const end = index === order.length - 1 ? sampled.totalDistance : ends.get(id);
    if (id === segmentId) return previousEnd + (end - previousEnd) * arcFraction;
    previousEnd = end;
  }
  return 0;
}

function shellMesh(record, heightAt = null) {
  const geometry = buildWallGeometry(record, createTerrainView(), ORIGIN, { heightAt });
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  mesh.updateMatrixWorld(true);
  return { mesh, geometry };
}

/** Cast straight through the wall at `(arc, y)` across the path's normal. */
function hits(mesh, record, arc, y) {
  const frame = createCurveArcTable(sampleCubicBezierPath(record.path)).frameAt(arc);
  const raycaster = new THREE.Raycaster(
    new THREE.Vector3(frame.x - frame.normalX * 6, y, frame.z - frame.normalZ * 6),
    new THREE.Vector3(frame.normalX, 0, frame.normalZ),
  );
  return raycaster.intersectObject(mesh, false);
}

/** Widest arc span that is clear of the shell at height `y`. */
function openSpan(mesh, record, centre, y, reach = 2) {
  let low = null;
  let high = null;
  for (let arc = centre - reach; arc <= centre + reach; arc += 0.005) {
    const clear = hits(mesh, record, arc, y).length === 0;
    if (clear) {
      if (low == null) low = arc;
      high = arc;
    }
  }
  return low == null ? null : [low, high];
}

/** Highest `y` at which the shell is still clear at `arc`. */
function openTop(mesh, record, arc) {
  let top = null;
  for (let y = 0; y <= 3.4; y += 0.005) {
    if (hits(mesh, record, arc, y).length === 0) top = y;
  }
  return top;
}

/**
 * The pre-fix ribbon: continuous faces, no opening cuts, reproduced here so a
 * wall with no openings is guarded against any drift in the shell builder.
 */
function referencePlainShell(points, record, origin) {
  const thickness = record.dimensions.thickness;
  const halfWidth = thickness / 2;
  const sections = points.map((entry) => ({
    distance: entry.distance,
    left: [entry.x + entry.normalX * halfWidth - origin.x, entry.z + entry.normalZ * halfWidth - origin.z],
    right: [entry.x - entry.normalX * halfWidth - origin.x, entry.z - entry.normalZ * halfWidth - origin.z],
    bottom: BASE,
    top: record.dimensions.height,
    wallHeight: record.dimensions.height,
  }));
  const positions = [];
  const uvs = [];
  const indices = [];
  const vertex = ([x, z], y, u, v) => {
    positions.push(x, y, z);
    uvs.push(u, v);
    return uvs.length / 2 - 1;
  };
  const face = (rowA, rowB) => {
    const a = sections.map(rowA);
    const b = sections.map(rowB);
    for (let index = 0; index < sections.length - 1; index += 1) {
      indices.push(a[index], b[index], b[index + 1], a[index], b[index + 1], a[index + 1]);
    }
  };
  face(
    (section) => vertex(section.left, section.bottom, section.distance, BASE),
    (section) => vertex(section.left, section.top, section.distance, section.wallHeight),
  );
  face(
    (section) => vertex(section.right, section.top, section.distance, section.wallHeight),
    (section) => vertex(section.right, section.bottom, section.distance, BASE),
  );
  face(
    (section) => vertex(section.left, section.top, section.distance, section.wallHeight),
    (section) => vertex(section.right, section.top, section.distance, section.wallHeight + thickness),
  );
  face(
    (section) => vertex(section.right, section.bottom, section.distance, BASE - thickness),
    (section) => vertex(section.left, section.bottom, section.distance, BASE),
  );
  const cap = (section, flip) => {
    const leftBottom = vertex(section.left, section.bottom, 0, BASE);
    const rightBottom = vertex(section.right, section.bottom, thickness, BASE);
    const rightTop = vertex(section.right, section.top, thickness, section.wallHeight);
    const leftTop = vertex(section.left, section.top, 0, section.wallHeight);
    indices.push(...(flip
      ? [leftBottom, leftTop, rightTop, leftBottom, rightTop, rightBottom]
      : [leftBottom, rightBottom, rightTop, leftBottom, rightTop, leftTop]));
  };
  cap(sections[0], false);
  cap(sections.at(-1), true);
  // The real attribute is float32, so round through it to compare bytes.
  return { positions: new Float32Array(positions), uvs: new Float32Array(uvs), indices };
}

/** A fingerprint of a record's near-LOD masonry geometry. */
function nearGeometryFingerprint(record) {
  const plan = planConstruction(record, { maxModuleLength: 8 });
  const arcTable = createCurveArcTable(sampleCubicBezierPath(record.path));
  const materials = createConstructionMaterials(record);
  const chunks = [];
  for (const module of plan.modules) {
    const built = buildModuleMasonry(module.placements ?? [], {
      record,
      materials,
      arcTable,
      moduleOrigin: ORIGIN,
      groundHeightAt: () => 0,
    });
    for (const mesh of built.meshes) {
      chunks.push([...mesh.geometry.getAttribute('position').array].map((n) => n.toFixed(6)).join(','));
      const index = mesh.geometry.getIndex();
      chunks.push(index ? [...index.array].join(',') : '');
      mesh.geometry.dispose();
    }
  }
  disposeConstructionMaterials();
  return `${plan.modules.length}:${chunks.join('|')}`;
}

test('a shell-LOD doorway is genuinely open: a ray through it misses the shell', () => {
  const record = doorwayRecord({ features: [doorFeature()] });
  const { mesh, geometry } = shellMesh(record);
  const s = shellArcOf(record, 'segment-2', 0.5);

  // The reviewer's reproduction: a ray through the same clear doorway used to
  // hit the shell twice, once per face.
  assert.equal(hits(mesh, record, s, 1.1).length, 0, 'doorway centre is solid at shell LOD');
  for (const arc of [s - 0.4, s, s + 0.4]) {
    for (const y of [0.2, 1.1, 2.0]) {
      assert.equal(
        hits(mesh, record, arc, y).length,
        0,
        `ray through the void at arc ${arc}, y ${y} hit the shell`,
      );
    }
  }

  // The rest of the wall is still a wall.
  assert.equal(hits(mesh, record, s - 3, 1.1).length, 2);
  assert.equal(hits(mesh, record, s + 3, 1.1).length, 2);
  assert.equal(hits(mesh, record, s, 3.0).length, 2, 'material above the crown disappeared');

  geometry.dispose();
});

test('the shell opening silhouette matches the near-LOD opening extent', () => {
  const opening = doorFeature();
  const record = doorwayRecord({ features: [opening] });
  const { mesh, geometry } = shellMesh(record);
  const s = shellArcOf(record, 'segment-2', opening.arcFraction);

  // Arc span: the void at the base is the authored width (plus the shared
  // packing clearance), measured across the jamb lines.
  const authoredHalf = openingHalfWidthAt({ ...opening, s }, opening.sill + 0.05);
  const span = openSpan(mesh, record, s, opening.sill + 0.05);
  assert.ok(span, 'no clear span found at the opening base');
  const measuredHalf = (span[1] - span[0]) / 2;
  assert.ok(
    Math.abs(measuredHalf - authoredHalf) < 0.06,
    `arc half-width ${measuredHalf} vs ${authoredHalf}`,
  );
  assert.ok(Math.abs((span[0] + span[1]) / 2 - s) < 0.02, 'the void is off its authored centre');

  // Crown: the passage stays open up to sill + height and no higher.
  const crown = opening.sill + opening.height;
  const measuredCrown = openTop(mesh, record, s);
  assert.ok(
    Math.abs(measuredCrown - crown) < 0.05,
    `shell crown ${measuredCrown} vs ${crown}`,
  );
  assert.equal(hits(mesh, record, s, crown + 0.25).length, 2, 'the shell fills above the crown');

  geometry.dispose();
});

test('a wall with no openings is byte-for-byte unchanged at shell LOD', () => {
  const record = doorwayRecord();
  const points = sampleShellPath(record).points;
  const geometry = buildShellGeometry(points, {
    record,
    terrainView: createTerrainView(),
    origin: ORIGIN,
  });
  const reference = referencePlainShell(points, record, ORIGIN);

  const position = geometry.getAttribute('position').array;
  const uv = geometry.getAttribute('uv').array;
  const index = geometry.getIndex().array;

  assert.equal(position.length, reference.positions.length, 'extra vertices were emitted');
  assert.equal(index.length, reference.indices.length, 'extra triangles were emitted');
  for (let i = 0; i < reference.positions.length; i += 1) {
    assert.equal(position[i], reference.positions[i], `position ${i} drifted`);
  }
  for (let i = 0; i < reference.uvs.length; i += 1) {
    assert.equal(uv[i], reference.uvs[i], `uv ${i} drifted`);
  }
  for (let i = 0; i < reference.indices.length; i += 1) {
    assert.equal(index[i], reference.indices[i], `index ${i} drifted`);
  }

  // The plain ribbon is four faces of two rows plus two caps.
  assert.equal(position.length / 3, points.length * 8 + 8);
  geometry.dispose();
});

test('rebuilding near -> shell -> near returns the same near geometry', () => {
  const record = doorwayRecord({ features: [doorFeature()] });
  const before = nearGeometryFingerprint(record);

  const { mesh, geometry } = shellMesh(record);
  const s = shellArcOf(record, 'segment-2', 0.5);
  assert.equal(hits(mesh, record, s, 1.1).length, 0);
  mesh.material.dispose();
  geometry.dispose();

  const after = nearGeometryFingerprint(record);
  assert.equal(after, before);
});
