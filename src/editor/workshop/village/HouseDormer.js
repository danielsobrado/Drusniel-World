import { beveledBox } from '../ProceduralWorkshopGeometry.js';
import { centredFacade } from './HouseFacade.js';
import { buildWindow } from './HouseOpenings.js';
import { buildRoof } from './HouseRoof.js';

const CHEEK = 0.1;

/**
 * A gabled dormer standing on a roof slope.
 *
 * `at` is the position along the host ridge, `side` the slope (+1 or −1 across
 * it) and `reach` how far down the slope the front wall stands (0 ridge, 1 wall
 * line). The dormer's cheeks and roof run back into the host roof until they
 * meet it; the part inside the attic is never visible.
 */
export function buildDormer(kit, roof, { at, side, width = 1.0, height = 0.9, reach = 0.78, pitch = 42 }) {
  const r = Math.min(roof.wallRatio * 0.98, Math.max(0.2, reach * roof.wallRatio));
  const base = roof.height(r, at);
  const top = base + height + 0.3;
  const front = side * roof.eaves * r;
  const halfWidth = width / 2 + 0.14;
  const backR = Math.max(0.02, roof.distanceAtHeight(top + 0.2, at));
  const back = side * roof.eaves * backR;
  const normal = [roof.acrossAxis[0] * side, roof.acrossAxis[1] * side];
  const yaw = Math.atan2(normal[0], normal[1]);

  const frontPoint = roof.toWorld(at, 0, front);
  kit.add('mortar', beveledBox({
    width: halfWidth * 2,
    height: top - base + 0.35,
    depth: CHEEK,
    position: [frontPoint[0] - normal[0] * CHEEK / 2, (base - 0.35 + top) / 2, frontPoint[2] - normal[1] * CHEEK / 2],
    rotation: [0, yaw, 0],
    detail: 1,
    bevelRatio: 0.04,
  }));
  const depth = Math.abs(front - back);
  for (const edge of [-1, 1]) {
    const cheek = roof.toWorld(at + edge * (halfWidth - CHEEK / 2), 0, (front + back) / 2);
    kit.add('mortar', beveledBox({
      width: CHEEK,
      height: top - base + 0.35,
      depth,
      position: [cheek[0], (base - 0.35 + top) / 2, cheek[2]],
      rotation: [0, yaw, 0],
      detail: 1,
      bevelRatio: 0.04,
    }));
  }

  const facade = centredFacade([frontPoint[0], frontPoint[2]], normal, halfWidth * 2, base, top);
  buildWindow(kit, facade, {
    centerX: 0,
    bottom: 0.14,
    width,
    springHeight: height - 0.1,
    radius: 0,
    rectangular: true,
  }, { wall: 'plaster', flowers: false });

  // The dormer's own roof: ridge perpendicular to the host, gabled at the front.
  const corners = [
    roof.toWorld(at - halfWidth, 0, front),
    roof.toWorld(at + halfWidth, 0, back),
  ];
  const axis = roof.axis === 'x' ? 'z' : 'x';
  const alongDormer = axis === 'x' ? [1, 0] : [0, 1];
  const frontIsEnd = alongDormer[0] * normal[0] + alongDormer[1] * normal[1] > 0;
  buildRoof(kit, {
    x0: Math.min(corners[0][0], corners[1][0]),
    x1: Math.max(corners[0][0], corners[1][0]),
    z0: Math.min(corners[0][2], corners[1][2]),
    z1: Math.max(corners[0][2], corners[1][2]),
    axis,
    wallTop: top,
    rise: halfWidth * Math.tan(pitch * Math.PI / 180),
    overhang: 0.12,
    endOverhang: 0.16,
  }, {
    gableEnds: frontIsEnd ? { start: null, end: 'plaster' } : { start: 'plaster', end: null },
    tiles: false,
  });
}
