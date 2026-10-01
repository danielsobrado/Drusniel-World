import { beveledBox, cylinder } from '../ProceduralWorkshopGeometry.js';
import { beamBetween } from '../village/HouseFacade.js';
import { barrel, crate, wheel } from './PropParts.js';

const BED_LENGTH = 1.9;
const BED_WIDTH = 1.05;
const WHEEL_RADIUS = 0.55;

/**
 * A two-wheeled hand cart resting on its prop leg, shafts toward +z, carrying a
 * barrel and a crate.
 */
export function buildCart(kit) {
  const bedY = WHEEL_RADIUS + 0.12;
  const planks = 5;
  for (let index = 0; index < planks; index += 1) {
    const x = -BED_WIDTH / 2 + BED_WIDTH * (index + 0.5) / planks;
    kit.add('wood', beveledBox({ width: BED_WIDTH / planks * 0.94, height: 0.05, depth: BED_LENGTH, position: [x, bedY, 0], detail: 1, bevelRatio: 0.1 }));
  }
  for (const side of [-1, 1]) {
    kit.add('wood', beveledBox({ width: 0.04, height: 0.32, depth: BED_LENGTH, position: [side * BED_WIDTH / 2, bedY + 0.18, 0], detail: 1, bevelRatio: 0.1 }));
    kit.add('wood', beveledBox({ width: BED_WIDTH, height: 0.32, depth: 0.04, position: [0, bedY + 0.18, side * BED_LENGTH / 2], detail: 1, bevelRatio: 0.1 }));
    // Shafts run from the bed's rear rail forward and down to the ground.
    kit.add('wood', beamBetween([side * 0.42, bedY - 0.06, -BED_LENGTH / 2], [side * 0.36, 0.08, BED_LENGTH / 2 + 1.5], 0.08));
    wheel(kit, { x: side * (BED_WIDTH / 2 + 0.1), z: 0.05, radius: WHEEL_RADIUS });
  }
  kit.add('metal', cylinder({ radius: 0.035, height: BED_WIDTH + 0.36, position: [0, WHEEL_RADIUS, 0.05], rotation: [0, 0, Math.PI / 2], sides: 8 }));
  kit.add('wood', beamBetween([0, bedY - 0.04, -BED_LENGTH / 2 + 0.12], [0, 0, -BED_LENGTH / 2 - 0.1], 0.07));
  barrel(kit, { x: -0.22, y: bedY + 0.03, z: -0.35, radius: 0.24, height: 0.62 });
  crate(kit, { x: 0.24, y: bedY + 0.03, z: 0.4, size: 0.45, yaw: 0.2 });
}
