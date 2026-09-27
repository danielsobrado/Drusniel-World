import * as THREE from 'three/webgpu';
import { sampleCubicBezierPath } from '../curve/CubicBezierPath.js';
import { survivingIntervals } from '../masonry/OpeningLayout.js';

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
 * The ribbon carries the record's opening contours: a doorway that is open at
 * near LOD must not fill back in when the module drops to shell. `survivingIntervals`
 * reserves the void per height, so the shell's faces are carved over the same
 * arc intervals the course packer packs around — one contour, agreeing across
 * near, coarse and shell (phase 11 §7.3/§11.3). A wall with no openings takes
 * the untouched ribbon path, so the cheap band pays nothing for the feature.
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

/**
 * Height bands sampled between an opening's sill and crown. The shell follows
 * the void's contour with flat trapezoids, so this sets how closely the crown
 * reads as an arch rather than as a stepped notch. Far below masonry's own
 * course count.
 */
const SHELL_ARCH_BANDS = 8;

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
    // Local grade. Opening heights are authored above this, so the carve is
    // solved in this frame and only turned into world Y at the last step.
    grade: centerHeight,
    left: [entry.x + entry.normalX * halfWidth - origin.x, entry.z + entry.normalZ * halfWidth - origin.z],
    right: [entry.x - entry.normalX * halfWidth - origin.x, entry.z - entry.normalZ * halfWidth - origin.z],
    bottom: centerHeight - FOUNDATION_OVERLAP,
    top: centerHeight + wallHeight,
    wallHeight,
  };
}

