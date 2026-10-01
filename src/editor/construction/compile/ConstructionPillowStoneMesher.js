import { projectedUvAt, WORKSHOP_UV_DENSITY } from '../../workshop/WorkshopProjectedUv.js';
import { domeFactor } from '../masonry/StonePillowField.js';
import { createPillowRim } from './PillowStoneRim.js';
import {
  createRoundedOutline,
  normalizeConvexQuad,
  outlinePointCount,
} from './PillowStoneOutline.js';

/**
 * Mesh one rounded "pillow" stone into a `MasonryVertexWriter`.
 *
 * The stone is the face quad the packer solved, extruded through the wall and
 * rounded three ways: its outline's corners are arcs in the face plane
 * (`PillowStoneOutline`), each face rolls back into the joint along a quarter
 * ellipse with sampled width and depth, and each face domes outward, peaking at
 * its centre. Rim rings come first, outermost (the silhouette) to innermost (the
 * edge of the dome); dome rings follow, then a centre vertex. The front and back
 * faces share their outermost ring's footprint, so the side band between them
 * is a straight extrusion that reuses those rings' vertices.
 *
 * Normals are analytic for uniform rims and approximate for uneven rims; the
 * dome uses its radial slope. Faceted styles use the material's geometric
 * normals, while rounded styles keep smooth shading. There is no mesh-wide
 * `computeVertexNormals` pass. Colour is baked by the caller, and every vertex
 * gets one, which is what a `vertexColors` material requires (CLAUDE.md).
 *
 * Three.js-free.
 */

const HALF_PI = Math.PI / 2;
/** Attempts to fit a pillow into a quad too narrow for its sampled radii. */
const FIT_ATTEMPTS = 4;
const FIT_SHRINK = 0.7;

/** Vertices and triangles one stone costs at a tessellation level. */
/**
 * Face height profile and its derivative in rho at normalised radius `rho`.
 * `flatness` 0 is the original dome, kept bit-identical.
 */
export function faceProfile(rho, flatness = 0) {
  if (!(flatness > 0)) {
    const falloff = 1 - rho * rho;
    return { profile: falloff * falloff, slopeProfile: -4 * rho * falloff };
  }
  const exponent = 2 + 2 * Math.min(1, flatness);
  const power = rho ** exponent;
  const falloff = 1 - power;
  return {
    profile: falloff * falloff,
    slopeProfile: -2 * falloff * exponent * (rho > 0 ? power / rho : 0),
  };
}

export function estimatePillowStone({ arcSegments, edgeSegments = 1, rimRings, faceRings }) {
  const pointCount = outlinePointCount(arcSegments, edgeSegments);
  const faceVertices = (rimRings + 1 + faceRings) * pointCount + 1;
  const faceTriangles = (rimRings + faceRings) * pointCount * 2 + pointCount;
  return {
    pointCount,
    vertices: faceVertices * 2,
    triangles: faceTriangles * 2 + pointCount * 2,
  };
}

/** Row-major rotation matrix for a Three.js 'XYZ' Euler triple. */
export function eulerXYZMatrix([x, y, z]) {
  const a = Math.cos(x);
  const b = Math.sin(x);
  const c = Math.cos(y);
  const d = Math.sin(y);
  const e = Math.cos(z);
  const f = Math.sin(z);
  return [
    c * e, -c * f, d,
    a * f + b * e * d, a * e - b * f * d, -b * c,
    b * f - a * e * d, b * e + a * f * d, a * c,
  ];
}

function scaleFace(face, scale) {
  return { ...face, edgeRadius: face.edgeRadius * scale, bulge: face.bulge * scale };
}

/** Fit the outline, shrinking the whole pillow if its corners do not fit. */
function fitOutline(ring, pillow, arcSegments, edgeSegments) {
  let scale = 1;
  for (let attempt = 0; attempt < FIT_ATTEMPTS; attempt += 1) {
    const outline = createRoundedOutline(ring, pillow.cornerRadius * scale, arcSegments,
      pillow.cornerRadii?.map(radius => radius * scale), edgeSegments);
    if (outline) {
      return {
        outline,
        front: scale === 1 ? pillow.front : scaleFace(pillow.front, scale),
        back: scale === 1 ? pillow.back : scaleFace(pillow.back, scale),
        shrunk: scale !== 1,
      };
    }
    scale *= FIT_SHRINK;
  }
  return null;
}

function ringBounds(ring) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { minX, maxX, minY, maxY };
}

/**
 * Per-stone vertex emitter: transform, drape, project UVs, shade, write.
 * Kept as a closure over reusable scratch so a stone allocates nothing per
 * vertex.
 */
