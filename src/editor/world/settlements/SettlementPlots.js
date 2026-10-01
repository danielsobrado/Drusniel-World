import { buildingEntry, SETTLEMENT_BUILDINGS } from './SettlementBuildingCatalog.js';
import { FARM_BELT } from './SettlementProfile.js';
import { rect } from './SettlementGeometry.js';
import { SettlementOccupancy } from './SettlementOccupancy.js';

/** Generic fill by zone: core (around the square), mid town, and outskirts. */
const ZONE_MIX = Object.freeze({
  core: Object.freeze([['townhouse', 4], ['shop', 2], ['house', 2]]),
  mid: Object.freeze([['house', 6], ['townhouse', 1]]),
  edge: Object.freeze([['house', 1]]),
});

function zoneOf(distance, radius) {
  const ratio = distance / radius;
  if (ratio < 0.38) return 'core';
  if (ratio < 0.8) return 'mid';
  return 'edge';
}

function weighted(random, table) {
  const total = table.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [kind, weight] of table) {
    roll -= weight;
    if (roll <= 0) return kind;
  }
  return table[0][0];
}

/** Landmarks this class of settlement must have, with the zone each prefers. */
function landmarkQueue(profile, random) {
  const queue = [];
  if (profile.chapel) queue.push({ kind: 'chapel', zone: 'core' });
  if (profile.rank >= 1) queue.push({ kind: 'tavern', zone: 'core' }, { kind: 'smithy', zone: 'mid' });
  if (profile.rank >= 2) queue.push({ kind: 'bakery', zone: 'mid' });
  const shops = profile.rank >= 2 ? profile.rank + 1 : 0;
  for (let index = 0; index < shops; index += 1) queue.push({ kind: 'shop', zone: 'core' });
  const warehouses = profile.trade ? Math.max(1, profile.rank - 1) + (profile.port ? 1 : 0) : 0;
  for (let index = 0; index < warehouses; index += 1) queue.push({ kind: 'warehouse', zone: random() < 0.5 ? 'core' : 'mid' });
  return queue;
}

/**
 * Anchor points along every street, both sides, nearest the centre first — so
 * the core fills before the outskirts, and all streets fill evenly.
 */
function frontageAnchors(streets, random, { spacing = 3, maxDistance }) {
  const anchors = [];
  for (const street of streets) {
    if (street.kind === 'walk') continue;
    for (let index = 1; index < street.points.length; index += 1) {
      const [ax, az] = street.points[index - 1];
      const [bx, bz] = street.points[index];
      const length = Math.hypot(bx - ax, bz - az);
      const along = Math.atan2(bx - ax, bz - az);
      for (let s = 0; s < length; s += spacing) {
        const x = ax + (bx - ax) * s / length;
        const z = az + (bz - az) * s / length;
        const distance = Math.hypot(x, z);
        if (distance > maxDistance) continue;
        for (const side of [-1, 1]) {
          anchors.push({ x, z, along, side, street, distance, jitter: random() * 12 });
        }
      }
    }
  }
  return anchors.sort((left, right) => (left.distance + left.jitter) - (right.distance + right.jitter));
}

function tryPlace(occupancy, anchor, kind, variant, setback) {
  const [width, depth] = buildingEntry(kind, variant).footprint;
  const box = SettlementOccupancy.frontage({
    x: anchor.x,
    z: anchor.z,
    along: anchor.along,
    side: anchor.side,
    halfStreet: anchor.street.width / 2,
    setback,
    width,
    depth,
  });
  return occupancy.fits(box) ? box : null;
}

function building(box, kind, variant, anchor) {
  return { kind, variant, x: box.x, z: box.z, yaw: box.yaw, width: box.halfWidth * 2, depth: box.halfDepth * 2, front: anchor ? [anchor.x, anchor.z] : null };
}

