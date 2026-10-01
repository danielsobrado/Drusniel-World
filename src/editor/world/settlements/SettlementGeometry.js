/**
 * Plane geometry for settlement plans.
 *
 * Plans are laid out in *plan space*: metres, with +x along cell x and +z along
 * cell z, centred on the burg. (Canonical world z is negated cell z; the
 * renderer converts once.) A footprint is an oriented rectangle whose local +z
 * — its front — is turned by `yaw` to (sin yaw, cos yaw).
 */

export function rect(x, z, width, depth, yaw) {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  return Object.freeze({
    x,
    z,
    halfWidth: width / 2,
    halfDepth: depth / 2,
    yaw,
    // Local +x and +z axes in plan space.
    ax: Object.freeze([cos, -sin]),
    az: Object.freeze([sin, cos]),
    radius: Math.hypot(width, depth) / 2,
  });
}

function projectRadius(box, axis) {
  return box.halfWidth * Math.abs(box.ax[0] * axis[0] + box.ax[1] * axis[1])
    + box.halfDepth * Math.abs(box.az[0] * axis[0] + box.az[1] * axis[1]);
}

/** Separating-axis overlap of two oriented rectangles, with optional clearance. */
export function rectsOverlap(a, b, clearance = 0) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  if (Math.hypot(dx, dz) > a.radius + b.radius + clearance) return false;
  for (const axis of [a.ax, a.az, b.ax, b.az]) {
    const distance = Math.abs(dx * axis[0] + dz * axis[1]);
    if (distance > projectRadius(a, axis) + projectRadius(b, axis) + clearance) return false;
  }
  return true;
}

/** Whether a plan-space point lies inside a rectangle grown by `margin`. */
export function rectContains(box, x, z, margin = 0) {
  const dx = x - box.x;
  const dz = z - box.z;
  return Math.abs(dx * box.ax[0] + dz * box.ax[1]) <= box.halfWidth + margin
    && Math.abs(dx * box.az[0] + dz * box.az[1]) <= box.halfDepth + margin;
}

export function rectCorners(box) {
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [
    box.x + box.ax[0] * box.halfWidth * u + box.az[0] * box.halfDepth * v,
    box.z + box.ax[1] * box.halfWidth * u + box.az[1] * box.halfDepth * v,
  ]);
}

export function segmentDistance(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lengthSquared));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/** Distance from a point to a polyline. */
export function polylineDistance(points, x, z) {
  let best = Infinity;
  for (let index = 1; index < points.length; index += 1) {
    const [ax, az] = points[index - 1];
    const [bx, bz] = points[index];
    best = Math.min(best, segmentDistance(x, z, ax, az, bx, bz));
  }
  return best;
}

/** Does a rectangle come within `clearance` of a polyline of half-width `halfWidth`? */
export function rectHitsPolyline(box, points, halfWidth, clearance = 0) {
  const reach = halfWidth + clearance;
  if (polylineDistance(points, box.x, box.z) > box.radius + reach) return false;
  if (rectContains(box, points[0][0], points[0][1], reach)) return true;
  for (let index = 1; index < points.length; index += 1) {
    const [ax, az] = points[index - 1];
    const [bx, bz] = points[index];
    const length = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(length / Math.max(0.5, reach)));
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      if (rectContains(box, ax + (bx - ax) * t, az + (bz - az) * t, reach)) return true;
    }
  }
  return false;
}

/** Uniform bucket grid for items with a centre and a radius. */
export class PlanGrid {
  constructor(cell = 16) {
    this.cell = cell;
    this.buckets = new Map();
  }

  keys(x, z, radius) {
    const keys = [];
    const x0 = Math.floor((x - radius) / this.cell);
    const x1 = Math.floor((x + radius) / this.cell);
    const z0 = Math.floor((z - radius) / this.cell);
    const z1 = Math.floor((z + radius) / this.cell);
    for (let bx = x0; bx <= x1; bx += 1) {
      for (let bz = z0; bz <= z1; bz += 1) keys.push(`${bx}:${bz}`);
    }
    return keys;
  }

  insert(item, x, z, radius) {
    for (const key of this.keys(x, z, radius)) {
      if (!this.buckets.has(key)) this.buckets.set(key, []);
      this.buckets.get(key).push(item);
    }
  }

  near(x, z, radius) {
    const found = new Set();
    for (const key of this.keys(x, z, radius)) {
      for (const item of this.buckets.get(key) ?? []) found.add(item);
    }
    return found;
  }
}