export function createStoneVertexEmitter(writer, {
  matrix,
  position,
  bounds,
  shade,
  drape,
  uvDensity,
  exposure,
}) {
  const color = [0, 0, 0];
  const uv = [0, 0];
  const ground = [0, 0];
  const bent = [0, 0, 0, 0];
  const bend = drape?.bend ?? null;
  const spanY = Math.max(1e-6, bounds.maxY - bounds.minY);
  const hasExposure = exposure?.top || exposure?.bottom || exposure?.start || exposure?.end;
  const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = matrix;

  return function emit(lx, ly, lz, lnx, lny, lnz, crevice) {
    let px = m0 * lx + m1 * ly + m2 * lz + position[0];
    let py = m3 * lx + m4 * ly + m5 * lz + position[1];
    let pz = m6 * lx + m7 * ly + m8 * lz + position[2];
    let nx = m0 * lnx + m1 * lny + m2 * lnz;
    let ny = m3 * lnx + m4 * lny + m5 * lnz;
    let nz = m6 * lnx + m7 * lny + m8 * lnz;
    const aboveGrade = py;

    if (drape) {
      // A vertical shear by the ground along the wall: joints that two stones
      // share land on the same ground height, so courses follow a slope without
      // stepping at every head joint. Normals follow the shear's inverse
      // transpose, n - slope * n.y * tangent.
      drape.sample(px, pz, ground);
      py += ground[0];
      const slope = ground[1];
      if (slope !== 0) {
        const lift = slope * ny;
        nx -= lift * drape.tangentX;
        nz -= lift * drape.tangentZ;
        const length = Math.hypot(nx, ny, nz) || 1;
        nx /= length;
        ny /= length;
        nz /= length;
      }
    }
    if (bend) {
      // Onto the arc, after the drape: the drape reads its along-wall position
      // from the stone's own straight frame (compile/ConstructionArcBend.js).
      bend(px, pz, nx, nz, bent);
      [px, pz, nx, nz] = bent;
    }

    projectedUvAt(uv, 0, px, py, pz, nx, ny, nz, uvDensity);
    // A rim only has contact shadow on edges buried against another stone.
    // Blend by the local normal so the open top/end rolls smoothly into the
    // shaded face joint, even after the stone rotates with a curved path.
    const open = hasExposure ? Math.max(
      0, exposure.top ? lny : 0, exposure.start ? -lnx : 0, exposure.end ? lnx : 0,
      exposure.bottom ? -lny : 0,
    ) : 0;
    shade(color, aboveGrade, (ly - bounds.minY) / spanY, crevice * (1 - open), ny);
    return writer.vertex(px, py, pz, nx, ny, nz, color[0], color[1], color[2], uv[0], uv[1]);
  };
}

/**
 * Write one side's rim rings, dome rings and centre. Returns the index of each
 * vertex of the outermost ring, which the side band reuses.
 */
function writeFace(writer, emit, {
  outline,
  face,
  sign,
  halfDepth,
  rimRings,
  faceRings,
  centroid,
  halfWidth,
  halfHeight,
  creviceScale,
}) {
  const pointCount = outline.pointCount;
  const rim = createPillowRim(outline, face, halfDepth);
  const bulge = face.bulge;
  const summit = halfDepth + bulge;
  const rings = [];

  for (let ring = 0; ring <= rimRings; ring += 1) {
    const angle = (HALF_PI * ring) / rimRings;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const indices = new Array(pointCount);
    for (let point = 0; point < pointCount; point += 1) {
      const width = rim.widths[point];
      const depth = rim.depths[point];
      const inset = width * (1 - cosine);
      const height = halfDepth - depth + depth * sine;
      const crevice = Math.min(1, (summit - height) / creviceScale);
      // Elliptic bevels: width and depth need not agree. At either end the
      // normal still meets the side band and broad face without a seam.
      const nx = cosine * depth;
      const nz = sine * width;
      const normalLength = Math.hypot(nx, nz);
      indices[point] = emit(
        outline.pointX(point, inset),
        outline.pointY(point, inset),
        sign * height,
        nx / normalLength * outline.normalX(point),
        nx / normalLength * outline.normalY(point),
        sign * nz / normalLength,
        crevice,
      );
    }
    rings.push(indices);
  }

  // The dome: rings scaled toward the centroid from the rim's innermost ring.
  // Height follows bulge * (1 - rho^n)^2 with n = 2 + 2 * flatness — a full
  // dome at 0, a broad plateau at 1 — flat where it meets the rim so there is
  // no crease ring, and tilted/twisted per face by `domeFactor`.
  const [cx, cy] = centroid;
  const flatness = face.flatness ?? 0;
  for (let ring = 1; ring <= faceRings; ring += 1) {
    const rho = 1 - ring / (faceRings + 1);
    const { profile, slopeProfile } = faceProfile(rho, flatness);
    const indices = new Array(pointCount);
    for (let point = 0; point < pointCount; point += 1) {
      const edgeX = outline.pointX(point, rim.widths[point]);
      const edgeY = outline.pointY(point, rim.widths[point]);
      const radialX = edgeX - cx;
      const radialY = edgeY - cy;
      const radius = Math.hypot(radialX, radialY) || 1e-6;
      const x = cx + radialX * rho;
      const y = cy + radialY * rho;
      const dome = domeFactor(face, (x - cx) / halfWidth, (y - cy) / halfHeight);
      const lift = bulge * dome * profile;
      const slope = (bulge * dome * slopeProfile) / radius;
      const normalLength = Math.hypot(slope, 1);
      indices[point] = emit(
        x,
        y,
        sign * (halfDepth + lift),
        (-slope * radialX) / radius / normalLength,
        (-slope * radialY) / radius / normalLength,
        sign / normalLength,
        Math.max(0, (bulge - lift) / creviceScale),
      );
    }
    rings.push(indices);
  }

  const summitLift = bulge * domeFactor(face, 0, 0);
  const center = emit(cx, cy, sign * (halfDepth + summitLift), 0, 0, sign, 0);

  for (let band = 0; band + 1 < rings.length; band += 1) {
    const outer = rings[band];
    const inner = rings[band + 1];
    for (let point = 0; point < pointCount; point += 1) {
      const next = (point + 1) % pointCount;
      if (sign > 0) {
        writer.triangle(outer[point], outer[next], inner[next]);
        writer.triangle(outer[point], inner[next], inner[point]);
      } else {
        writer.triangle(outer[point], inner[next], outer[next]);
        writer.triangle(outer[point], inner[point], inner[next]);
      }
    }
  }
  const last = rings[rings.length - 1];
  for (let point = 0; point < pointCount; point += 1) {
    const next = (point + 1) % pointCount;
    if (sign > 0) writer.triangle(last[point], last[next], center);
    else writer.triangle(last[point], center, last[next]);
  }
  return rings[0];
}

