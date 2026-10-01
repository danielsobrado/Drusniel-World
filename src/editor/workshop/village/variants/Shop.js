import { buildChimney, buildHangingSign } from '../HouseDetails.js';
import { buildDormer } from '../HouseDormer.js';
import { buildRoof } from '../HouseRoof.js';
import { joists, storeyRoot } from '../HouseStoreys.js';
import { buildShopFront } from '../HouseTradeDetails.js';
import { clamp, design, OpeningNumbering, roofRise } from '../HouseDesign.js';

/**
 * A merchant's shop: a stone ground floor with wide shop windows, each fitted
 * with a let-down counter and an awning, a jettied dwelling above, a dormer and
 * a hanging sign. Counters follow the windows wherever they are edited to.
 */
export function shopDesign(recipe) {
  const width = clamp(recipe.width, 6, 12);
  const depth = clamp(recipe.depth, 5, 9);
  const eave = clamp(recipe.height, 5, 8);
  const ground = clamp(eave * 0.5, 2.6, 3.6);
  const base = { x0: -width / 2, x1: width / 2, z0: -depth / 2, z1: depth / 2 };
  const upperBox = { ...base, z0: base.z0 - 0.25, z1: base.z1 + 0.35 };

  const shopFloor = { id: 'structure-main', label: 'Shop floor', wall: 'stone', ground: true, box: { ...base, y0: 0, y1: ground } };
  const dwelling = {
    id: 'structure-upper', label: 'Dwelling', wall: 'plaster', roofed: true,
    box: { ...upperBox, y0: ground + 0.11, y1: eave },
    plate: { overhang: 0.08, offset: -0.11 },
    frame: { spacing: 1.4, braces: 'cross', left: { braces: 'diagonal' }, right: { braces: 'diagonal' } },
    openings: { shutters: true, flowers: true },
  };

  const numbering = new OpeningNumbering(recipe);
  numbering.door(shopFloor, 'front', { centerX: 0, width: 1.1, height: 2.2 });
  for (const side of [-1, 1]) {
    numbering.add('structure-main', { centerX: side * width * 0.28, bottom: 0.95, width: Math.min(1.8, width * 0.22), height: 1.15, label: 'Shop window' });
  }
  numbering.door(shopFloor, 'back', { centerX: width * 0.25, width: 0.9, height: 2.0 });
  numbering.row(shopFloor, 'left', { spacing: 9, bottom: 1.0, width: 0.7, height: 0.8, arch: true });
  numbering.row(shopFloor, 'right', { spacing: 9, bottom: 1.0, width: 0.7, height: 0.8, arch: true });
  numbering.row(dwelling, 'front', { spacing: 2.2, bottom: 0.7, width: 0.85, height: 1.0 });
  numbering.row(dwelling, 'back', { spacing: 2.6, bottom: 0.7, width: 0.8, height: 0.9 });
  numbering.row(dwelling, 'left', { spacing: 3, bottom: 0.8, width: 0.7, height: 0.8 });
  numbering.row(dwelling, 'right', { spacing: 3, bottom: 0.8, width: 0.7, height: 0.8 });

  return design({
    storeys: [shopFloor, dwelling],
    openings: numbering.openings,
    build(kit, { resolved, facades }) {
      const front = facades.get(shopFloor.id).front;
      kit.within(storeyRoot(shopFloor), () => {
        for (const opening of resolved.get('structure-main') ?? []) {
          if (!opening.door) buildShopFront(kit, front, opening);
        }
        joists(kit, front, ground - 0.14, { out: 0.45, spacing: 0.8 });
        buildHangingSign(kit, front, 0.45, ground - 0.25, { out: 1.0 });
      });
      kit.within(storeyRoot(dwelling), () => {
        const roof = buildRoof(kit, {
          ...upperBox,
          axis: 'x',
          wallTop: eave,
          rise: roofRise(recipe, (upperBox.z1 - upperBox.z0) / 2),
          overhang: recipe.roofOverhang,
          sweep: 0.3,
        }, { gableFrame: true });
        buildDormer(kit, roof, { at: 0, side: 1, width: 1.1, height: 0.9 });
        buildChimney(kit, { x: width * 0.32, z: -depth * 0.15, width: 0.75, depth: 0.75, y0: eave - 0.4, y1: eave + roof.rise + 0.7, pots: 2 });
      });
    },
  });
}
