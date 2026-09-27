import * as THREE from 'three/webgpu';
import { sampleCubicBezierPath } from '../curve/CubicBezierPath.js';

/**
 * The semantic wall shell: a terrain-following extruded ribbon.
 *
 * The shell is the far LOD band *and* the pre-masonry placeholder, and the LOD
 * band is chosen per module — so the ribbon has to be sliceable per module too.
 * One ribbon spanning the whole record cannot express "this module is far and
 * that one is near": showing it for the far module draws it straight through
 * the near module's masonry, which reads as holes and z-fighting in the courses
 * rather than as a distant wall.
 *
 * Vertices are **origin-local**, never render-space. Baking
 * `floatingOrigin.toRender` into a vertex costs float32 precision at world
 * scale — at 3 km out a 2 mm mortar inset is not representable — and forces a
 * full rebuild on every rebase. Parenting to a group whose position carries the
 * render offset fixes both.
 */

const FOUNDATION_OVERLAP = 0.08;

/** Slice boundaries closer than this to a sample reuse that sample exactly. */
const SEAM_EPSILON = 1e-6;

export function sampleShellPath(record) {
  return sampleCubicBezierPath(record.path, {
    chordError: 0.08,
    maxSpacing: 0.65,
  });
}

function lerpShellPoint(a, b, t) {
  const normalX = a.normalX + (b.normalX - a.normalX) * t;
  const normalZ = a.normalZ + (b.normalZ - a.normalZ) * t;
  const length = Math.hypot(normalX, normalZ) || 1;
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    normalX: normalX / length,
    normalZ: normalZ / length,
    distance: a.distance + (b.distance - a.distance) * t,
  };
}

function shellPointAt(points, distance) {
  if (distance <= points[0].distance) return points[0];
  const last = points[points.length - 1];
  if (distance >= last.distance) return last;
  for (let index = 1; index < points.length; index += 1) {
    const before = points[index - 1];
    const after = points[index];
    if (after.distance < distance) continue;
    const span = after.distance - before.distance;
    if (!(span > 0)) return after;
    return lerpShellPoint(before, after, (distance - before.distance) / span);
  }
  return last;
}

/**
 * Sampled points covering `[fromFraction, toFraction]` of the path.
 *
 * Boundaries are **fractions of the sampled total**, not absolute arc lengths:
 * the planner samples the same curve with its own tolerances, so its arc
 * coordinates are close to but not identical with the view's. Slicing on the
 * shared fraction makes neighbouring sections meet on the same interpolated
 * point, which is what keeps a seam from opening between two module shells.
 */
export function shellSectionPoints(sampled, fromFraction = 0, toFraction = 1) {
  const points = sampled.points;
  if (!points || points.length < 2) return [];
  const total = sampled.totalDistance;
  const from = Math.max(0, Math.min(1, fromFraction)) * total;
  const to = Math.max(0, Math.min(1, toFraction)) * total;
  if (!(to - from > SEAM_EPSILON)) return [];

  const section = [shellPointAt(points, from)];
  for (const point of points) {
    if (point.distance > from + SEAM_EPSILON && point.distance < to - SEAM_EPSILON) {
      section.push(point);
    }
  }
  section.push(shellPointAt(points, to));
  return section;
}

/** Cross-section of the ribbon at one sampled point, origin-local. */
function shellSection(entry, { halfWidth, nominalHeight, terrainView, origin, heightAt }) {
  const centerHeight = terrainView.getCanonicalHeight(entry.x, entry.z) ?? 0;
  const wallHeight = typeof heightAt === 'function'
    ? Math.max(0, heightAt(entry.distance))
    : nominalHeight;
  return {
    distance: entry.distance,
    left: [entry.x + entry.normalX * halfWidth - origin.x, entry.z + entry.normalZ * halfWidth - origin.z],
    right: [entry.x - entry.normalX * halfWidth - origin.x, entry.z - entry.normalZ * halfWidth - origin.z],
    bottom: centerHeight - FOUNDATION_OVERLAP,
    top: centerHeight + wallHeight,
    wallHeight,
  };
}

/**
 * Extrude one run of sampled points into the closed ribbon, origin-local.
 *
 * Every face has its own vertices, so the top reads as a top rather than a
 * rounded tube, and UVs are wall-local metres: `u` along the path (absolute arc
 * length, so neighbouring module shells continue the pattern), `v` up the
 * faces from the ground and across the top. The stone-detail material
 * (`ConstructionShellDetail`) sets the tile size.
 *
 * @param points from `shellSectionPoints`; the caller decides how much of the
 *   path a given shell covers.
 * @param options.heightAt optional wall-height function of absolute arc length
 *   `entry.distance`. Ruined shells pass the survivor envelope so far LOD
 *   follows the resolved crown instead of the nominal record height.
 */
export function buildShellGeometry(points, { record, terrainView, origin, heightAt = null }) {
  if (!points || points.length < 2) return null;
  const thickness = record.dimensions.thickness;
  const sections = points.map((entry) => shellSection(entry, {
    halfWidth: thickness / 2,
    nominalHeight: record.dimensions.height,
    terrainView,
    origin,
    heightAt,
  }));
  const positions = [];
  const uvs = [];
  const indices = [];
  const vertex = ([x, z], y, u, v) => {
    positions.push(x, y, z);
    uvs.push(u, v);
    return uvs.length / 2 - 1;
  };
  // Two vertex rows per face, wound so the computed normals face outward.
  const face = (rowA, rowB) => {
    const a = sections.map(rowA);
    const b = sections.map(rowB);
    for (let index = 0; index < sections.length - 1; index += 1) {
      indices.push(a[index], b[index], b[index + 1], a[index], b[index + 1], a[index + 1]);
    }
  };
  const base = -FOUNDATION_OVERLAP;
  face(
    (section) => vertex(section.left, section.bottom, section.distance, base),
    (section) => vertex(section.left, section.top, section.distance, section.wallHeight),
  );
  face(
    (section) => vertex(section.right, section.top, section.distance, section.wallHeight),
    (section) => vertex(section.right, section.bottom, section.distance, base),
  );
  face(
    (section) => vertex(section.left, section.top, section.distance, section.wallHeight),
    (section) => vertex(section.right, section.top, section.distance, section.wallHeight + thickness),
  );
  face(
    (section) => vertex(section.right, section.bottom, section.distance, base - thickness),
    (section) => vertex(section.left, section.bottom, section.distance, base),
  );
  const cap = (section, flip) => {
    const leftBottom = vertex(section.left, section.bottom, 0, base);
    const rightBottom = vertex(section.right, section.bottom, thickness, base);
    const rightTop = vertex(section.right, section.top, thickness, section.wallHeight);
    const leftTop = vertex(section.left, section.top, 0, section.wallHeight);
    indices.push(...(flip
      ? [leftBottom, leftTop, rightTop, leftBottom, rightTop, rightBottom]
      : [leftBottom, rightBottom, rightTop, leftBottom, rightTop, leftTop]));
  };
  cap(sections[0], false);
  cap(sections.at(-1), true);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.constructionId = record.id;
  geometry.userData.constructionRevision = record.revision;
  return geometry;
}

/** The whole-record ribbon, for the states that have no per-module plan yet. */
export function buildWallGeometry(record, terrainView, origin, { heightAt = null } = {}) {
  return buildShellGeometry(sampleShellPath(record).points, {
    record,
    terrainView,
    origin,
    heightAt,
  });
}