/** Keep or lord's hall, set back from the square on a quarter no main street takes. */
function placeKeep(occupancy, profile, bearings, random) {
  const kind = profile.rank >= 3 || profile.walled ? 'keep' : 'hall';
  const variant = 0;
  const [width, depth] = buildingEntry(kind, variant).footprint;
  const gaps = bearings.length
    ? bearings.map((bearing, index) => {
      const next = bearings[(index + 1) % bearings.length] + (index + 1 === bearings.length ? Math.PI * 2 : 0);
      return bearing + ((next - bearing + Math.PI * 4) % (Math.PI * 2)) / 2;
    })
    : [random() * Math.PI * 2];
  for (const bearing of gaps) {
    for (const ratio of [0.3, 0.38, 0.46, 0.55]) {
      const distance = profile.radius * ratio;
      const box = rect(Math.sin(bearing) * distance, Math.cos(bearing) * distance, width, depth, bearing + Math.PI);
      if (occupancy.fits(box, { clearance: 3 })) return building(box, kind, variant, null);
    }
  }
  return null;
}

/** Town plots: landmarks first, then a zone-weighted fill up to the class's target. */
export function planBuildings({ profile, occupancy, streets, bearings, random }) {
  const buildings = [];
  if (profile.keep) {
    const keep = placeKeep(occupancy, profile, bearings, random);
    if (keep) {
      buildings.push(keep);
      occupancy.claim(rect(keep.x, keep.z, keep.width, keep.depth, keep.yaw));
    }
  }
  const queue = landmarkQueue(profile, random);
  const anchors = frontageAnchors(streets, random, { maxDistance: profile.radius });
  for (const anchor of anchors) {
    if (buildings.length >= profile.buildings) break;
    const zone = zoneOf(anchor.distance, profile.radius);
    const landmarkIndex = queue.findIndex((entry) => entry.zone === zone || (zone === 'edge' && entry.zone === 'mid'));
    // Villages and hamlets have no town core: their houses are all dwellings.
    const mix = profile.rank >= 2 ? ZONE_MIX[zone] : ZONE_MIX.edge;
    const kind = landmarkIndex >= 0 ? queue[landmarkIndex].kind : weighted(random, mix);
    const variant = Math.floor(random() * SETTLEMENT_BUILDINGS[kind].length);
    const setback = zone === 'core' ? 0.6 + random() * 0.8 : 1.5 + random() * 3;
    const box = tryPlace(occupancy, anchor, kind, variant, setback);
    if (!box) continue;
    if (landmarkIndex >= 0) queue.splice(landmarkIndex, 1);
    occupancy.claim(box);
    buildings.push(building(box, kind, variant, anchor));
  }
  return buildings;
}

/**
 * The farm belt: farmsteads along the main roads beyond the town, each with a
 * fenced field behind it running away from the road.
 */
export function planFarms({ profile, occupancy, streets, random }) {
  const farms = [];
  const fields = [];
  const mains = streets.filter(({ kind }) => kind === 'main');
  const anchors = frontageAnchors(mains, random, { spacing: 7, maxDistance: profile.radius * FARM_BELT.outer })
    .filter(({ distance }) => distance > profile.radius * FARM_BELT.inner);
  for (const anchor of anchors) {
    if (farms.length >= profile.farms * 2) break;
    const kind = farms.length % 2 === 0 ? 'farmhouse' : (random() < 0.6 ? 'barn' : 'house');
    const variant = Math.floor(random() * SETTLEMENT_BUILDINGS[kind].length);
    const box = tryPlace(occupancy, anchor, kind, variant, 3 + random() * 4);
    if (!box) continue;
    occupancy.claim(box);
    farms.push(building(box, kind, variant, anchor));
    // A field behind the farmstead, fenced on all four sides.
    const fieldWidth = 22 + random() * 18;
    const fieldDepth = 18 + random() * 16;
    const back = [-Math.sin(box.yaw), -Math.cos(box.yaw)];
    const offset = box.halfDepth + 3 + fieldDepth / 2;
    const field = rect(box.x + back[0] * offset, box.z + back[1] * offset, fieldWidth, fieldDepth, box.yaw);
    if (occupancy.fits(field, { clearance: 2 })) {
      occupancy.claim(field, { soft: true });
      fields.push({ x: field.x, z: field.z, width: fieldWidth, depth: fieldDepth, yaw: field.yaw });
    }
  }
  return { farms, fields };
}