function assembleGeometry(record, positions, uvs, indices) {
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

/**
 * Extrude one run of sampled points into the closed ribbon, origin-local.
 *
 * Every face has its own vertices, so the top reads as a top rather than a
 * rounded tube, and UVs are wall-local metres: `u` along the path (absolute arc
 * length, so neighbouring module shells continue the pattern), `v` up the
 * faces from the ground and across the top. The stone-detail material
 * (`ConstructionShellDetail`) sets the tile size.
 *
 * No openings: the ribbon is emitted whole, exactly as it always was.
 */
function buildPlainShell(points, { record, terrainView, origin, heightAt = null }) {
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

  return assembleGeometry(record, positions, uvs, indices);
}

/** Segment start/end arc lengths of the shell's own sampling, per path. */
const shellSegmentRanges = new WeakMap();

function segmentRangesFor(record) {
  const cached = shellSegmentRanges.get(record.path);
  if (cached) return cached;
  const sampled = sampleShellPath(record);
  const order = [];
  const ends = new Map();
  for (const point of sampled.points) {
    if (!ends.has(point.segmentId)) order.push(point.segmentId);
    ends.set(point.segmentId, Math.max(ends.get(point.segmentId) ?? 0, point.distance));
  }
  const ranges = new Map();
  let previousEnd = 0;
  for (let index = 0; index < order.length; index += 1) {
    const segmentId = order[index];
    const end = index === order.length - 1 ? sampled.totalDistance : ends.get(segmentId);
    ranges.set(segmentId, { start: previousEnd, end });
    previousEnd = end;
  }
  shellSegmentRanges.set(record.path, ranges);
  return ranges;
}

/**
 * The record's openings in the shell's own arc domain.
 *
 * Features are authored as `{ segmentId, arcFraction }`; the shell samples the
 * same curve with its own tolerances, so the arc coordinate is re-derived here
 * rather than borrowed from the planner's table. That keeps an opening on its
 * jambs whatever sampling the two happen to use.
 */
function shellOpenings(record) {
  const features = record.features;
  if (!Array.isArray(features) || features.length === 0) return [];
  const ranges = segmentRangesFor(record);
  const openings = [];
  for (const feature of features) {
    const range = ranges.get(feature.segmentId);
    if (!range) continue;
    openings.push({ ...feature, s: range.start + (range.end - range.start) * feature.arcFraction });
  }
  return openings;
}

/** Local heights at which an opening's contour changes direction. */
function openingLocalLevels(opening) {
  const sill = opening.sill;
  const crown = sill + opening.height;
  if (opening.profile === 'flat') return [sill, crown];
  const levels = [];
  for (let index = 0; index <= SHELL_ARCH_BANDS; index += 1) {
    levels.push(sill + (opening.height * index) / SHELL_ARCH_BANDS);
  }
  return levels;
}

/**
 * The ribbon, carved around the record's openings.
 *
 * Faces are cut over the opening's arc intervals at bands of local height: the
 * solid spans at a band's bottom and top edges come straight from
 * `survivingIntervals`, and where the contour narrows the pair of spans is
 * joined as a trapezoid so the silhouette follows the arch instead of stepping
 * across it. A section pair no opening reaches stays one quad.
 */
function buildCarvedShell(points, { record, terrainView, origin, heightAt = null, openings }) {
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
  const quad = (p0, p1, p2, p3) => {
    indices.push(p0, p1, p2, p0, p2, p3);
  };

  const base = -FOUNDATION_OVERLAP;
  const topLocal = sections.reduce((max, section) => Math.max(max, section.wallHeight), 0);

  /** A virtual section anywhere on the run, so the carve can sit between samples. */
  function stationAt(distance) {
    const first = sections[0];
    const last = sections.at(-1);
    if (distance <= first.distance) return { ...first, distance };
    if (distance >= last.distance) return { ...last, distance };
    for (let index = 1; index < sections.length; index += 1) {
      const before = sections[index - 1];
      const after = sections[index];
      if (after.distance < distance) continue;
      const span = after.distance - before.distance;
      const t = span > 0 ? (distance - before.distance) / span : 0;
      const mix = (a, b) => a + (b - a) * t;
      return {
        distance,
        left: [mix(before.left[0], after.left[0]), mix(before.left[1], after.left[1])],
        right: [mix(before.right[0], after.right[0]), mix(before.right[1], after.right[1])],
        grade: mix(before.grade, after.grade),
        wallHeight: mix(before.wallHeight, after.wallHeight),
        bottom: mix(before.bottom, after.bottom),
        top: mix(before.top, after.top),
      };
    }
    return { ...last, distance };
  }

  function sideNode(face, distance, level) {
    const station = stationAt(distance);
    const top = station.grade + station.wallHeight;
    const y = level >= topLocal ? top : Math.min(station.grade + level, top);
    const position = face === 'left' ? station.left : station.right;
    return { x: position[0], y, z: position[1], u: distance, v: y - station.grade };
  }

  function pushNode(node) {
    positions.push(node.x, node.y, node.z);
    uvs.push(node.u, node.v);
    return uvs.length / 2 - 1;
  }

  function emitPlainSideQuad(face, index) {
    const a = sections[index];
    const b = sections[index + 1];
    const key = face === 'left' ? 'left' : 'right';
    const aBottom = vertex(a[key], a.bottom, a.distance, base);
    const aTop = vertex(a[key], a.top, a.distance, a.wallHeight);
    const bBottom = vertex(b[key], b.bottom, b.distance, base);
    const bTop = vertex(b[key], b.top, b.distance, b.wallHeight);
    if (face === 'left') quad(aBottom, aTop, bTop, bBottom);
    else quad(aTop, aBottom, bBottom, bTop);
  }

  function emitTrapezoid(face, bottomStart, bottomEnd, topStart, topEnd, low, high) {
    const b0 = sideNode(face, bottomStart, low);
    const b1 = sideNode(face, bottomEnd, low);
    const t0 = sideNode(face, topStart, high);
    const t1 = sideNode(face, topEnd, high);
    // Degenerate where the ruin envelope has collapsed under a level; skip it
    // so the normal pass never sees a zero-area triangle.
    const d1x = t1.x - b0.x;
    const d1y = t1.y - b0.y;
    const d1z = t1.z - b0.z;
    const d2x = b1.x - t0.x;
    const d2y = b1.y - t0.y;
    const d2z = b1.z - t0.z;
    const cx = d1y * d2z - d1z * d2y;
    const cy = d1z * d2x - d1x * d2z;
    const cz = d1x * d2y - d1y * d2x;
    if (cx * cx + cy * cy + cz * cz < 1e-12) return;
    const b0i = pushNode(b0);
    const t0i = pushNode(t0);
    const t1i = pushNode(t1);
    const b1i = pushNode(b1);
    if (face === 'left') quad(b0i, t0i, t1i, b1i);
    else quad(t0i, b0i, b1i, t1i);
  }

  function emitSideFace(face) {
    for (let index = 0; index < sections.length - 1; index += 1) {
      const from = sections[index].distance;
      const to = sections[index + 1].distance;
      const relevant = openings.filter((opening) => (
        opening.s + opening.width / 2 + 0.02 > from
        && opening.s - opening.width / 2 - 0.02 < to
      ));
      if (relevant.length === 0) {
        emitPlainSideQuad(face, index);
        continue;
      }
      const levelSet = new Set([base, topLocal]);
      for (const opening of relevant) {
        for (const level of openingLocalLevels(opening)) {
          if (level > base && level < topLocal) levelSet.add(level);
        }
      }
      const levels = [...levelSet].sort((a, b) => a - b);
      for (let band = 0; band < levels.length - 1; band += 1) {
        emitBand(face, from, to, levels[band], levels[band + 1], 0);
      }
    }
  }

  /**
   * A void band, edge-on. A flat profile keeps its full half-width *at* the
   * crown, so each edge is probed just inside the band: the contour is stepped
   * at the sill and crown and continuous in between, and sampling the exact
   * level would make the band above the crown inherit the void below it.
   */
  function emitBand(face, from, to, low, high, depth) {
    const bottomSpans = survivingIntervals([from, to], openings, low + SEAM_EPSILON);
    const topSpans = survivingIntervals([from, to], openings, high - SEAM_EPSILON);
    if (bottomSpans.length === topSpans.length) {
      for (let span = 0; span < bottomSpans.length; span += 1) {
        emitTrapezoid(
          face,
          bottomSpans[span][0],
          bottomSpans[span][1],
          topSpans[span][0],
          topSpans[span][1],
          low,
          high,
        );
      }
      return;
    }
    // A void opening or closing inside the band; split until both edges agree.
    if (depth >= 8 || !(high - low > 1e-4)) return;
    const middle = (low + high) / 2;
    emitBand(face, from, to, low, middle, depth + 1);
    emitBand(face, from, to, middle, high, depth + 1);
  }

  function emitTopFace() {
    for (let index = 0; index < sections.length - 1; index += 1) {
      const from = sections[index].distance;
      const to = sections[index + 1].distance;
      const spans = survivingIntervals([from, to], openings, topLocal);
      const whole = spans.length === 1
        && spans[0][0] <= from + SEAM_EPSILON
        && spans[0][1] >= to - SEAM_EPSILON;
      if (whole) {
        const a = sections[index];
        const b = sections[index + 1];
        quad(
          vertex(a.left, a.top, a.distance, a.wallHeight),
          vertex(a.right, a.top, a.distance, a.wallHeight + thickness),
          vertex(b.right, b.top, b.distance, b.wallHeight + thickness),
          vertex(b.left, b.top, b.distance, b.wallHeight),
        );
        continue;
      }
      // An opening that breaches the crown must not be capped back over.
      for (const [s0, s1] of spans) {
        const start = stationAt(s0);
        const end = stationAt(s1);
        const startTop = start.grade + start.wallHeight;
        const endTop = end.grade + end.wallHeight;
        quad(
          vertex(start.left, startTop, start.distance, start.wallHeight),
          vertex(start.right, startTop, start.distance, start.wallHeight + thickness),
          vertex(end.right, endTop, end.distance, end.wallHeight + thickness),
          vertex(end.left, endTop, end.distance, end.wallHeight),
        );
      }
    }
  }

  function emitBottomFace() {
    for (let index = 0; index < sections.length - 1; index += 1) {
      const a = sections[index];
      const b = sections[index + 1];
      quad(
        vertex(a.right, a.bottom, a.distance, base - thickness),
        vertex(a.left, a.bottom, a.distance, base),
        vertex(b.left, b.bottom, b.distance, base),
        vertex(b.right, b.bottom, b.distance, base - thickness),
      );
    }
  }

  emitSideFace('left');
  emitSideFace('right');
  emitTopFace();
  emitBottomFace();

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

  return assembleGeometry(record, positions, uvs, indices);
}

/**
 * @param points from `shellSectionPoints`; the caller decides how much of the
 *   path a given shell covers.
 * @param options.heightAt optional wall-height function of absolute arc length
 *   `entry.distance`. Ruined shells pass the survivor envelope so far LOD
 *   follows the resolved crown instead of the nominal record height.
 */
export function buildShellGeometry(points, { record, terrainView, origin, heightAt = null }) {
  if (!points || points.length < 2) return null;
  const openings = shellOpenings(record);
  if (openings.length === 0) {
    return buildPlainShell(points, { record, terrainView, origin, heightAt });
  }
  return buildCarvedShell(points, { record, terrainView, origin, heightAt, openings });
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
