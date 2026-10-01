import { beveledBox } from '../ProceduralWorkshopGeometry.js';
import { beamBetween } from '../village/HouseFacade.js';
import { clamp } from '../village/HouseDesign.js';
import { lantern } from './PropParts.js';

/**
 * A street lantern: dressed stone footing, timber post with a braced arm, and a
 * lantern hung from an iron hook. `height` is the post height.
 */
export function buildLanternPost(kit, recipe) {
  const height = clamp(recipe.height, 1.8, 4.5);
  kit.stone({ width: 0.5, height: 0.42, depth: 0.5, position: [0, 0.11, 0] }, { category: 'ashlar', heightRatio: 0.1 });
  kit.stone({ width: 0.34, height: 0.12, depth: 0.34, position: [0, 0.38, 0] }, { category: 'coping', heightRatio: 0.2 });
  kit.add('wood', beamBetween([0, 0.3, 0], [0, height, 0], 0.15));
  kit.add('wood', beveledBox({ width: 0.2, height: 0.08, depth: 0.2, position: [0, height + 0.04, 0], detail: 1, bevelRatio: 0.2 }));
  const armY = height - 0.12;
  const reach = 0.62;
  kit.add('wood', beamBetween([-0.05, armY, 0], [reach, armY, 0], 0.1));
  kit.add('wood', beamBetween([0.02, armY - 0.45, 0], [reach * 0.6, armY - 0.03, 0], 0.06));
  const hookX = reach - 0.08;
  kit.add('metal', beamBetween([hookX, armY - 0.05, 0], [hookX, armY - 0.2, 0], 0.02));
  lantern(kit, { x: hookX, top: armY - 0.18, z: 0 });
}

/**
 * A lantern on an iron wall bracket, for fixing to a facade. The back plate is
 * the object's −z face and the bracket projects toward +z; place it with that
 * face against a wall. `height` is the bracket height above the ground.
 */
export function buildWallLantern(kit, recipe) {
  const height = clamp(recipe.height, 1.8, 3.2);
  kit.add('wood', beveledBox({ width: 0.22, height: 0.34, depth: 0.05, position: [0, height, 0.025], detail: 1, bevelRatio: 0.2 }));
  kit.add('metal', beamBetween([0, height + 0.08, 0.05], [0, height + 0.08, 0.46], 0.03));
  kit.add('metal', beamBetween([0, height - 0.13, 0.05], [0, height + 0.06, 0.3], 0.022));
  kit.add('metal', beamBetween([0, height + 0.06, 0.4], [0, height - 0.04, 0.4], 0.018));
  lantern(kit, { x: 0, top: height - 0.02, z: 0.4, size: 0.22, height: 0.34 });
}
