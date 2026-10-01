import { beveledBox } from '../ProceduralWorkshopGeometry.js';
import { beamBetween } from '../village/HouseFacade.js';
import { clamp } from '../village/HouseDesign.js';
import { buildRoof } from '../village/HouseRoof.js';
import { barrel, crate, lantern } from './PropParts.js';

/**
 * A market stall: four posts, a plank counter across the front, a small tiled
 * roof, a lantern under the eaves and stock stacked beside it. `width` is the
 * frontage and `height` the eaves height.
 */
export function buildMarketStall(kit, recipe) {
  const width = clamp(recipe.width, 2, 5);
  const eave = clamp(recipe.height, 2.2, 3.2);
  const depth = 1.6;
  const x = width / 2 - 0.08;
  const z = depth / 2 - 0.08;
  for (const [px, pz] of [[-x, -z], [x, -z], [x, z], [-x, z]]) {
    kit.add('wood', beamBetween([px, -0.1, pz], [px, eave, pz], 0.13));
  }
  for (const pz of [-z, z]) kit.add('wood', beamBetween([-x - 0.06, eave - 0.06, pz], [x + 0.06, eave - 0.06, pz], 0.14));
  kit.add('wood', beveledBox({ width: width - 0.1, height: 0.07, depth: 0.62, position: [0, 0.92, z - 0.24], detail: 1, bevelRatio: 0.1 }));
  const boards = Math.max(4, Math.round(width / 0.28));
  for (let index = 0; index < boards; index += 1) {
    const bx = -width / 2 + 0.1 + (width - 0.2) * (index + 0.5) / boards;
    kit.add('wood', beveledBox({ width: (width - 0.2) / boards * 0.95, height: 0.86, depth: 0.04, position: [bx, 0.46, z + 0.04], detail: 1, bevelRatio: 0.1 }));
  }
  buildRoof(kit, {
    x0: -width / 2,
    x1: width / 2,
    z0: -depth / 2,
    z1: depth / 2,
    axis: 'x',
    wallTop: eave,
    rise: 0.55,
    overhang: 0.35,
    endOverhang: 0.2,
  }, { gableEnds: { start: 'boards', end: 'boards' }, tiles: false });
  lantern(kit, { x: x - 0.35, top: eave - 0.12, z: z - 0.05, size: 0.2, height: 0.3 });
  kit.add('metal', beamBetween([x - 0.35, eave - 0.06, z - 0.05], [x - 0.35, eave - 0.14, z - 0.05], 0.015));
  crate(kit, { x: -width * 0.22, y: 0.955, z: z - 0.26, size: 0.42, height: 0.28, yaw: 0.1 });
  crate(kit, { x: width * 0.18, y: 0.955, z: z - 0.24, size: 0.38, height: 0.24, yaw: -0.2 });
  barrel(kit, { x: x + 0.45, y: 0, z: z - 0.2, radius: 0.27, height: 0.72 });
  crate(kit, { x: x + 0.42, y: 0, z: -z + 0.25, size: 0.55, yaw: 0.3 });
}

/** A cluster of barrels: three standing, one lying on the ground with chocks. */
export function buildBarrels(kit) {
  const standing = [[-0.34, -0.1, 0.32], [0.3, -0.2, 0.3], [0, 0.38, 0.28]];
  for (const [x, z, radius] of standing) {
    barrel(kit, { x, z, radius, height: radius * 2.7, yaw: kit.random() * Math.PI });
  }
  barrel(kit, { x: 0.15, z: 0.95, radius: 0.28, height: 0.76, lying: true, yaw: 0.25 });
  for (const side of [-1, 1]) {
    kit.add('wood', beveledBox({ width: 0.14, height: 0.1, depth: 0.12, position: [0.15 + side * 0.28, 0.05, 1.18], rotation: [0, 0.25, 0], detail: 1 }));
  }
}

/** A stack of crates, two or three on the ground and one or two on top. */
export function buildCrates(kit) {
  const base = [[-0.36, 0, 0.62], [0.34, 0.06, 0.58], [0.02, 0.66, 0.55]];
  for (const [x, z, size] of base) {
    crate(kit, { x, z, size, yaw: (kit.random() - 0.5) * 0.4 });
  }
  crate(kit, { x: -0.04, y: 0.62, z: 0.04, size: 0.56, yaw: 0.5 + (kit.random() - 0.5) * 0.3 });
  crate(kit, { x: 0.05, y: 0.62 + 0.56, z: 0.02, size: 0.42, yaw: (kit.random() - 0.5) * 0.8 });
}
