import { PlanGrid, rect, rectCorners, rectHitsPolyline, rectsOverlap } from './SettlementGeometry.js';

/** Steepest ground a pad may sit on, as metres of fall across its corners. */
const MAX_PAD_FALL = 3.2;

/**
 * Everything already claimed in a plan: streets, the square and accepted
 * footprints. `fits` is the single rule every placement goes through, so
 * buildings, farms, fields, walls and props can never overlap one another or a
 * street, and nothing is put in water or on a cliff.
 */
export class SettlementOccupancy {
  constructor({ streets, squareRadius, isBuildable, sampleHeight }) {
    this.streets = streets;
    this.squareRadius = squareRadius;
    this.isBuildable = isBuildable;
    this.sampleHeight = sampleHeight;
    this.grid = new PlanGrid(16);
    this.claimed = [];
  }

  /** Why `box` cannot be placed, or null when it can. */
  conflict(box, { clearance = 1.2, streetClearance = 0.8, ignoreStreets = false, ground = true } = {}) {
    if (this.squareRadius > 0 && Math.hypot(box.x, box.z) < this.squareRadius + box.radius * 0.7) {
      return 'square';
    }
    for (const other of this.grid.near(box.x, box.z, box.radius + clearance + 4)) {
      if (rectsOverlap(box, other.box, other.soft ? 0.2 : clearance)) return 'occupied';
    }
    if (!ignoreStreets) {
      for (const street of this.streets) {
        if (rectHitsPolyline(box, street.points, street.width / 2, streetClearance)) return 'street';
      }
    }
    if (!ground) return null;
    const samples = [...rectCorners(box), [box.x, box.z]];
    if (!samples.every(([x, z]) => this.isBuildable(x, z))) return 'water';
    const heights = samples.map(([x, z]) => this.sampleHeight(x, z));
    if (Math.max(...heights) - Math.min(...heights) > MAX_PAD_FALL) return 'slope';
    return null;
  }

  fits(box, options) {
    return this.conflict(box, options) === null;
  }

  claim(box, { soft = false } = {}) {
    const entry = { box, soft };
    this.claimed.push(entry);
    this.grid.insert(entry, box.x, box.z, box.radius);
    return entry;
  }

  /**
   * A footprint whose front edge centre sits `setback` metres off a street at
   * (x, z), the street running along `along`, on `side` (+1 left, −1 right).
   */
  static frontage({ x, z, along, side, halfStreet, setback, width, depth }) {
    const normal = [Math.cos(along) * side, -Math.sin(along) * side];
    const offset = halfStreet + setback + depth / 2;
    // The front faces back toward the street.
    const yaw = Math.atan2(-normal[0], -normal[1]);
    return rect(x + normal[0] * offset, z + normal[1] * offset, width, depth, yaw);
  }
}
