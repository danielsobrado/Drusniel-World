import { buildingEntry } from './SettlementBuildingCatalog.js';
import { rect } from './SettlementGeometry.js';
import { STREET_WIDTH } from './SettlementStreets.js';

function placeProp(occupancy, props, kind, variant, x, z, yaw, { ignoreStreets = false } = {}) {
  const [width, depth] = buildingEntry(kind, variant).footprint;
  const box = rect(x, z, width, depth, yaw);
  if (!occupancy.fits(box, { clearance: 0.4, streetClearance: 0.2, ignoreStreets })) return false;
  occupancy.claim(box, { soft: true });
  props.push({ kind, variant, x, z, yaw });
  return true;
}

function pointAlong(points, distance) {
  let remaining = distance;
  for (let index = 1; index < points.length; index += 1) {
    const [ax, az] = points[index - 1];
    const [bx, bz] = points[index];
    const length = Math.hypot(bx - ax, bz - az);
    if (remaining <= length) {
      const t = remaining / length;
      return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, along: Math.atan2(bx - ax, bz - az) };
    }
    remaining -= length;
  }
  return null;
}

function polylineLength(points) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += Math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]);
  }
  return total;
}

/** Street lanterns at the kerb, alternating sides, inside the town. */
function streetLanterns({ profile, occupancy, streets, props, random }) {
  const variant = profile.rank >= 2 ? 0 : 1;
  const spacing = 20 - profile.rank * 1.5;
  for (const street of streets) {
    if (street.kind === 'walk') continue;
    const length = polylineLength(street.points);
    let side = 1;
    for (let s = spacing * (0.4 + random() * 0.6); s < length; s += spacing) {
      const at = pointAlong(street.points, s);
      if (!at || Math.hypot(at.x, at.z) > profile.radius * 1.02) continue;
      const offset = street.width / 2 + 0.7;
      const x = at.x + Math.cos(at.along) * side * offset;
      const z = at.z - Math.sin(at.along) * side * offset;
      placeProp(occupancy, props, 'lantern', variant, x, z, at.along + Math.PI / 2 * side, { ignoreStreets: true });
      side = -side;
    }
  }
}

/** A short paved walk from each house door to its street, and a planter by some doors. */
function doorWalks({ buildings, occupancy, props, walks, random }) {
  for (const building of buildings) {
    if (!building.front) continue;
    const front = [Math.sin(building.yaw), Math.cos(building.yaw)];
    const door = [building.x + front[0] * building.depth / 2, building.z + front[1] * building.depth / 2];
    const [sx, sz] = building.front;
    if (Math.hypot(sx - door[0], sz - door[1]) > 0.8) {
      walks.push({ kind: 'walk', width: STREET_WIDTH.walk, points: [door, [sx, sz]] });
    }
    if (random() < 0.4) {
      const across = [front[1], -front[0]];
      const side = random() < 0.5 ? -1 : 1;
      // Clear of the wall and of the walk: out past the eaves drip, beside the door.
      const x = door[0] + front[0] * 1.3 + across[0] * side * 1.9;
      const z = door[1] + front[1] * 1.3 + across[1] * side * 1.9;
      placeProp(occupancy, props, 'planter', 0, x, z, building.yaw, { ignoreStreets: true });
    }
  }
}

