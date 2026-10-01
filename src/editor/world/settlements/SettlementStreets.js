import { FARM_BELT } from './SettlementProfile.js';
import { polylineDistance } from './SettlementGeometry.js';

/** A small deterministic generator; plans must not depend on Math.random. */
export function planRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const STREET_WIDTH = Object.freeze({ main: 5.5, ring: 4.5, lane: 3.2, walk: 1.6 });
const MIN_ROAD_SEPARATION = 0.55;

function angleGap(a, b) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

/**
 * Main-street bearings: the Azgaar roads that leave the burg, deduplicated,
 * padded with seeded bearings so every class has at least its minimum.
 */
export function mainBearings(profile, routeBearings, random) {
  const minimum = [1, 2, 3, 3, 4][profile.rank];
  const maximum = [2, 3, 4, 5, 6][profile.rank];
  const bearings = [];
  for (const bearing of routeBearings) {
    if (bearings.length >= maximum) break;
    if (bearings.every((existing) => angleGap(existing, bearing) > MIN_ROAD_SEPARATION)) bearings.push(bearing);
  }
  let attempts = 0;
  while (bearings.length < minimum && attempts < 64) {
    attempts += 1;
    const candidate = random() * Math.PI * 2;
    if (bearings.every((existing) => angleGap(existing, candidate) > Math.PI / (minimum + 0.5))) bearings.push(candidate);
  }
  return bearings;
}

/** A gently meandering street out along a bearing, stopping at unbuildable ground. */
function walkStreet({ start, bearing, length, step, drift, random, isBuildable }) {
  const points = [start];
  let [x, z] = start;
  let heading = bearing;
  for (let travelled = 0; travelled < length; travelled += step) {
    heading += (random() - 0.5) * drift;
    // Pull back toward the bearing so the street keeps its general direction.
    heading += Math.atan2(Math.sin(bearing - heading), Math.cos(bearing - heading)) * 0.25;
    x += Math.sin(heading) * step;
    z += Math.cos(heading) * step;
    if (!isBuildable(x, z)) break;
    points.push([x, z]);
  }
  return points;
}

/**
 * The street network of one settlement, in plan space. Returns streets
 * ({ kind, width, points }) and the market square, if the class has one.
 */
export function planStreets({ profile, routeBearings, random, isBuildable }) {
  const squareRadius = profile.square ? 8 + profile.rank * 2.5 : 0;
  const streets = [];
  const bearings = mainBearings(profile, routeBearings, random);
  const reach = profile.radius * FARM_BELT.outer;
  for (const bearing of bearings) {
    const start = [Math.sin(bearing) * squareRadius, Math.cos(bearing) * squareRadius];
    const points = walkStreet({ start, bearing, length: reach, step: 12, drift: 0.22, random, isBuildable });
    if (points.length > 1) streets.push({ kind: 'main', width: STREET_WIDTH.main, points, bearing });
  }

  if (profile.rank >= 2) {
    const ringRadius = profile.radius * (0.5 + random() * 0.1);
    const steps = 36;
    const phase = random() * Math.PI * 2;
    let current = [];
    for (let index = 0; index <= steps; index += 1) {
      const angle = phase + Math.PI * 2 * index / steps;
      const radius = ringRadius * (1 + (random() - 0.5) * 0.08);
      const point = [Math.sin(angle) * radius, Math.cos(angle) * radius];
      if (isBuildable(point[0], point[1])) current.push(point);
      else {
        if (current.length > 1) streets.push({ kind: 'ring', width: STREET_WIDTH.ring, points: current });
        current = [];
      }
    }
    if (current.length > 1) streets.push({ kind: 'ring', width: STREET_WIDTH.ring, points: current });
  }

  if (profile.rank >= 1) {
    const mains = streets.filter(({ kind }) => kind === 'main');
    const spacing = 44 - profile.rank * 4;
    for (const main of mains) {
      let side = random() < 0.5 ? -1 : 1;
      for (let index = 2; index < main.points.length - 1; index += Math.max(2, Math.round(spacing / 12))) {
        const [x, z] = main.points[index];
        const distance = Math.hypot(x, z);
        if (distance < profile.radius * 0.28 || distance > profile.radius * 0.95) continue;
        const [nx, nz] = main.points[index + 1];
        const along = Math.atan2(nx - x, nz - z);
        const bearing = along + side * Math.PI / 2 + (random() - 0.5) * 0.3;
        side = -side;
        const start = [x + Math.sin(bearing) * STREET_WIDTH.main / 2, z + Math.cos(bearing) * STREET_WIDTH.main / 2];
        const points = walkStreet({ start, bearing, length: profile.radius * (0.22 + random() * 0.16), step: 8, drift: 0.3, random, isBuildable });
        // A lane that runs into another main street is truncated there.
        const clipped = [points[0]];
        for (const point of points.slice(1)) {
          if (mains.some((other) => other !== main && polylineDistance(other.points, point[0], point[1]) < 12)) break;
          if (Math.hypot(point[0], point[1]) > profile.radius) break;
          clipped.push(point);
        }
        if (clipped.length > 2) streets.push({ kind: 'lane', width: STREET_WIDTH.lane, points: clipped });
      }
    }
  }
  return { streets, squareRadius, bearings };
}
