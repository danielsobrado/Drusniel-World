import { buildChimney } from '../HouseDetails.js';
import { buildRoof } from '../HouseRoof.js';
import { storeyRoot } from '../HouseStoreys.js';
import { buildBreadOven } from '../HouseTradeDetails.js';
import { clamp, design, OpeningNumbering, roofRise } from '../HouseDesign.js';

/**
 * A village bakery: a single-storey stone cottage with a steep roof and a
 * domed bread oven built against its gable, the oven mouth glowing.
 */
export function bakeryDesign(recipe) {
  const width = clamp(recipe.width, 5, 10);
  const depth = clamp(recipe.depth, 4, 7);
  const eave = clamp(recipe.height, 2.6, 4);
  const box = { x0: -width / 2, x1: width / 2, z0: -depth / 2, z1: depth / 2 };
  const bakehouse = { id: 'structure-main', label: 'Bakehouse', wall: 'stone', ground: true, box: { ...box, y0: 0, y1: eave } };

  const numbering = new OpeningNumbering(recipe);
  numbering.door(bakehouse, 'front', { centerX: -width * 0.18, width: 1.0, height: 2.0, arch: true });
  numbering.add('structure-main', { centerX: width * 0.22, bottom: 0.9, width: 1.1, height: 0.9 });
  numbering.row(bakehouse, 'back', { spacing: 3, bottom: 1.0, width: 0.7, height: 0.7 });
  numbering.row(bakehouse, 'left', { spacing: 9, bottom: 1.0, width: 0.6, height: 0.7, arch: true });

  return design({
    storeys: [bakehouse],
    openings: numbering.openings,
    build(kit, { facades }) {
      kit.within(storeyRoot(bakehouse), () => {
        const roof = buildRoof(kit, {
          ...box,
          axis: 'x',
          wallTop: eave,
          rise: roofRise(recipe, depth / 2, { minimumPitch: 45 }),
          overhang: recipe.roofOverhang,
          sweep: 0.35,
        }, { gableFrame: true });
        buildBreadOven(kit, facades.get(bakehouse.id).right, depth / 2);
        buildChimney(kit, { x: -width * 0.25, z: 0, width: 0.7, depth: 0.7, y0: eave - 0.4, y1: eave + roof.rise + 0.6, pots: 1 });
      });
    },
  });
}
