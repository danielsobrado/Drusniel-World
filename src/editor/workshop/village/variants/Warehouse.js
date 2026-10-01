import { buildRoof } from '../HouseRoof.js';
import { storeyRoot } from '../HouseStoreys.js';
import { buildHoist } from '../HouseTradeDetails.js';
import { clamp, design, OpeningNumbering, roofRise } from '../HouseDesign.js';

/**
 * A merchant's warehouse, gable to the quay: a stone ground floor with a cart
 * door, a tall loft storey with stacked loading doors, and a hoist beam under
 * the gable apex.
 */
export function warehouseDesign(recipe) {
  const width = clamp(recipe.width, 6, 12);
  const depth = clamp(recipe.depth, 8, 12);
  const eave = clamp(recipe.height, 7, 12);
  const ground = clamp(eave * 0.4, 3, 4.4);
  const box = { x0: -width / 2, x1: width / 2, z0: -depth / 2, z1: depth / 2 };
  const store = { id: 'structure-main', label: 'Ground store', wall: 'stone', ground: true, thickness: 0.5, box: { ...box, y0: 0, y1: ground } };
  const loft = {
    id: 'structure-upper', label: 'Loft', wall: 'plaster', roofed: true,
    box: { ...box, x0: box.x0 - 0.1, x1: box.x1 + 0.1, z0: box.z0 - 0.1, z1: box.z1 + 0.1, y0: ground + 0.11, y1: eave },
    plate: { overhang: 0.08, offset: -0.11 },
    frame: { spacing: 1.8, braces: 'diagonal', rails: [ground + (eave - ground) / 2] },
  };
  const loftHeight = eave - ground;

  const numbering = new OpeningNumbering(recipe);
  numbering.door(store, 'front', { centerX: 0, width: 2.2, height: Math.min(3, ground - 0.4) });
  numbering.row(store, 'left', { spacing: 3, bottom: ground * 0.55, width: 0.5, height: 0.6 });
  numbering.row(store, 'right', { spacing: 3, bottom: ground * 0.55, width: 0.5, height: 0.6 });
  numbering.door(store, 'back', { centerX: 0, width: 1.2, height: 2.2 });
  for (const bottom of loftHeight > 4.2 ? [0.25, loftHeight / 2 + 0.2] : [0.3]) {
    numbering.door(loft, 'front', { centerX: 0, bottom, width: 1.2, height: Math.min(1.8, loftHeight / 2 - 0.4), label: 'Loading door' });
  }
  numbering.row(loft, 'left', { spacing: 2.6, bottom: loftHeight * 0.35, width: 0.6, height: 0.7 });
  numbering.row(loft, 'right', { spacing: 2.6, bottom: loftHeight * 0.35, width: 0.6, height: 0.7 });

  return design({
    storeys: [store, loft],
    openings: numbering.openings,
    build(kit, { facades }) {
      kit.within(storeyRoot(loft), () => {
        const halfSpan = width / 2 + 0.1;
        const roof = buildRoof(kit, {
          ...loft.box,
          axis: 'z',
          wallTop: eave,
          rise: roofRise(recipe, halfSpan, { minimumPitch: 45 }),
          overhang: 0.3,
          endOverhang: 0.25,
        }, { gableFrame: true });
        const front = facades.get(loft.id).front;
        buildHoist(kit, front, front.length / 2, eave + roof.rise * 0.55, { reach: 1.2 });
      });
    },
  });
}
