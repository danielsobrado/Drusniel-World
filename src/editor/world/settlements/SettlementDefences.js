import { buildingEntry } from './SettlementBuildingCatalog.js';
import { rect } from './SettlementGeometry.js';

const WALL_OFFSET = 7;
const TOWER_EVERY = 4;

function piece(kind, x, z, yaw) {
  const [width, depth] = buildingEntry(kind, 0).footprint;
  return { kind, variant: 0, x, z, yaw, width, depth, front: null };
}

function angleGap(a, b) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

/**
 * A curtain wall round a walled burg: straight 12 m lengths on a circle just
 * outside the town, a gatehouse wherever a main road crosses it and a round
 * tower at every few joints. Stretches over water or cliffs are left open.
 * Pieces are workshop castle archetypes, so they share the masonry pipeline.
 */
export function planDefences({ profile, occupancy, streets }) {
  if (!profile.walled) return [];
  const radius = profile.radius + WALL_OFFSET;
  const segment = buildingEntry('wall', 0).width;
  const count = Math.max(12, Math.round(Math.PI * 2 * radius / segment));
  const step = Math.PI * 2 / count;
  const gates = streets
    .filter(({ kind }) => kind === 'main')
    .map((street) => {
      const crossing = street.points.find(([x, z]) => Math.hypot(x, z) >= radius) ?? street.points.at(-1);
      return Math.atan2(crossing[0], crossing[1]);
    });
  const pieces = [];
  const gateSpan = step * 0.9;
  for (const angle of gates) {
    const x = Math.sin(angle) * radius;
    const z = Math.cos(angle) * radius;
    // The gate passage faces out along the road.
    pieces.push(piece('gatehouse', x, z, angle));
    occupancy.claim(rect(x, z, ...buildingEntry('gatehouse', 0).footprint, angle));
  }
  for (let index = 0; index < count; index += 1) {
    const angle = step * (index + 0.5);
    if (gates.some((gate) => angleGap(gate, angle) < gateSpan)) continue;
    const x = Math.sin(angle) * radius * Math.cos(step / 2);
    const z = Math.cos(angle) * radius * Math.cos(step / 2);
    // A wall's length runs along its local x, tangent to the circle.
    const box = rect(x, z, segment, buildingEntry('wall', 0).footprint[1], angle);
    // Neighbouring lengths abut end to end; test a slightly shorter box so a
    // wall is never refused for touching the length before it.
    const probe = rect(x, z, segment * 0.85, box.halfDepth * 2, angle);
    if (occupancy.conflict(probe, { clearance: 0, ignoreStreets: true }) !== null) continue;
    occupancy.claim(box, { soft: true });
    pieces.push(piece('wall', x, z, angle));
    if (index % TOWER_EVERY === 0) {
      const joint = angle - step / 2;
      const tower = rect(Math.sin(joint) * radius, Math.cos(joint) * radius, ...buildingEntry('tower', 0).footprint, joint);
      if (occupancy.conflict(tower, { clearance: 0, ignoreStreets: true, ground: true }) === 'water') continue;
      occupancy.claim(rect(tower.x, tower.z, 1, 1, joint), { soft: true });
      pieces.push(piece('tower', tower.x, tower.z, joint));
    }
  }
  return pieces;
}
