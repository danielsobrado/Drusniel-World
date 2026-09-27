import { validateRouteMetadata } from '../import/AzgaarRoutes.js';

/**
 * Walkable roads and trails over the exaggerated relief (after grass-test's
 * LandscapePaths grading). Each Azgaar land route is smoothed into a curve,
 * and the ground along it is blended toward a profile whose gradient is
 * capped: cut through rises, filled over dips, within limits, with banks
 * that widen where the cut is deep.
 *
 * Routes run for hundreds of kilometres, far too long to trace up front in
 * every worker. A route is split into arcs of `arcMeters`; an arc's profile is
 * traced the first time something asks for a height on it, with its ends
 * pinned to the ground, so the result never depends on which arc was traced
 * first and neighbouring arcs meet exactly.
 *
 * Positions are world cells; widths and heights are metres.
 */
export const DEFAULT_TRAIL_GRADING = Object.freeze({
  roadWidthMeters: 6,
  trailWidthMeters: 3,
  /** Steepest rise or fall a graded path keeps, metres per metre. */
  maxGrade: 0.14,
  stepMeters: 8,
  arcMeters: 1024,
  maxCutMeters: 10,
  maxFillMeters: 4,
  /** Bank run at the path's edge, plus bankSlope metres per metre of cut or fill. */
  shoulderMeters: 3,
  bankSlope: 1.4,
});

/** Catmull-Rom subdivisions per source segment: Azgaar's points are kilometres apart. */
const SUBDIVISIONS = 8;
/** Index buckets, in atlas pixels. */
const BUCKET_ATLAS_PIXELS = 2;

function smoothstep(edge0, edge1, value) {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  const along = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t
    + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return { x: along(p0.x, p1.x, p2.x, p3.x), z: along(p0.z, p1.z, p2.z, p3.z) };
}

/** A route's polyline in cells, smoothed through its points. */
export function smoothRoute(points) {
  if (points.length < 3) return points;
  const result = [points[0]];
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[Math.max(0, index - 1)];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[Math.min(points.length - 1, index + 2)];
    for (let step = 1; step <= SUBDIVISIONS; step += 1) result.push(catmullRom(p0, p1, p2, p3, step / SUBDIVISIONS));
  }
  return result;
}

export function resolveTrailGrading(source) {
  if (source == null || source === false) return null;
  const grading = { ...DEFAULT_TRAIL_GRADING, ...(source === true ? {} : source) };
  validateTrailGrading(grading, 'import.azgaarTrails');
  return grading;
}

export function validateTrailGrading(grading, path) {
  const positive = ['roadWidthMeters', 'trailWidthMeters', 'maxGrade', 'stepMeters', 'arcMeters'];
  const nonNegative = ['maxCutMeters', 'maxFillMeters', 'shoulderMeters', 'bankSlope'];
  if (!grading || positive.some((key) => !(Number.isFinite(grading[key]) && grading[key] > 0))
      || nonNegative.some((key) => !(Number.isFinite(grading[key]) && grading[key] >= 0))
      || grading.arcMeters < grading.stepMeters * 2) {
    throw new Error(`${path} needs positive widths, grade, step and arc (arc ≥ two steps) and non-negative cut, fill and banks.`);
  }
}

export class TrailGrading {
  /**
   * @param {object} options
   * @param {object} options.source the macro source, with `routes` and bounds
   * @param {(x: number, z: number) => number} options.sampleTerrainHeight ungraded ground, metres
   * @param {object} options.grading resolved grading settings
   */
  constructor({ source, sampleTerrainHeight, grading }) {
    validateRouteMetadata(source.routes);
    this.sampleTerrainHeight = sampleTerrainHeight;
    this.grading = grading;
    this.metersPerCell = source.physical.widthMeters / source.bounds.widthCells;
    this.cellsPerBucket = source.bounds.widthCells / source.atlas.width * BUCKET_ATLAS_PIXELS;
    this.bounds = source.bounds;
    this.maxShoulderMeters = grading.shoulderMeters
      + Math.max(grading.maxCutMeters, grading.maxFillMeters) * grading.bankSlope;
    // A route whose points all coincide has no length to grade along (its arcs
    // would have zero spacing and trace NaN heights), so it is left out.
    this.routes = (source.routes ?? []).map((route, index) => this.createRoute(source, route, index))
      .filter((route) => route.length > 0);
    this.buckets = new Map();
    this.routes.forEach((route) => this.indexRoute(route));
    this.arcs = new Map();
  }

