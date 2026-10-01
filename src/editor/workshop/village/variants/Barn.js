import { buildRoof } from '../HouseRoof.js';
import { storeyRoot } from '../HouseStoreys.js';
import { clamp, design, OpeningNumbering, roofRise } from '../HouseDesign.js';

const PLINTH = 0.6;

/**
 * A board-clad barn on a low stone plinth, gable to the yard: a great cart
 * door, a hayloft door above it, and slit windows down its long sides.
 */
export function barnDesign(recipe) {
  const width = clamp(recipe.width, 6, 14);
  const depth = clamp(recipe.depth, 6, 12);
  const eave = clamp(recipe.height, 3.4, 6);
  const box = { x0: -width / 2, x1: width / 2, z0: -depth / 2, z1: depth / 2 };
  const plinth = { id: 'structure-plinth', label: 'Plinth', wall: 'stone', ground: true, quoins: false, box: { ...box, y0: 0, y1: PLINTH } };
  const walls = { id: 'structure-main', label: 'Barn', wall: 'boards', box: { ...box, y0: PLINTH, y1: eave } };
  const wallHeight = eave - PLINTH;

  const numbering = new OpeningNumbering(recipe);
  const doorHeight = Math.min(2.8, wallHeight - 0.3);
  numbering.door(walls, 'front', { centerX: 0, width: Math.min(3, width * 0.4), height: doorHeight, label: 'Cart door' });
  if (wallHeight - doorHeight > 1.4) {
    numbering.door(walls, 'front', { centerX: 0, bottom: doorHeight + 0.3, width: 1.0, height: wallHeight - doorHeight - 0.5, label: 'Hayloft door' });
  }
  numbering.door(walls, 'back', { centerX: -width * 0.2, width: 1.0, height: 2.0 });
  for (const side of ['left', 'right']) {
    numbering.row(walls, side, { spacing: 2.4, bottom: wallHeight * 0.45, width: 0.3, height: 0.8 });
  }

  return design({
    storeys: [plinth, walls],
    openings: numbering.openings,
    build(kit) {
      kit.within(storeyRoot(walls), () => {
        buildRoof(kit, {
          ...box,
          axis: 'z',
          wallTop: eave,
          rise: roofRise(recipe, width / 2, { minimumPitch: 42 }),
          overhang: Math.max(0.4, recipe.roofOverhang),
          endOverhang: 0.35,
          sag: 0.1,
        }, { gableEnds: { start: 'boards', end: 'boards' } });
      });
    },
  });
}
