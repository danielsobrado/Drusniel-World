import { normalizeConstructionRecord } from '../ConstructionSchema.js';
import { sampleCubicBezierPath } from '../curve/CubicBezierPath.js';
import { createCurveArcTable } from '../masonry/CurveArcTable.js';
import { createWallTopProfile } from '../masonry/WallTopProfile.js';
import { constructionStyle } from '../masonry/ConstructionStyleCatalog.js';
import { fitWallCourseHeight, footingCourseHeight } from '../masonry/WallCourseTable.js';
import {
  MAX_CONSTRUCTION_STONES,
  MAX_MODULE_STONES,
  packCurvedWall,
  usesCopingCourse,
} from '../masonry/CurvedCoursePacker.js';
import { constructionRuinProfile } from '../config/ConstructionRuinConfig.generated.js';
import { resolveRuinSupport } from '../masonry/RuinSupportResolver.js';
import { createRuinEnvelope } from '../masonry/RuinEnvelope.js';
import { mixSeed } from '../../workshop/ProceduralRandom.js';

const DEFAULT_MAX_MODULE_LENGTH = 12;
const HASH_QUANTUM = 1e4;

/**
 * How far an opening's influence reaches past its own half-width, in metres.
 * Shared by the packer's opening filter and the module hash, so a feature that
 * can reshape a module is always an input to that module's hash.
 */
const OPENING_REACH = 0.6;

/**
 * A stable per-module seed from the module's own semantic identity.
 *
 * This used to be `modules.length` — the module's index in the flat module
 * array — so inserting a control point upstream re-rolled the masonry of every
 * module after it while their content hashes stayed put. The renderer then kept
 * the stale stones and visibly swapped them on the next rebuild. Keying on the
 * module's segment lineage and its slot inside that segment instead leaves
 * downstream modules bit-identical, following `CourseLattice.hashAt`, which
 * shapes on a wall-coordinate position rather than on an array position.
 */
function moduleSeedOffset(segmentId, index) {
  let hash = 0x811c9dc5;
  for (let position = 0; position < segmentId.length; position += 1) {
    hash ^= segmentId.charCodeAt(position);
    hash = Math.imul(hash, 0x01000193);
  }
  return mixSeed(hash >>> 0, index);
}

function createHasher() {
  let hash = 0x811c9dc5;
  const write = (text) => {
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
  };
  return {
    text(value) {
      write(String(value));
      write('\u0001');
    },
    number(value) {
      write(String(Math.round(value * HASH_QUANTUM)));
      write('\u0001');
    },
    digest() {
      return (hash >>> 0).toString(16).padStart(8, '0');
    },
  };
}

function ruinSurvivorSignature(placements) {
  const hasher = createHasher();
  const ordered = [...(placements ?? [])].sort(
    (a, b) => (a.stableIndex ?? 0) - (b.stableIndex ?? 0),
  );
  for (const placement of ordered) {
    hasher.number(placement.stableIndex ?? 0);
    hasher.number(placement.support?.courseIndex ?? -1);
    hasher.text(placement.support?.role ?? '-');
    hasher.text(placement.ruin?.damageVoid ? 'void' : '-');
    hasher.text(placement.ruin?.clusterId ?? '-');
    hasher.text(placement.ruin?.exposedTop ? 'top' : '-');
    hasher.text(placement.ruin?.debugState ?? '-');
    hasher.number(placement.ruin?.supportRatio ?? 0);
  }
  return hasher.digest();
}

function combineHashes(left, right) {
  const hasher = createHasher();
  hasher.text(left);
  hasher.text(right);
  return hasher.digest();
}

function interpolate(left, right, targetDistance) {
  const span = right.distance - left.distance;
  const t = span > 1e-9 ? (targetDistance - left.distance) / span : 0;
  const tangentX = left.tangentX + (right.tangentX - left.tangentX) * t;
  const tangentZ = left.tangentZ + (right.tangentZ - left.tangentZ) * t;
  const magnitude = Math.hypot(tangentX, tangentZ) || 1;
  return {
    x: left.x + (right.x - left.x) * t,
    z: left.z + (right.z - left.z) * t,
    tangentX: tangentX / magnitude,
    tangentZ: tangentZ / magnitude,
  };
}

function pointAtDistance(points, distance) {
  if (distance <= points[0].distance) return points[0];
  if (distance >= points.at(-1).distance) return points.at(-1);
  let low = 0;
  let high = points.length - 1;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle].distance <= distance) low = middle;
    else high = middle;
  }
  return interpolate(points[low], points[high], distance);
}

