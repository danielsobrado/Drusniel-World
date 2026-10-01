import { mixSeed } from '../../workshop/ProceduralRandom.js';

/**
 * Deterministic pillow shaping for stones of a `rounded` style.
 *
 * The packer and `stoneJitter` own a stone's footprint, orientation and
 * protrusion. This decides only how that footprint is rounded off: the in-plane
 * radius of the face outline's corners, the radius of the rim along which each
 * face rolls back into its joint, and how far each face bulges. Rounding only
 * ever removes material inside the face ring and bulges along the face normal,
 * so a pillow stone stays inside the course band it was packed into (04-…md
 * §19, CLAUDE.md).
 *
 * Three.js-free. Lanes are keyed by record seed, `stableIndex` and a per-face
 * domain — the scheme `StoneFaceReliefField` uses — so rebuilding a module
 * reproduces every stone exactly and a neighbour's edit cannot re-roll it.
 */

const CORNER_DOMAIN = 0x6a09e667;
const FRONT_DOMAIN = 0xbb67ae85;
const BACK_DOMAIN = 0x3c6ef373;

/** Largest rim radius as a fraction of the shorter face side. */
const MAX_EDGE_TO_SHORT = 0.45;
/** Largest rim radius as a fraction of the stone depth, front and back together. */
const MAX_EDGE_TO_DEPTH = 0.3;
/** Corner radius ceiling; the inset core quad must keep some width. */
const MAX_CORNER_TO_SHORT = 0.48;
/** A bulge taller than this share of its rim would crease where they meet. */
const MAX_BULGE_TO_EDGE = 0.6;
/** The bulge tilt and twist never flatten a face below this share of its dome. */
const MIN_DOME_FACTOR = 0.25;

function lane(hash, shift) {
  return ((hash >>> shift) & 255) / 255;
}

function signedLane(hash, shift) {
  return (lane(hash, shift) - 0.5) * 2;
}

function lerp(from, to, amount) {
  return from + (to - from) * amount;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

/** How strongly this unit is rounded: dressings stay crisper than field stone. */
export function pillowScale(profile, { category = 'field', footing = false } = {}) {
  const categoryScale = profile.categories[category] ?? profile.categories.field;
  return categoryScale * (footing ? profile.footingScale : 1);
}

function sampleFace(profile, hash, { shortSide, depth, scale }) {
  const edge = profile.edgeRadius;
  const requested = shortSide * lerp(edge.ratioMin, edge.ratioMax, lane(hash, 0)) * scale;
  const edgeRadius = Math.min(
    Math.max(
      clamp(requested, edge.minimum * scale, edge.maximum),
      profile.minimumEdgeRadius,
    ),
    shortSide * MAX_EDGE_TO_SHORT,
    depth * MAX_EDGE_TO_DEPTH,
  );

  const bulgeProfile = profile.bulge;
  const bulge = Math.min(
    shortSide * lerp(bulgeProfile.ratioMin, bulgeProfile.ratioMax, lane(hash, 8)) * scale,
    bulgeProfile.maximum,
    edgeRadius * MAX_BULGE_TO_EDGE,
  );

  return Object.freeze({
    edgeRadius,
    bulge,
    // Alternating corners and edge midpoints, independent of LOD point count.
    // Front/back hashes differ; shrinking a fitted stone keeps these ratios.
    rimWidths: sampleRimScales(hash, 11, profile.rimVariation, scale),
    rimDepths: sampleRimScales(hash, 29, profile.rimVariation, scale),
    tiltU: signedLane(hash, 16) * profile.asymmetry,
    tiltV: signedLane(hash, 24) * profile.asymmetry,
    saddle: signedLane(mixSeed(hash, 1), 0) * profile.saddle,
    flatness: profile.faceFlatness ?? 0,
  });
}

function sampleRimScales(hash, domain, variation = 0, scale) {
  if (!(variation > 0)) return null;
  const amount = variation * Math.min(1, scale);
  return Object.freeze(Array.from({ length: 8 }, (_, index) =>
    1 + signedLane(mixSeed(hash ^ domain, index + 1), 8) * amount));
}

/**
 * Sample one stone's pillow shape.
 *
 * `width`/`height` are the stone's face extent and `depth` its through-wall
 * depth. The corner radius is shared by both faces so the stone's side band is a
 * straight extrusion; rim radius, bulge and tilt differ per face because the
 * far side of a wall is seen too and must not mirror the near side.
 *
 * @returns {Readonly<{ cornerRadius: number, cornerRadii: ReadonlyArray<number>|null, front: object, back: object }>}
 */
export function sampleStonePillow({
  profile,
  seed,
  stableIndex,
  category = 'field',
  footing = false,
  width,
  height,
  depth,
}) {
  if (!profile) throw new Error('StonePillowField: profile is required.');
  const shortSide = Math.min(width, height);
  if (!(shortSide > 0) || !(depth > 0)) {
    throw new Error(`StonePillowField: stone ${stableIndex} has a degenerate size.`);
  }
  const scale = pillowScale(profile, { category, footing });
  const base = seed >>> 0;
  const index = stableIndex >>> 0;

  const front = sampleFace(profile, mixSeed(base ^ FRONT_DOMAIN, index), {
    shortSide,
    depth,
    scale,
  });
  const back = sampleFace(profile, mixSeed(base ^ BACK_DOMAIN, index), {
    shortSide,
    depth,
    scale,
  });

  const cornerHash = mixSeed(base ^ CORNER_DOMAIN, index);
  const corner = profile.cornerRadius;
  const requested = shortSide
    * lerp(corner.ratioMin, corner.ratioMax, lane(cornerHash, 0))
    * scale;
  const cornerRadius = Math.min(
    Math.max(requested, front.edgeRadius, back.edgeRadius),
    shortSide * MAX_CORNER_TO_SHORT,
  );

  // Keep both faces on the same footprint. Independent stable lanes change
  // corner wear without changing packing, neighbouring stones or tessellation.
  const variation = (corner.variation ?? 0) * Math.min(1, scale);
  const cornerRadii = variation > 0 ? Object.freeze(Array.from({ length: 4 }, (_, i) =>
    clamp(cornerRadius * (1 + signedLane(mixSeed(cornerHash, i + 1), 8) * variation),
      Math.max(front.edgeRadius, back.edgeRadius), shortSide * MAX_CORNER_TO_SHORT))) : null;
  return Object.freeze({ cornerRadius, cornerRadii, front, back });
}

/**
 * The dome factor a face's tilt and twist apply at normalised face coordinates
 * `u`, `v` in [-1, 1]. Clamped so no part of a face dips behind its rim.
 */
export function domeFactor(face, u, v) {
  return clamp(
    1 + face.tiltU * u + face.tiltV * v + face.saddle * u * v,
    MIN_DOME_FACTOR,
    2 - MIN_DOME_FACTOR,
  );
}
