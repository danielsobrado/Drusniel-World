import * as THREE from 'three/webgpu';
import { scaleCorners } from '../masonry/CourseLattice.js';
import { openingVerticalSpan, survivingIntervalsOverBand } from '../masonry/OpeningLayout.js';
import { CONSTRUCTION_MORTAR_CONFIG } from '../render/ConstructionMortarConfig.js';

const VERTICES_PER_PRISM = 24;
const INDICES_PER_PRISM = 36;
const FACES_PER_PRISM = 6;
const DEGENERATE_EPSILON = 1e-6;

/**
 * Absolute expansion of a face ring in metres around its bounding-box centre.
 *
 * Uses metres, not a percentage of stone size, so joints behind large and small
 * stones stay comparable.
 */
export function expandCorners(corners, overlap, {
  maxScale = CONSTRUCTION_MORTAR_CONFIG.maxCornerScale,
} = {}) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of corners) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const width = maxX - minX;
  const height = maxY - minY;
  const scaleX = Math.min(maxScale, 1 + (overlap * 2) / Math.max(width, DEGENERATE_EPSILON));
  const scaleY = Math.min(maxScale, 1 + (overlap * 2) / Math.max(height, DEGENERATE_EPSILON));
  return scaleCorners(corners, scaleX, scaleY);
}

/** Recessed core thickness for a stone of the given depth. */
export function mortarCoreDepth(stoneDepth, config = CONSTRUCTION_MORTAR_CONFIG) {
  return Math.max(config.minimumDepth, stoneDepth - config.faceRecess * 2);
}

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function faceBounds(corners) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of corners) {
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
      return { minX: NaN, maxX: NaN, minY: NaN, maxY: NaN, width: NaN, height: NaN };
    }
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function validateDescriptor(descriptor, index) {
  if (!descriptor || !Array.isArray(descriptor.corners)) {
    throw new Error(`Mortar descriptor ${index}: corners must be an array of four [x, y] points.`);
  }
  if (descriptor.corners.length !== 4) {
    throw new Error(
      `Mortar descriptor ${index}: corner ring must have exactly four entries, got ${descriptor.corners.length}.`,
    );
  }
  if (!isFiniteNumber(descriptor.depth) || descriptor.depth <= 0) {
    throw new Error(
      `Mortar descriptor ${index}: depth must be a finite number greater than zero, got ${descriptor.depth}.`,
    );
  }
  const position = descriptor.position;
  if (
    !Array.isArray(position)
    || position.length !== 3
    || !position.every(isFiniteNumber)
  ) {
    throw new Error(`Mortar descriptor ${index}: position must be a finite [x, y, z] triple.`);
  }
  const rotation = descriptor.rotation ?? [0, 0, 0];
  if (
    !Array.isArray(rotation)
    || rotation.length !== 3
    || !rotation.every(isFiniteNumber)
  ) {
    throw new Error(`Mortar descriptor ${index}: rotation must be a finite [x, y, z] triple.`);
  }
  const bounds = faceBounds(descriptor.corners);
  if (
    !isFiniteNumber(bounds.width)
    || !isFiniteNumber(bounds.height)
    || bounds.width <= DEGENERATE_EPSILON
    || bounds.height <= DEGENERATE_EPSILON
  ) {
    throw new Error(
      `Mortar descriptor ${index}: face ring is degenerate (width=${bounds.width}, height=${bounds.height}).`,
    );
  }
  if (descriptor.uvDensity != null && !isFiniteNumber(descriptor.uvDensity)) {
    throw new Error(`Mortar descriptor ${index}: uvDensity must be finite when provided.`);
  }
}

/**
 * Heights at which the shared contour changes, clipped to a prism's own band.
 *
 * A sill or a crown inside the band splits it, so a core that reaches from
 * below the sill to above the crown is only cut between them — masonry above
 * the opening keeps its backing.
 */
function contourLevels(openings, bottom, top) {
  const levels = new Set([bottom, top]);
  for (const opening of openings) {
    const { sill, crown } = openingVerticalSpan(opening);
    if (sill > bottom + DEGENERATE_EPSILON && sill < top - DEGENERATE_EPSILON) {
      levels.add(sill);
    }
    if (crown > bottom + DEGENERATE_EPSILON && crown < top - DEGENERATE_EPSILON) {
      levels.add(crown);
    }
  }
  return [...levels].sort((left, right) => left - right);
}