function boundsForPoints(points, margin) {
  const bounds = {
    minX: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxZ: -Infinity,
  };
  for (const point of points) {
    bounds.minX = Math.min(bounds.minX, point.x - margin);
    bounds.minZ = Math.min(bounds.minZ, point.z - margin);
    bounds.maxX = Math.max(bounds.maxX, point.x + margin);
    bounds.maxZ = Math.max(bounds.maxZ, point.z + margin);
  }
  return bounds;
}

/** Arc length below which a segment is a degenerate span, in metres. */
const MIN_SEGMENT_LENGTH = 1e-4;

export function planConstruction(input, {
  maxModuleLength = DEFAULT_MAX_MODULE_LENGTH,
  terrainSamples = [],
  masonry = true,
} = {}) {
  const record = normalizeConstructionRecord(input);
  if (record.path.type !== 'cubicBezier') {
    throw new Error('The live construction planner currently requires a cubic Bézier path.');
  }
  if (!(maxModuleLength >= 1)) throw new Error('Maximum construction module length is invalid.');
  const sampled = sampleCubicBezierPath(record.path);

  const segmentEnds = new Map();
  const segmentOrder = [];
  for (const entry of sampled.points) {
    if (!segmentEnds.has(entry.segmentId)) segmentOrder.push(entry.segmentId);
    segmentEnds.set(entry.segmentId, Math.max(segmentEnds.get(entry.segmentId) ?? 0, entry.distance));
  }
  const segmentRanges = new Map();
  let previousEnd = 0;
  for (let index = 0; index < segmentOrder.length; index += 1) {
    const segmentId = segmentOrder[index];
    const end = index === segmentOrder.length - 1
      ? sampled.totalDistance
      : segmentEnds.get(segmentId);
    segmentRanges.set(segmentId, { start: previousEnd, end });
    previousEnd = end;
  }
  const toArc = (segmentId, arcFraction) => {
    const range = segmentRanges.get(segmentId);
    if (!range) return 0;
    return range.start + (range.end - range.start) * arcFraction;
  };

  const topPoints = record.top.profile
    .map((entry) => ({ distance: toArc(entry.segmentId, entry.arcFraction), height: entry.height }))
    .sort((a, b) => a.distance - b.distance);
  const featureArcs = record.features.map((feature) => ({
    feature,
    distance: toArc(feature.segmentId, feature.arcFraction),
  }));

  function hashModule(moduleId, seedOffset, from, to, modulePoints) {
    const hasher = createHasher();
    hasher.text(moduleId);
    // The resolved per-module seed, not just the record seed: it forks the
    // packer's random stream and the per-stone shaping seed, so it is a
    // geometry input in its own right.
    hasher.number(seedOffset);
    // The module's slice of the wall's arc domain. `moduleCourseRange`, the bed
    // ramp, the joint lean and `splitCell` all resolve in *absolute* arc
    // coordinates, so moving a distant anchor re-parameterises the wall and can
    // re-roll this module's stones without its own centreline moving. The module's
    // `[from, to]` are the arc-domain inputs that can move it; the wall length
    // itself is not one of them (its only effect is the terminal module's hard
    // end, and that module's `to` already equals the wall length), so it is left
    // out to avoid invalidating modules a length change never reached.
    hasher.number(from);
    hasher.number(to);
    hasher.text(record.style.key);
    hasher.number(record.style.version);
    hasher.number(record.seed);
    hasher.number(record.dimensions.height);
    hasher.number(record.dimensions.thickness);
    hasher.number(courseFootingHeight);
    hasher.number(wallCourseHeight ?? 0);
    hasher.text(record.top.style);
    hasher.number(record.top.base);
    for (const point of modulePoints) {
      hasher.number(point.x);
      hasher.number(point.z);
      hasher.number(point.tangentX);
      hasher.number(point.tangentZ);
    }

    // The top-profile control points that can shape this module. Only the
    // bracketing points (and their slope neighbours) matter: outside the
    // outermost control point the profile *holds* that point's height, so a
    // module beyond the range hashes that held height and nothing else. The old
    // `max(0, first - 1)` slice clamped a module that lies entirely *before*
    // every point to `[0, 0]`, turning an arbitrarily distant control point into
    // an input to this module's hash.
    let first = topPoints.findIndex((entry) => entry.distance >= from);
    if (first < 0) first = topPoints.length;
    let last = -1;
    for (let index = topPoints.length - 1; index >= 0; index -= 1) {
      if (topPoints[index].distance <= to) {
        last = index;
        break;
      }
    }
    if (topPoints.length === 0) {
      // No control points at all: the profile is the authored base height.
      hasher.number(record.top.base);
    } else if (last < 0) {
      // Entirely before the range: held at the first point's height.
      hasher.number(topPoints[0].height);
    } else if (first >= topPoints.length) {
      // Entirely after the range: held at the last point's height.
      hasher.number(topPoints[topPoints.length - 1].height);
    } else {
      const sliceStart = Math.max(0, first - 1);
      const sliceEnd = Math.min(topPoints.length - 1, last + 1);
      for (let index = sliceStart; index <= sliceEnd; index += 1) {
        hasher.number(topPoints[index].distance);
        hasher.number(topPoints[index].height);
      }
    }
    for (const { feature, distance } of featureArcs) {
      const margin = feature.width / 2 + OPENING_REACH;
      if (distance + margin <= from || distance - margin >= to) continue;
      hasher.text(feature.id);
      hasher.text(feature.kind);
      hasher.text(feature.profile);
      hasher.text(feature.group ?? '-');
      hasher.text(feature.dressed ? 'd' : '-');
      hasher.number(distance);
      hasher.number(feature.width);
      hasher.number(feature.height);
      hasher.number(feature.sill);
    }
    return hasher.digest();
  }

  const style = constructionStyle(record.style.key);
  const arcTable = masonry ? createCurveArcTable(sampled) : null;
  const topProfile = masonry ? createWallTopProfile(record, arcTable, { style }) : null;
  // Whole courses from the ground to the capstones; see `fitWallCourseHeight`.
  const wallCourseHeight = masonry
    ? fitWallCourseHeight({
      courseHeight: style.courseHeight,
      footing: style.footing ?? null,
      wallHeight: Math.max(0.2, record.top.base),
      copingHeight: usesCopingCourse(record.top.style) ? (style.coping?.height ?? 0) : 0,
      fitUncapped: record.top.style === 'crenellated',
    })
    : null;
  /**
   * The wall height appearance is normalised against — the authored base
   * height, not the wall-wide tallest point.
   *
   * `heightRatio` drives `applyUnitShading`'s weathering. Normalising it against
   * the tallest point meant a local top raise moved the reference and re-shaded
   * every far stone even though its position and mesh were byte-identical, which
   * breaks the phase-11 clause "a local edit preserves unaffected cell
   * identities, colors and decoration keys". The authored height is stable under
   * any local edit, and equals the tall point on a wall that is not raised.
   * (Trade-off: on a wall that *is* raised, stones above the base now clamp to a
   * `heightRatio` of 1 rather than scaling up to the raised peak.)
   */
  const heightReference = Math.max(0.2, record.top.base);
  // The footing course height the course table derives from `heightReference`.
  // It is the only channel by which the reference reaches geometry, so the hash
  // covers the derived value, not the raw height.
  const courseFootingHeight = masonry
    ? footingCourseHeight({
      courseHeight: wallCourseHeight,
      footing: style.footing ?? null,
      wallHeight: heightReference,
    })
    : 0;
  let stoneTotal = 0;
  let overBudget = false;

  const modules = [];
  for (const segment of record.path.segments) {
    // A segment owns its arc interval, not its samples: the sampler drops each
    // segment's start sample as the previous segment's end, so a short segment
    // of a dense curve can carry a single sample and still span real wall.
    // Counting samples skipped most of a 32-anchor circle (handoff 4A). Only a
    // genuinely zero-length span is dropped.
    const range = segmentRanges.get(segment.id);
    if (!range || !(range.end - range.start > MIN_SEGMENT_LENGTH)) continue;
    const startDistance = range.start;
    const endDistance = range.end;
    const length = endDistance - startDistance;
    const count = Math.max(1, Math.ceil(length / maxModuleLength));
    for (let index = 0; index < count; index += 1) {
      const from = startDistance + length * index / count;
      const to = startDistance + length * (index + 1) / count;
      const middle = pointAtDistance(sampled.points, (from + to) / 2);
      const relevant = sampled.points.filter(({ distance }) => distance >= from && distance <= to);
      const endpoints = [pointAtDistance(sampled.points, from), pointAtDistance(sampled.points, to)];
      const modulePoints = [...endpoints.slice(0, 1), ...relevant, ...endpoints.slice(1)];
      // The hash sees the module's own samples *and one on each side*. The arc
      // table's curvature is a finite difference that reaches 0.1 m past the arc
      // range, so the stone widths inside a module depend on the neighbouring
      // segment's shape at the seam — a real generation input that the module's
      // own range alone does not capture.
      const firstRelevant = sampled.points.findIndex(({ distance }) => distance >= from);
      let lastRelevant = -1;
      for (let i = sampled.points.length - 1; i >= 0; i -= 1) {
        if (sampled.points[i].distance <= to) {
          lastRelevant = i;
          break;
        }
      }
      const hashPoints = [];
      if (firstRelevant > 0) hashPoints.push(sampled.points[firstRelevant - 1]);
      hashPoints.push(...modulePoints);
      if (lastRelevant >= 0 && lastRelevant + 1 < sampled.points.length) {
        hashPoints.push(sampled.points[lastRelevant + 1]);
      }
      const moduleId = `${segment.id}-span-${index + 1}`;
      const seedOffset = moduleSeedOffset(segment.id, index);
      let packed = null;
      if (masonry) {
        packed = packCurvedWall({
          arcTable,
          arcRange: [from, to],
          style,
          thickness: record.dimensions.thickness,
          seed: record.seed,
          seedOffset,
          wallRange: [0, sampled.totalDistance],
          courseHeight: wallCourseHeight,
          heightReference,
          topHeightAt: topProfile.heightAt,
          ruinFactorAt: topProfile.ruinFactorAt,
          ruinStateAt: topProfile.ruinStateAt,
          slopeAt: topProfile.slopeAt,
          crenellationsOver: topProfile.crenellationsOver,
          topStyle: record.top.style,
          deferRuinRemoval: record.top.style === 'ruined',
          openings: featureArcs
            .filter(({ feature, distance }) => {
              const reach = feature.width / 2 + OPENING_REACH;
              return distance + reach > from && distance - reach < to;
            })
            .map(({ feature, distance }) => ({ ...feature, s: distance })),
          // A small-stone style declares its own budget; every other style
          // keeps the shared caps.
          budget: Math.max(0, Math.min(
            style.stoneBudget?.module ?? MAX_MODULE_STONES,
            (style.stoneBudget?.construction ?? MAX_CONSTRUCTION_STONES) - stoneTotal,
          )),
        });
        stoneTotal += packed.stats.stones;
        overBudget = overBudget || packed.stats.overBudget;
      }
      modules.push(Object.freeze({
        id: moduleId,
        kind: 'curved-span',
        segmentId: segment.id,
        seedOffset,
        contentHash: hashModule(moduleId, seedOffset, from, to, hashPoints),
        placements: packed ? packed.stones : null,
        masonryStats: packed ? packed.stats : null,
        pathInterval: Object.freeze([from, to]),
        frame: Object.freeze({
          origin: Object.freeze([middle.x, middle.z]),
          tangent: Object.freeze([middle.tangentX, middle.tangentZ]),
          outward: Object.freeze([-middle.tangentZ, middle.tangentX]),
        }),
        dimensions: record.dimensions,
        bounds: Object.freeze(boundsForPoints(modulePoints, record.dimensions.thickness / 2)),
        openingIds: Object.freeze(record.features
          .filter(({ segmentId }) => segmentId === segment.id)
          .map(({ id }) => id)),
      }));
    }
  }

  let ruinStats = null;
  let ruinEnvelope = null;
  let ruinDiagnostics = null;
  let finalModules = modules;
  if (masonry && record.top.style === 'ruined') {
    const ruinProfile = constructionRuinProfile(record.style.key);
    const resolved = resolveRuinSupport({ modules, profile: ruinProfile });
    ruinStats = resolved.stats;
    ruinDiagnostics = resolved.diagnostics;
    finalModules = resolved.modules.map((module) => {
      const survivorHash = ruinSurvivorSignature(module.placements);
      return Object.freeze({
        ...module,
        contentHash: combineHashes(module.contentHash, survivorHash),
        masonryStats: Object.freeze({
          ...(module.masonryStats ?? {}),
          stones: module.placements?.length ?? 0,
          ruinSurvivors: module.placements?.length ?? 0,
        }),
      });
    });
    const survivors = finalModules.flatMap((module) => module.placements ?? []);
    ruinEnvelope = createRuinEnvelope({
      survivors,
      removed: resolved.removed,
      totalLength: sampled.totalDistance,
      sampleSpacing: ruinProfile.lod.shellSampleSpacing,
      fallbackHeightAt: topProfile.heightAt,
      minimumHeight: ruinProfile.macro.minimumHeight,
    });
    stoneTotal = survivors.length;
  }

  return Object.freeze({
    version: 1,
    constructionId: record.id,
    constructionRevision: record.revision,
    totalLength: sampled.totalDistance,
    modules: Object.freeze(finalModules),
    terrainSamples: Object.freeze(structuredClone(terrainSamples)),
    bounds: Object.freeze(boundsForPoints(
      sampled.points,
      record.dimensions.thickness / 2,
    )),
    contentHash: (() => {
      const hasher = createHasher();
      for (const module of finalModules) hasher.text(module.contentHash);
      return hasher.digest();
    })(),
    ruinStats,
    ruinEnvelope,
    ruinDiagnostics,
    stats: Object.freeze({
      sampleCount: sampled.points.length,
      moduleCount: finalModules.length,
      openingCount: record.features.length,
      topPointCount: record.top.profile.length,
      stoneCount: stoneTotal,
      overBudget,
    }),
  });
}
