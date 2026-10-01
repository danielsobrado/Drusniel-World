import { beveledBox, cylinder } from '../ProceduralWorkshopGeometry.js';
import { beamBetween } from '../village/HouseFacade.js';
import { clamp } from '../village/HouseDesign.js';
import { lantern, ring } from './PropParts.js';

/** A knee-high path light: a dressed stone foot, a short post and a lantern on top. */
export function buildWalkLantern(kit) {
  kit.stone({ width: 0.34, height: 0.22, depth: 0.34, position: [0, 0.06, 0] }, { category: 'ashlar', heightRatio: 0.1 });
  kit.add('wood', beamBetween([0, 0.15, 0], [0, 0.72, 0], 0.11));
  kit.add('metal', beveledBox({ width: 0.2, height: 0.03, depth: 0.2, position: [0, 0.73, 0], detail: 1 }));
  lantern(kit, { x: 0, top: 1.12, z: 0, size: 0.18, height: 0.28 });
}

/**
 * A stone pillar lantern: plinth, turned shaft, an open light chamber of four
 * dressed posts round a glowing core, and a pyramidal cap with a finial.
 * `height` sets the overall height.
 */
export function buildStoneLantern(kit, recipe) {
  const height = clamp(recipe.height, 1.2, 3);
  const chamber = 0.36;
  const shaftTop = height - chamber - 0.3;
  kit.stone({ width: 0.62, height: 0.22, depth: 0.62, position: [0, 0.05, 0] }, { category: 'ashlar', heightRatio: 0.05 });
  kit.stone({ width: 0.3, height: shaftTop - 0.16, depth: 0.3, position: [0, 0.16 + (shaftTop - 0.16) / 2, 0] }, { category: 'ashlar', heightRatio: 0.4 });
  kit.stone({ width: 0.46, height: 0.1, depth: 0.46, position: [0, shaftTop + 0.05, 0] }, { category: 'coping', heightRatio: 0.7 });
  const post = 0.07;
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    kit.stone({
      width: post,
      height: chamber,
      depth: post,
      position: [x * 0.16, shaftTop + 0.1 + chamber / 2, z * 0.16],
    }, { category: 'ashlar', heightRatio: 0.8 });
  }
  kit.add('glow', beveledBox({ width: 0.2, height: chamber * 0.7, depth: 0.2, position: [0, shaftTop + 0.1 + chamber / 2, 0], detail: 1, bevelRatio: 0.2 }));
  const capBase = shaftTop + 0.1 + chamber;
  kit.add('stone', kit.shade(cylinder({
    radius: 0.001,
    radiusTop: 0.04,
    radiusBottom: 0.36,
    height: 0.24,
    position: [0, capBase + 0.12, 0],
    sides: 4,
    rotation: [0, Math.PI / 4, 0],
  }), 'stone', 1));
  kit.add('stone', kit.shade(cylinder({ radius: 0.05, radiusTop: 0.01, radiusBottom: 0.06, height: 0.14, position: [0, capBase + 0.3, 0], sides: 8 }), 'stone', 1));
}

/** A timber torch post with an iron basket of burning pitch. `height` is the post height. */
export function buildTorchPost(kit, recipe) {
  const height = clamp(recipe.height, 1.4, 3);
  kit.add('wood', beamBetween([0, -0.25, 0], [0, height, 0], 0.12));
  for (const level of [height - 0.06, height + 0.22]) {
    kit.add('metal', ring({ inner: 0.1, outer: 0.13, height: 0.03, position: [0, level, 0], sides: 12 }));
  }
  for (let index = 0; index < 6; index += 1) {
    const angle = Math.PI * 2 * index / 6;
    kit.add('metal', beamBetween(
      [Math.cos(angle) * 0.1, height - 0.08, Math.sin(angle) * 0.1],
      [Math.cos(angle) * 0.14, height + 0.26, Math.sin(angle) * 0.14],
      0.02,
    ));
  }
  // Flame: a few twisted, tapering glow blades.
  for (let index = 0; index < 4; index += 1) {
    const lift = 0.2 + kit.random() * 0.14;
    kit.add('glow', cylinder({
      radius: 0.001,
      radiusTop: 0.005,
      radiusBottom: 0.07 + kit.random() * 0.03,
      height: lift,
      position: [(kit.random() - 0.5) * 0.06, height + 0.04 + lift / 2, (kit.random() - 0.5) * 0.06],
      sides: 5,
      rotation: [(kit.random() - 0.5) * 0.3, kit.random() * Math.PI, (kit.random() - 0.5) * 0.3],
    }));
  }
}