/**
 * Split a descriptor's face ring so its core stays out of the wall's openings.
 *
 * The void is read from the shared contour (`survivingIntervalsOverBand`), never
 * re-derived, so the mortar publishes the same opening the shell and the course
 * packer do (phase 11 §7.3). A prism can only be placed against the contour when
 * it carries its own wall frame: the rounded builder attaches `drapeFrame` (the
 * stone's arc position) and leaves `position[1]` as the stone's height above
 * grade. Without that frame the prism is returned unclipped — the soft path
 * resolves its own ground and so has no grade-relative height to test.
 *
 * The prism is split at the sill and crown and each band is cut horizontally,
 * exact for a rectangular ring. The band's widest void is used, and because a
 * course is packed at its centre the stones always reach at least as far into
 * that band's void as the cut removes, so nothing shows a hole. A span the void
 * consumes entirely is omitted — a bounded local omission, not the minimum-piece
 * policy phase 11 §7.3 assigns to W5.
 *
 * @returns {number[][][] | null} fragment rings, or null to emit the prism whole.
 */
function clipDescriptorToOpenings(descriptor, openings) {
  const frame = descriptor.drapeFrame;
  const corners = descriptor.corners;
  if (!frame || !Array.isArray(corners) || corners.length !== 4) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of corners) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const arcLow = frame.s + minX;
  const arcHigh = frame.s + maxX;
  const grade = descriptor.position[1];
  const levels = contourLevels(openings, grade + minY, grade + maxY);

  const fragments = [];
  let clipped = false;
  for (let index = 0; index < levels.length - 1; index += 1) {
    const lowY = levels[index];
    const highY = levels[index + 1];
    const spans = survivingIntervalsOverBand([arcLow, arcHigh], openings, [lowY, highY]);
    if (spans.length === 0) {
      clipped = true;
      continue;
    }
    const localLowY = lowY - grade;
    const localHighY = highY - grade;
    // Corner order is bottom-left, bottom-right, top-right, top-left.
    for (const [from, to] of spans) {
      const localFrom = from - frame.s;
      const localTo = to - frame.s;
      if (
        Math.abs(localFrom - minX) > DEGENERATE_EPSILON
        || Math.abs(localTo - maxX) > DEGENERATE_EPSILON
        || Math.abs(localLowY - minY) > DEGENERATE_EPSILON
        || Math.abs(localHighY - maxY) > DEGENERATE_EPSILON
      ) {
        clipped = true;
      }
      fragments.push([
        [localFrom, localLowY],
        [localTo, localLowY],
        [localTo, localHighY],
        [localFrom, localHighY],
      ]);
    }
  }
  return clipped ? fragments : null;
}

/** The prisms to write: each descriptor, or its contour-clipped fragments. */
function planPrisms(descriptors, openings) {
  if (!Array.isArray(openings) || openings.length === 0) {
    return descriptors.map((descriptor) => ({ descriptor, corners: descriptor.corners }));
  }
  const prisms = [];
  for (const descriptor of descriptors) {
    const clipped = clipDescriptorToOpenings(descriptor, openings);
    if (!clipped) {
      prisms.push({ descriptor, corners: descriptor.corners });
      continue;
    }
    for (const corners of clipped) prisms.push({ descriptor, corners });
  }
  return prisms;
}

/**
 * Write one module-level BufferGeometry of recessed mortar prisms.
 *
 * Allocates typed arrays once. Each prism uses 24 independent vertices (six
 * hard faces × four corners) so normals stay face-sharp without
 * `computeVertexNormals()`.
 *
 * @param {Array<{
 *   corners: number[][],
 *   depth: number,
 *   position: number[],
 *   rotation?: number[],
 *   uvDensity?: number,
 *   drapeFrame?: { s: number },
 * }>} descriptors
 * @param {object} [options]
 * @param {(descriptor: object, x: number, z: number) => number} [options.drape]
 *   vertical offset for a transformed vertex, so a core can follow the same
 *   ground its draped stones do. Omitted, positions are used as given.
 * @param {Array<object>} [options.openings] the module's openings in the wall's
 *   own arc domain (`s`, `width`, `height`, `sill`, `profile`). When given, each
 *   prism that carries a `drapeFrame` is clipped to the shared contour so its
 *   core never fills a visible void.
 * @returns {THREE.BufferGeometry | null}
 */
