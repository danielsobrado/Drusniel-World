import { buildChimney } from '../HouseDetails.js';
import { buildDormer } from '../HouseDormer.js';
import { buildRoof } from '../HouseRoof.js';
import { storeyRoot } from '../HouseStoreys.js';
import { clamp, design, OpeningNumbering, roofRise } from '../HouseDesign.js';

/**
 * A longhouse: dwelling and byre under one long, steep, low-eaved roof. The
 * dwelling end is stone with dormers above; the byre end is board-clad with a
 * cart door and a loft hatch in its gable.
 */
export function farmhouseDesign(recipe) {
  const width = clamp(recipe.width, 10, 16);
  const depth = clamp(recipe.depth, 5, 8);
  const eave = clamp(recipe.height, 2.6, 4.2);
  const split = -width / 2 + width * 0.55;
  const range = { x0: -width / 2, x1: width / 2, z0: -depth / 2, z1: depth / 2 };
  const dwelling = { id: 'structure-main', label: 'Dwelling', wall: 'stone', ground: true, skip: ['right'], box: { ...range, x1: split, y0: 0, y1: eave } };
  const byre = { id: 'structure-byre', label: 'Byre', wall: 'boards', skip: ['left'], box: { ...range, x0: split, y0: 0, y1: eave } };
  const dwellingWidth = split - range.x0;
  const byreWidth = range.x1 - split;

  const numbering = new OpeningNumbering(recipe);
  numbering.door(dwelling, 'front', { centerX: dwellingWidth * 0.1, width: 1.0, height: 2.0, arch: true });
  numbering.add('structure-main', { centerX: -dwellingWidth * 0.28, bottom: 0.9, width: 0.8, height: 0.8 });
  numbering.add('structure-main', { centerX: dwellingWidth * 0.36, bottom: 0.9, width: 0.8, height: 0.8 });
  numbering.row(dwelling, 'back', { spacing: 2.6, bottom: 0.9, width: 0.7, height: 0.7 });
  numbering.row(dwelling, 'left', { spacing: 9, bottom: 0.9, width: 0.7, height: 0.7 });
  numbering.door(byre, 'front', { centerX: 0, width: Math.min(2.6, byreWidth * 0.45), height: Math.min(2.6, eave - 0.2), label: 'Cart door' });
  numbering.row(byre, 'back', { spacing: 2.5, bottom: 1.4, width: 0.6, height: 0.5 });
  numbering.door(byre, 'right', { centerX: 0, bottom: Math.max(0.3, eave - 1.3), width: 0.9, height: 1.0, label: 'Loft hatch' });

  return design({
    storeys: [dwelling, byre],
    openings: numbering.openings,
    build(kit) {
      kit.within(storeyRoot(dwelling), () => {
        const roof = buildRoof(kit, {
          ...range,
          axis: 'x',
          wallTop: eave,
          rise: roofRise(recipe, depth / 2, { minimumPitch: 48, pitchScale: 1.2 }),
          overhang: Math.max(0.5, recipe.roofOverhang),
          endOverhang: 0.45,
          sweep: 0.3,
          sag: 0.15,
        }, { gableEnds: { start: 'plaster', end: 'boards' }, gableFrame: true });
        for (const ratio of [0.3, 0.72]) {
          buildDormer(kit, roof, { at: range.x0 + dwellingWidth * ratio, side: 1, width: 0.9, height: 0.8, reach: 0.85 });
        }
        buildChimney(kit, { x: split - 0.45, z: 0, width: 0.8, depth: 0.9, y0: eave - 0.4, y1: eave + roof.rise + 0.6, pots: 2 });
      });
    },
  });
}