/**
 * @param writer `MasonryVertexWriter`
 * @param stone `{ corners, depth, position, rotation, pillow }` — `corners` in
 *   the stone's face plane, `position` in module space with `y` above grade.
 * @param options.lod `{ arcSegments, edgeSegments, rimRings, faceRings }`
 * @param options.shade from `createRoundedStoneShader`
 * @param options.creviceReach crevice saturation depth in (edge radius + bulge)
 * @param options.exposure optional `{ top, start, end }` open face-plane edges
 * @param options.drape optional `{ tangentX, tangentZ, sample(x, z, out), bend? }`
 *   writing ground height and along-wall slope into `out[0]`, `out[1]`; `bend`
 *   is an optional `createStoneBend` that maps the stone onto a curved arc
 * @returns `{ vertices, triangles, shrunk }`, or null when the quad cannot be
 *   rounded and the caller must fall back to a prism.
 */
export function writePillowStone(writer, stone, {
  lod,
  shade,
  creviceReach = 1,
  drape = null,
  uvDensity = WORKSHOP_UV_DENSITY,
  exposure = null,
}) {
  const ring = normalizeConvexQuad(stone.corners);
  if (!ring || !(stone.depth > 0)) return null;
  const fitted = fitOutline(ring, stone.pillow, lod.arcSegments, lod.edgeSegments);
  if (!fitted) return null;

  const { outline } = fitted;
  const bounds = ringBounds(ring);
  const halfDepth = stone.depth / 2;
  const innerBounds = {
    halfWidth: Math.max(1e-4, (bounds.maxX - bounds.minX) / 2 - fitted.front.edgeRadius),
    halfHeight: Math.max(1e-4, (bounds.maxY - bounds.minY) / 2 - fitted.front.edgeRadius),
  };
  const estimate = estimatePillowStone(lod);
  writer.reserve(estimate.vertices, estimate.triangles * 3);
  const startVertices = writer.vertexCount;
  const startIndices = writer.indexCount;

  const emit = createStoneVertexEmitter(writer, {
    matrix: eulerXYZMatrix(stone.rotation),
    position: stone.position,
    bounds,
    shade,
    drape,
    uvDensity,
    exposure,
  });

  const sides = [];
  for (const [sign, face] of [[1, fitted.front], [-1, fitted.back]]) {
    const creviceScale = Math.max(1e-4, creviceReach * (face.edgeRadius + face.bulge));
    sides.push(writeFace(writer, emit, {
      outline,
      face,
      sign,
      halfDepth,
      rimRings: lod.rimRings,
      faceRings: lod.faceRings,
      centroid: outline.centroid,
      halfWidth: innerBounds.halfWidth,
      halfHeight: innerBounds.halfHeight,
      creviceScale,
    }));
  }

  // Side band: the front and back silhouettes share a footprint, so this is a
  // straight extrusion through the wall, wound to face outward.
  const [front, back] = sides;
  for (let point = 0; point < outline.pointCount; point += 1) {
    const next = (point + 1) % outline.pointCount;
    writer.triangle(front[point], back[point], back[next]);
    writer.triangle(front[point], back[next], front[next]);
  }

  return {
    vertices: writer.vertexCount - startVertices,
    triangles: (writer.indexCount - startIndices) / 3,
    shrunk: fitted.shrunk,
  };
}
