import { constructionStyle } from '../masonry/ConstructionStyleCatalog.js';
import { scaleCorners } from '../masonry/CourseLattice.js';
import {
  CONSTRUCTION_MORTAR_CONFIG,
  overlapForCategory,
} from '../render/ConstructionMortarConfig.js';
import { expandCorners, mortarCoreDepth } from './ConstructionMortarCoreBuilder.js';

/**
 * Stone shape resolution shared by every masonry mesher.
 *
 * Turns a packer placement plus `stoneJitter`'s output into the one resolved
 * shape both the visible stone and its mortar backing are built from, so the
 * soft bevelled-prism builder and the rounded pillow-stone builder cannot
 * disagree about where a stone is. Three.js-free.
 */

/**
 * How much of `stoneJitter`'s in-plane shaping a lattice stone keeps.
 *
 * A packed box is an island: resizing it ±10% or rolling it a couple of degrees
 * just varies the stone, because the mortar gap around it was never meant to
 * close. A lattice stone is the opposite — it is cut to *share* its corners with
 * its neighbours, and the same ±10% would open holes several times the width of
 * the joint. Damped to roughly the size of the mortar inset, the jitter still
 * reads as hand-laid without unpicking the bond.
 *
 * Out-of-plane shaping (rotation X/Y, protrusion, depth) is left at full
 * strength: it is the strongest silhouette cue in the wall and it cannot open an
 * in-plane joint.
 */
const LATTICE_SHAPE_DAMPING = 0.25;
const LATTICE_ROLL_DAMPING = 0.3;

/**
 * Construction stones carry a wider bevel than the workshop default.
 *
 * The reference gets its pillowy read from subdividing every extruded polygon.
 * The equivalent here is the bevel ring, which `05-…md` §5 explicitly allows to
 * be exaggerated for readability at game scale. Applied as a gain rather than a
 * fixed value so `stoneJitter`'s per-stone bevel variation survives, and capped
 * so a stone never rounds off into a pebble.
 */
const LATTICE_BEVEL_GAIN = 1.4;
const LATTICE_BEVEL_MAX = 0.16;

export function constructionRecipe(record) {
  const style = constructionStyle(record.style.key);
  return Object.freeze({
    seed: record.seed,
    irregularity: style.irregularity,
    detail: style.detail,
    style: style.stonePalette,
    topStyle: 'slate',
    weathering: 0.25,
    albedo: null,
  });
}

/** `stoneJitter`'s width and height scaling, damped and applied to the face ring. */
function dampedCorners(placement, shaped) {
  const damp = (jittered, nominal) => (
    1 + ((jittered / nominal) - 1) * LATTICE_SHAPE_DAMPING
  );
  return scaleCorners(
    placement.corners,
    damp(shaped.width, placement.width),
    damp(shaped.height, placement.height),
  );
}

/** Roll turns in the face plane and can open a joint; the other two cannot. */
function dampedRotation(nominal, jittered) {
  return [
    jittered[0],
    jittered[1],
    nominal[2] + (jittered[2] - nominal[2]) * LATTICE_ROLL_DAMPING,
  ];
}

/** Axis-aligned face ring for ordinary (non-lattice) box stones. */
export function rectangleCorners(width, height) {
  return [
    [-width / 2, -height / 2],
    [width / 2, -height / 2],
    [width / 2, height / 2],
    [-width / 2, height / 2],
  ];
}

/**
 * Resolve the final stone shape once, after jitter, so visible stone and mortar
 * backing cannot disagree.
 *
 * `relief` / `edgeWear` are optional near-LOD sculpting. They never feed packing.
 */
export function resolveStoneShape({
  placement,
  params,
  shaped,
  detail,
  relief = null,
  edgeWear = null,
}) {
  const lattice = Boolean(placement.corners);
  const corners = lattice
    ? dampedCorners(placement, shaped)
    : rectangleCorners(shaped.width, shaped.height);
  const rotation = lattice
    ? dampedRotation(params.rotation, shaped.rotation)
    : shaped.rotation;
  return {
    corners,
    width: shaped.width,
    height: shaped.height,
    depth: shaped.depth,
    position: shaped.position,
    rotation,
    category: placement.category ?? 'field',
    bevelRatio: lattice
      ? Math.min(LATTICE_BEVEL_MAX, shaped.bevelRatio * LATTICE_BEVEL_GAIN)
      : shaped.bevelRatio,
    skew: shaped.skew,
    protrusion: shaped.protrusion,
    lattice,
    detail,
    relief,
    edgeWear,
  };
}

export function shouldBuildMortarBacking(placement) {
  return placement?.category !== 'recess';
}

/**
 * Face ring for the recessed mortar core.
 *
 * Prefer the packer's solved `mortarCorners` (full cell footprint) with only a
 * millimetre-scale safety overlap. Fall back to expanding the final stone face
 * for dressings / legacy placements that omit the footprint.
 */
function mortarFaceCorners({ placement, stoneShape, config }) {
  if (placement.mortarCorners) {
    return expandCorners(
      placement.mortarCorners,
      config.safetyOverlap ?? 0.003,
      { maxScale: config.maxCornerScale },
    );
  }

  const overlap = overlapForCategory(
    placement.category ?? stoneShape.category,
    config,
  );
  return expandCorners(
    stoneShape.corners,
    overlap,
    { maxScale: config.maxCornerScale },
  );
}

/**
 * Plain-data mortar prism for one resolved stone.
 *
 * Mortar stays on the solved wall plane, not on the stone's protruded/recessed
 * jitter plane. That distinction is what makes a proud block cast a real pocket
 * of shadow into the joint instead of dragging its backing mortar forward with
 * it and cancelling the depth cue.
 *
 * @returns {object | null}
 */
export function createMortarDescriptor({
  placement,
  stoneShape,
  nominalPosition = null,
  nominalRotation = null,
  config = CONSTRUCTION_MORTAR_CONFIG,
}) {
  if (!shouldBuildMortarBacking(placement)) return null;

  const sourceCorners = placement.mortarCorners ?? stoneShape.corners;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of sourceCorners) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const stoneWidth = maxX - minX;
  const stoneHeight = maxY - minY;
  if (!(stoneWidth > 0) || !(stoneHeight > 0)) return null;

  const mortarCorners = mortarFaceCorners({
    placement,
    stoneShape,
    config,
  });
  const depth = mortarCoreDepth(stoneShape.depth, config);

  return {
    corners: mortarCorners,
    depth,
    position: nominalPosition ?? stoneShape.position,
    rotation: nominalRotation ?? stoneShape.rotation,
    uvDensity: config.uvDensity,
  };
}
