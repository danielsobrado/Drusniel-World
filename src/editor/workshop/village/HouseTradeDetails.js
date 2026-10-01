import { beveledBox, cylinder } from '../ProceduralWorkshopGeometry.js';
import { lathe, ring } from '../props/PropParts.js';
import { beamBetween, facadeBeam, facadePoint } from './HouseFacade.js';

/**
 * A bellcote on a gable apex: two dressed piers under a small capstone, a bell
 * hung between them. `x`, `z` locate the apex, `y` its height.
 */
export function buildBellcote(kit, { x, y, z, yaw = 0 }) {
  const across = [Math.cos(yaw), -Math.sin(yaw)];
  for (const side of [-1, 1]) {
    kit.stone({
      width: 0.22,
      height: 0.9,
      depth: 0.34,
      position: [x + across[0] * side * 0.34, y + 0.45, z + across[1] * side * 0.34],
      rotation: [0, yaw, 0],
    }, { category: 'ashlar', heightRatio: 0.9 });
  }
  kit.stone({ width: 0.95, height: 0.18, depth: 0.42, position: [x, y + 0.99, z], rotation: [0, yaw, 0] }, { category: 'coping', heightRatio: 1 });
  kit.add('stone', kit.shade(cylinder({ radius: 0.001, radiusTop: 0.02, radiusBottom: 0.36, height: 0.32, position: [x, y + 1.24, z], sides: 4, rotation: [0, yaw + Math.PI / 4, 0] }), 'stone', 1));
  kit.add('metal', lathe([[0.001, 0], [0.19, 0], [0.16, 0.08], [0.11, 0.24], [0.1, 0.32], [0.001, 0.34]], { sides: 14, position: [x, y + 0.5, z] }));
  kit.add('metal', beamBetween([x, y + 0.84, z], [x, y + 0.92, z], 0.03));
}

/** A domed bread oven against a facade, its mouth glowing, with a short flue. */
export function buildBreadOven(kit, facade, u) {
  const centre = facadePoint(facade, u, 0, 0.75);
  kit.stone({ width: 1.5, height: 0.8, depth: 1.4, position: [centre[0], 0.3, centre[2]], rotation: [0, facade.yaw, 0] }, { category: 'ashlar', heightRatio: 0.2 });
  const dome = [];
  for (let step = 0; step <= 8; step += 1) {
    const angle = Math.PI / 2 * step / 8;
    dome.push([0.66 * Math.cos(angle) + 0.001, 0.62 * Math.sin(angle)]);
  }
  kit.add('stone', kit.shade(lathe(dome, { sides: 16, position: [centre[0], 0.7, centre[2]] }), 'stone', 0.6));
  const mouth = facadePoint(facade, u, 0.86, 1.38);
  kit.add('recess', beveledBox({ width: 0.42, height: 0.3, depth: 0.08, position: mouth, rotation: [0, facade.yaw, 0], detail: 1 }));
  kit.add('glow', beveledBox({ width: 0.3, height: 0.12, depth: 0.05, position: [mouth[0], 0.78, mouth[2]], rotation: [0, facade.yaw, 0], detail: 1, bevelRatio: 0.3 }));
  const flue = facadePoint(facade, u, 0, 0.35);
  kit.add('stone', kit.shade(cylinder({ radius: 0.13, height: 1.4, position: [flue[0], 1.5, flue[2]], sides: 10 }), 'stone', 0.9));
}

/** A hoist beam projecting from a gable, with a pulley and hanging rope. */
export function buildHoist(kit, facade, u, y, { reach = 1.1 } = {}) {
  kit.add('wood', facadeBeam(facade, [u, y, -0.4], [u, y, reach], 0.18, { proud: 0.2 }));
  const tip = facadePoint(facade, u, y - 0.2, reach - 0.12);
  kit.add('metal', ring({ inner: 0.05, outer: 0.1, height: 0.04, position: tip, rotation: [Math.PI / 2, 0, facade.yaw] }));
  kit.add('wood', beamBetween(tip, [tip[0], y - 2.6, tip[2]], 0.02));
}

/**
 * A shop front on a facade opening: a counter board let down below the window
 * on chains and a boarded awning pitched above it.
 */
export function buildShopFront(kit, facade, opening) {
  const u = facade.length / 2 + opening.centerX;
  const bottom = facade.y0 + opening.bottom;
  const top = bottom + opening.springHeight + opening.radius;
  const width = opening.width + 0.2;
  kit.add('wood', facadeBeam(facade, [u - width / 2, bottom - 0.05, 0.3], [u + width / 2, bottom - 0.05, 0.3], 0.05, { proud: 0.55 }));
  for (const side of [-1, 1]) {
    kit.add('metal', facadeBeam(facade, [u + side * width * 0.45, bottom + 0.4, 0.02], [u + side * width * 0.45, bottom - 0.04, 0.55], 0.015, { proud: 0.015 }));
  }
  const boards = Math.max(4, Math.round(width / 0.22));
  for (let index = 0; index < boards; index += 1) {
    const x = u - width / 2 + width * (index + 0.5) / boards;
    kit.add('wood', facadeBeam(facade, [x, top + 0.34, 0.02], [x, top + 0.02, 0.8], width / boards * 0.95, { proud: 0.03 }));
  }
  for (const side of [-1, 1]) {
    kit.add('wood', facadeBeam(facade, [u + side * width / 2, top + 0.02, 0.8], [u + side * width / 2, top - 0.35, 0.02], 0.06, { proud: 0.06 }));
  }
}