  createRoute(source, route, index) {
    const toCell = ([x, y]) => ({
      x: source.bounds.minCellX + x / source.atlas.width * source.bounds.widthCells,
      z: source.bounds.minCellZ + y / source.atlas.height * source.bounds.heightCells,
    });
    const points = smoothRoute(route.points.map(toCell));
    const distances = new Float64Array(points.length);
    for (let i = 1; i < points.length; i += 1) {
      distances[i] = distances[i - 1]
        + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z) * this.metersPerCell;
    }
    const width = route.group === 'roads' ? this.grading.roadWidthMeters : this.grading.trailWidthMeters;
    return { index, points, distances, length: distances[points.length - 1], halfWidth: width / 2 };
  }

  bucketKey(bucketX, bucketZ) {
    return (bucketX + 1_048_576) * 2_097_152 + (bucketZ + 1_048_576);
  }

  indexRoute(route) {
    const reach = (route.halfWidth + this.maxShoulderMeters) / this.metersPerCell;
    const size = this.cellsPerBucket;
    for (let segment = 0; segment < route.points.length - 1; segment += 1) {
      const a = route.points[segment];
      const b = route.points[segment + 1];
      const minX = Math.floor((Math.min(a.x, b.x) - reach) / size);
      const maxX = Math.floor((Math.max(a.x, b.x) + reach) / size);
      const minZ = Math.floor((Math.min(a.z, b.z) - reach) / size);
      const maxZ = Math.floor((Math.max(a.z, b.z) + reach) / size);
      for (let bucketZ = minZ; bucketZ <= maxZ; bucketZ += 1) {
        for (let bucketX = minX; bucketX <= maxX; bucketX += 1) {
          const key = this.bucketKey(bucketX, bucketZ);
          const entries = this.buckets.get(key);
          if (entries) entries.push(route, segment);
          else this.buckets.set(key, [route, segment]);
        }
      }
    }
  }

  /** The nearest route point to a cell: its route, distance (metres) and arclength (metres). */
  nearest(x, z) {
    const entries = this.buckets.get(this.bucketKey(
      Math.floor(x / this.cellsPerBucket),
      Math.floor(z / this.cellsPerBucket),
    ));
    if (!entries) return null;
    let best = null;
    for (let i = 0; i < entries.length; i += 2) {
      const route = entries[i];
      const segment = entries[i + 1];
      const a = route.points[segment];
      const b = route.points[segment + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const lengthSquared = dx * dx + dz * dz;
      const t = lengthSquared > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / lengthSquared)) : 0;
      const distance = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)) * this.metersPerCell;
      // Rank by distance past the path's edge, so a road beats a trail beside it.
      const rank = distance - route.halfWidth;
      if (!best || rank < best.rank) {
        const along = route.distances[segment] + (route.distances[segment + 1] - route.distances[segment]) * t;
        best = { route, distance, along, rank };
      }
    }
    return best;
  }

  pointAt(route, along) {
    const { points, distances } = route;
    let low = 0;
    let high = points.length - 1;
    while (high - low > 1) {
      const mid = (low + high) >> 1;
      if (distances[mid] <= along) low = mid;
      else high = mid;
    }
    const span = distances[high] - distances[low];
    const t = span > 0 ? (along - distances[low]) / span : 0;
    return { x: points[low].x + (points[high].x - points[low].x) * t, z: points[low].z + (points[high].z - points[low].z) * t };
  }

  /** Graded path heights along one arc, ends pinned to the ground. */
  traceArc(route, arc) {
    const { maxGrade, stepMeters, arcMeters, maxCutMeters, maxFillMeters } = this.grading;
    const start = arc * arcMeters;
    const end = Math.min(route.length, start + arcMeters);
    const count = Math.max(2, Math.ceil((end - start) / stepMeters) + 1);
    const spacing = (end - start) / (count - 1);
    const ground = new Float64Array(count);
    for (let i = 0; i < count; i += 1) {
      const point = this.pointAt(route, start + i * spacing);
      ground[i] = this.sampleTerrainHeight(point.x, point.z);
    }
    const profile = Float64Array.from(ground);
    // Where the pinned ends climb more than maxGrade allows, the arc takes just
    // the grade it needs, spread evenly, rather than one jump beside a pin.
    const needed = Math.abs(ground[count - 1] - ground[0]) / Math.max(end - start, 1e-6);
    const rise = Math.max(maxGrade, needed * 1.02) * spacing;
    for (let pass = 0; pass < 2; pass += 1) {
      for (let i = 1; i < count - 1; i += 1) {
        profile[i] = Math.max(profile[i - 1] - rise, Math.min(profile[i - 1] + rise, profile[i]));
      }
      for (let i = count - 2; i > 0; i -= 1) {
        profile[i] = Math.max(profile[i + 1] - rise, Math.min(profile[i + 1] + rise, profile[i]));
      }
    }
    // Soften kinks, then hold the cut and fill limits.
    const smoothed = Float64Array.from(profile);
    for (let i = 1; i < count - 1; i += 1) {
      smoothed[i] = (profile[i - 1] + 2 * profile[i] + profile[i + 1]) / 4;
      smoothed[i] = Math.max(ground[i] - maxCutMeters, Math.min(ground[i] + maxFillMeters, smoothed[i]));
    }
    return { start, spacing, heights: smoothed };
  }

  profileAt(route, along) {
    const arc = Math.min(Math.floor(along / this.grading.arcMeters), Math.max(0, Math.ceil(route.length / this.grading.arcMeters) - 1));
    const key = route.index * 1_000_003 + arc;
    let traced = this.arcs.get(key);
    if (!traced) {
      traced = this.traceArc(route, arc);
      this.arcs.set(key, traced);
    }
    const position = Math.max(0, Math.min(traced.heights.length - 1, (along - traced.start) / traced.spacing));
    const low = Math.floor(position);
    const high = Math.min(traced.heights.length - 1, low + 1);
    return traced.heights[low] + (traced.heights[high] - traced.heights[low]) * (position - low);
  }

  /** The ground at a cell with any path graded into it. */
  grade(x, z, height) {
    const nearest = this.nearest(x, z);
    if (!nearest) return height;
    const { route, distance, along } = nearest;
    if (distance > route.halfWidth + this.maxShoulderMeters) return height;
    const path = this.profileAt(route, along);
    // `height` is the ground here, not on the centre line, so across a hillside
    // it can differ from the path by far more than the cut and fill limits.
    // Capped at the reach the early return above uses, so the bank has always
    // finished blending where the shaping stops; uncapped it would still be
    // pulling the ground part-way to the path there, and leave a step.
    const shoulder = Math.min(
      this.maxShoulderMeters,
      this.grading.shoulderMeters + Math.abs(path - height) * this.grading.bankSlope,
    );
    const weight = 1 - smoothstep(route.halfWidth, route.halfWidth + shoulder, distance);
    return height + (path - height) * weight;
  }

  /** 0..1 how much of a cell is path, for surface painting. */
  pathCover(x, z) {
    const nearest = this.nearest(x, z);
    if (!nearest) return 0;
    return 1 - smoothstep(nearest.route.halfWidth * 0.6, nearest.route.halfWidth + 0.8, nearest.distance);
  }
}
