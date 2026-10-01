import { buildChimney } from '../HouseDetails.js';
import { buildRoof } from '../HouseRoof.js';
import { joists, storeyRoot } from '../HouseStoreys.js';
import { clamp, design, OpeningNumbering, roofRise } from '../HouseDesign.js';

/**
 * A narrow terraced town house with its gable to the street: a stone ground
 * floor and two storeys jettied over the street. Its side walls are party walls
 * and are left blank, so a row of them reads as a street front.
 */
export function rowhouseDesign(recipe) {
  const width = clamp(recipe.width, 4.5, 7);
  const depth = clamp(recipe.depth, 7, 12);
  const eave = clamp(recipe.height, 7, 12);
  const ground = clamp(eave * 0.34, 2.4, 3.4);
  const second = ground + (eave - ground) / 2;
  const base = { x0: -width / 2, x1: width / 2, z0: -depth / 2, z1: depth / 2 };
  const box2 = { ...base, z0: base.z0 - 0.3, z1: base.z1 + 0.35 };
  const box3 = { ...box2, z0: box2.z0 - 0.25, z1: box2.z1 + 0.3 };
  const timber = (id, label, box, y0, y1, extra) => ({
    id, label, wall: 'plaster', box: { ...box, y0: y0 + 0.11, y1 },
    plate: { overhang: 0.06, offset: -0.11 },
    frame: { spacing: 1.2, braces: 'diagonal', rails: [y0 + (y1 - y0) * 0.38], left: { braces: 'none' }, right: { braces: 'none' } },
    openings: { flowers: true },
    ...extra,
  });
  const floor1 = { id: 'structure-main', label: 'Ground floor', wall: 'stone', ground: true, box: { ...base, y0: 0, y1: ground } };
  const floor2 = timber('structure-upper', 'First floor', box2, ground, second);
  const floor3 = timber('structure-top', 'Second floor', box3, second, eave, { roofed: true });

  const numbering = new OpeningNumbering(recipe);
  numbering.door(floor1, 'front', { centerX: -width * 0.22, width: 1.0, height: 2.1 });
  numbering.add('structure-main', { centerX: width * 0.2, bottom: 0.8, width: 1.3, height: 1.2 });
  numbering.row(floor1, 'back', { spacing: 9, bottom: 0.9, width: 0.8, height: 0.9, arch: true });
  for (const storey of [floor2, floor3]) {
    numbering.row(storey, 'front', { spacing: 1.9, margin: 0.5, bottom: 0.8, width: 0.75, height: 1.0 });
    numbering.row(storey, 'back', { spacing: 2.4, margin: 0.5, bottom: 0.8, width: 0.7, height: 0.9 });
  }

  return design({
    storeys: [floor1, floor2, floor3],
    openings: numbering.openings,
    build(kit, { facades }) {
      kit.within(storeyRoot(floor1), () => {
        const facade = facades.get(floor1.id);
        joists(kit, facade.front, ground - 0.14, { out: 0.45, spacing: 0.7 });
        joists(kit, facade.back, ground - 0.14, { out: 0.4, spacing: 0.7 });
      });
      kit.within(storeyRoot(floor3), () => {
        const roof = buildRoof(kit, {
          ...box3,
          axis: 'z',
          wallTop: eave,
          rise: roofRise(recipe, width / 2, { minimumPitch: 50, pitchScale: 1.2 }),
          overhang: 0.3,
          endOverhang: 0.35,
          sweep: 0.2,
        }, { gableFrame: true });
        buildChimney(kit, { x: box3.x0 + 0.45, z: 0, width: 0.6, depth: 0.8, y0: eave - 0.4, y1: eave + roof.rise * 0.7 + 0.8, pots: 2 });
      });
    },
  });
}