export function buildMortarCoreGeometry(descriptors, { drape = null, openings = null } = {}) {
  if (!descriptors || descriptors.length === 0) return null;

  for (let index = 0; index < descriptors.length; index += 1) {
    validateDescriptor(descriptors[index], index);
  }

  const prisms = planPrisms(descriptors, openings);
  if (prisms.length === 0) return null;

  const prismCount = prisms.length;
  const vertexCount = prismCount * VERTICES_PER_PRISM;
  const indexCount = prismCount * INDICES_PER_PRISM;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = vertexCount <= 65_535
    ? new Uint16Array(indexCount)
    : new Uint32Array(indexCount);

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const translation = new THREE.Vector3();
  const scale = new THREE.Vector3(1, 1, 1);
  const point = new THREE.Vector3();
  const normal = new THREE.Vector3();

  let vertexOffset = 0;
  let indexOffset = 0;

  for (let prismIndex = 0; prismIndex < prismCount; prismIndex += 1) {
    const { descriptor, corners } = prisms[prismIndex];
    const halfDepth = descriptor.depth / 2;
    const uvDensity = descriptor.uvDensity ?? CONSTRUCTION_MORTAR_CONFIG.uvDensity;
    const rotation = descriptor.rotation ?? [0, 0, 0];

    euler.set(rotation[0], rotation[1], rotation[2], 'XYZ');
    quaternion.setFromEuler(euler);
    translation.set(descriptor.position[0], descriptor.position[1], descriptor.position[2]);
    matrix.compose(translation, quaternion, scale);

    // Front ring at +z, back ring at -z (stone-local, before transform).
    const local = [
      // front: bottom-left, bottom-right, top-right, top-left
      [corners[0][0], corners[0][1], halfDepth],
      [corners[1][0], corners[1][1], halfDepth],
      [corners[2][0], corners[2][1], halfDepth],
      [corners[3][0], corners[3][1], halfDepth],
      // back
      [corners[0][0], corners[0][1], -halfDepth],
      [corners[1][0], corners[1][1], -halfDepth],
      [corners[2][0], corners[2][1], -halfDepth],
      [corners[3][0], corners[3][1], -halfDepth],
    ];

    // Six faces as corner index quads (CCW from outside).
    const faces = [
      { corners: [0, 1, 2, 3], normal: [0, 0, 1], uv: 'front' }, // front
      { corners: [5, 4, 7, 6], normal: [0, 0, -1], uv: 'back' }, // back
      { corners: [4, 0, 3, 7], normal: [-1, 0, 0], uv: 'side' }, // left
      { corners: [1, 5, 6, 2], normal: [1, 0, 0], uv: 'side' }, // right
      { corners: [3, 2, 6, 7], normal: [0, 1, 0], uv: 'top' }, // top
      { corners: [4, 5, 1, 0], normal: [0, -1, 0], uv: 'bottom' }, // bottom
    ];

    const baseVertex = vertexOffset;
    for (let faceIndex = 0; faceIndex < FACES_PER_PRISM; faceIndex += 1) {
      const face = faces[faceIndex];
      normal.set(face.normal[0], face.normal[1], face.normal[2]).applyQuaternion(quaternion);
      const nx = normal.x;
      const ny = normal.y;
      const nz = normal.z;

      for (let cornerIndex = 0; cornerIndex < 4; cornerIndex += 1) {
        const localPoint = local[face.corners[cornerIndex]];
        point.set(localPoint[0], localPoint[1], localPoint[2]).applyMatrix4(matrix);
        if (drape) point.y += drape(descriptor, point.x, point.z);
        const vertex = vertexOffset;
        positions[vertex * 3] = point.x;
        positions[vertex * 3 + 1] = point.y;
        positions[vertex * 3 + 2] = point.z;
        normals[vertex * 3] = nx;
        normals[vertex * 3 + 1] = ny;
        normals[vertex * 3 + 2] = nz;

        let u;
        let v;
        if (face.uv === 'front' || face.uv === 'back') {
          u = localPoint[0] * uvDensity;
          v = localPoint[1] * uvDensity;
        } else if (face.uv === 'side') {
          u = localPoint[2] * uvDensity;
          v = localPoint[1] * uvDensity;
        } else {
          u = localPoint[0] * uvDensity;
          v = localPoint[2] * uvDensity;
        }
        uvs[vertex * 2] = u;
        uvs[vertex * 2 + 1] = v;
        vertexOffset += 1;
      }

      const faceBase = baseVertex + faceIndex * 4;
      indices[indexOffset++] = faceBase;
      indices[indexOffset++] = faceBase + 1;
      indices[indexOffset++] = faceBase + 2;
      indices[indexOffset++] = faceBase;
      indices[indexOffset++] = faceBase + 2;
      indices[indexOffset++] = faceBase + 3;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.mortarPrisms = prismCount;
  geometry.userData.mortarTriangles = prismCount * 12;
  return geometry;
}