/** The market square: a well at its heart, stalls round it facing in, benches and lanterns at the rim. */
function squareFurniture({ profile, occupancy, squareRadius, props, random }) {
  if (squareRadius <= 0) return;
  props.push({ kind: 'well', variant: 0, x: 0, z: 0, yaw: random() * Math.PI * 2 });
  const stalls = profile.market ? 2 + profile.rank * 2 : 0;
  const phase = random() * Math.PI * 2;
  for (let index = 0; index < stalls; index += 1) {
    const angle = phase + Math.PI * 2 * index / stalls;
    const radius = squareRadius * 0.62;
    props.push({ kind: 'stall', variant: index % 2, x: Math.sin(angle) * radius, z: Math.cos(angle) * radius, yaw: angle + Math.PI });
    if (random() < 0.5) {
      const extra = angle + 0.35;
      props.push({ kind: 'barrels', variant: index % 2, x: Math.sin(extra) * radius * 1.05, z: Math.cos(extra) * radius * 1.05, yaw: angle });
    }
  }
  const rim = Math.max(4, profile.rank * 2 + 2);
  for (let index = 0; index < rim; index += 1) {
    const angle = phase + Math.PI * (2 * index + 1) / rim;
    const radius = squareRadius * 0.92;
    const kind = index % 2 === 0 ? 'lantern' : 'bench';
    props.push({ kind, variant: 0, x: Math.sin(angle) * radius, z: Math.cos(angle) * radius, yaw: angle + Math.PI });
  }
  if (profile.rank >= 2) {
    props.push({ kind: 'cart', variant: 0, x: Math.sin(phase) * squareRadius * 0.3, z: Math.cos(phase) * squareRadius * 0.3, yaw: phase });
  }
  occupancy.claim(rect(0, 0, squareRadius * 2, squareRadius * 2, 0), { soft: true });
}

/** A signpost where each main road enters the town, and a wayside shrine or cross further out. */
function roadMarkers({ profile, occupancy, streets, props, random }) {
  for (const street of streets.filter(({ kind }) => kind === 'main')) {
    const length = polylineLength(street.points);
    for (const [kind, distance] of [['signpost', profile.radius * 1.04], ['shrine', profile.radius * (1.3 + random() * 0.3)]]) {
      if (distance > length) continue;
      const at = pointAlong(street.points, distance);
      if (!at) continue;
      const side = random() < 0.5 ? -1 : 1;
      const offset = street.width / 2 + 1.4;
      placeProp(
        occupancy,
        props,
        kind,
        kind === 'shrine' ? Math.floor(random() * 2) : 0,
        at.x + Math.cos(at.along) * side * offset,
        at.z - Math.sin(at.along) * side * offset,
        at.along - Math.PI / 2 * side,
        { ignoreStreets: true },
      );
    }
  }
}

/** Rail fences round each farm field, in 4 m lengths, leaving a gate gap on the farm side. */
function fieldFences({ fields, props }) {
  const length = buildingEntry('fence', 0).width;
  for (const field of fields) {
    const box = rect(field.x, field.z, field.width, field.depth, field.yaw);
    const sides = [
      { center: [0, field.depth / 2], run: field.width, yaw: field.yaw, gate: true },
      { center: [0, -field.depth / 2], run: field.width, yaw: field.yaw },
      { center: [field.width / 2, 0], run: field.depth, yaw: field.yaw + Math.PI / 2 },
      { center: [-field.width / 2, 0], run: field.depth, yaw: field.yaw + Math.PI / 2 },
    ];
    for (const side of sides) {
      const count = Math.max(1, Math.floor(side.run / length));
      for (let index = 0; index < count; index += 1) {
        if (side.gate && index === Math.floor(count / 2)) continue;
        const offset = -side.run / 2 + length * (index + 0.5) + (side.run - count * length) / 2;
        const local = side.yaw === field.yaw ? [offset, side.center[1]] : [side.center[0], offset];
        const x = box.x + box.ax[0] * local[0] + box.az[0] * local[1];
        const z = box.z + box.ax[1] * local[0] + box.az[1] * local[1];
        // Fence runs along local x; a side fence is turned a quarter.
        props.push({ kind: 'fence', variant: 0, x, z, yaw: side.yaw === field.yaw ? field.yaw : field.yaw + Math.PI / 2 });
      }
    }
  }
}

export function planDecor({ profile, occupancy, streets, squareRadius, buildings, fields, random }) {
  const props = [];
  const walks = [];
  squareFurniture({ profile, occupancy, squareRadius, props, random });
  streetLanterns({ profile, occupancy, streets, props, random });
  doorWalks({ buildings, occupancy, props, walks, random });
  roadMarkers({ profile, occupancy, streets, props, random });
  fieldFences({ fields, props });
  return { props, walks };
}
