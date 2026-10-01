import { buildChimney } from '../HouseDetails.js';
import { buildDormer } from '../HouseDormer.js';
import { buildRoof } from '../HouseRoof.js';
import { joists, storeyRoot } from '../HouseStoreys.js';
import { clamp, design, OpeningNumbering, roofRise } from '../HouseDesign.js';

/**
 * Tall town house (after grass-test house 006): a stone undercroft, two timber
 * storeys each jettied further over the street, a front bay under a cross
 * gable, and a hipped bell roof with dormers and a slender stack.
 */
export function townhouseDesign(recipe) {
  const width = clamp(recipe.width, 7, 16);
  const depth = clamp(recipe.depth, 5, 10);
  const eave = clamp(recipe.height, 6.5, 14);
  const first = clamp(eave * 0.38, 2.6, 4.6);
  const second = first + (eave - first) / 2;
  const jetties = [0.35, 0.3];
  const base = { x0: -width / 2, x1: width / 2, z0: -depth / 2, z1: depth / 2 };
  const box2 = { x0: base.x0 - 0.15, x1: base.x1 + 0.15, z0: base.z0 - jetties[0], z1: base.z1 + jetties[0] };
  const box3 = { x0: box2.x0 - 0.12, x1: box2.x1 + 0.12, z0: box2.z0 - jetties[1], z1: box2.z1 + jetties[1] };
  const bayHalf = clamp(width * 0.16, 1.1, 2);
  const bayBox = { x0: -bayHalf, x1: bayHalf, z0: box3.z1 - 0.3, z1: box3.z1 + 0.9 };
  const clearOfBay = [[-bayHalf - 0.45, bayHalf + 0.45]];

  const timber = (id, label, box, y0, y1, braces, extra = {}) => ({
    id, label, wall: 'plaster', box: { ...box, y0: y0 + 0.11, y1 },
    plate: { overhang: 0.08, offset: -0.11 },
    frame: { spacing: 1.5, braces, rails: [y0 + (y1 - y0) * 0.36] },
    ...extra,
  });
  const undercroft = { id: 'structure-main', label: 'Undercroft', wall: 'stone', ground: true, box: { ...base, y0: 0, y1: first } };
  const floor2 = timber('structure-upper', 'First floor', box2, first, second, 'diagonal', { openings: { flowers: true } });
  const floor3 = timber('structure-top', 'Second floor', box3, second, eave, 'cross', { roofed: true });
  const bay = {
    id: 'structure-bay', label: 'Front bay', wall: 'plaster', roofed: true, skip: ['back'],
    box: { ...bayBox, y0: first + 0.11, y1: eave },
    plate: { overhang: 0.06, offset: -0.11 },
    frame: { spacing: 1.2, braces: 'none', rails: [second] },
  };

  const numbering = new OpeningNumbering(recipe);
  numbering.door(undercroft, 'front', { centerX: width * 0.26, width: 1.1, height: 2.2, arch: true });
  numbering.add('structure-main', { centerX: -width * 0.26, bottom: first * 0.4, width: 0.7, height: 1.0, arch: true });
  numbering.row(undercroft, 'back', { spacing: 3, bottom: first * 0.4, width: 0.6, height: 0.9, arch: true });
  numbering.row(undercroft, 'left', { spacing: 4, bottom: first * 0.4, width: 0.6, height: 0.9, arch: true });
  numbering.row(undercroft, 'right', { spacing: 4, bottom: first * 0.4, width: 0.6, height: 0.9, arch: true });
  for (const [storey, bottom, windowHeight] of [[floor2, 0.9, 1.0], [floor3, 0.8, 0.9]]) {
    numbering.row(storey, 'front', { spacing: 2.4, bottom, width: 0.72, height: windowHeight, avoid: clearOfBay });
    numbering.row(storey, 'back', { spacing: 2.8, bottom, width: 0.7, height: windowHeight });
    numbering.row(storey, 'left', { spacing: 2.8, bottom, width: 0.65, height: windowHeight });
    numbering.row(storey, 'right', { spacing: 2.8, bottom, width: 0.65, height: windowHeight });
  }
  const bayWindow = Math.min(1.4, bayHalf * 1.2);
  numbering.add('structure-bay', { centerX: 0, bottom: 0.8, width: bayWindow, height: 1.0 });
  numbering.add('structure-bay', { centerX: 0, bottom: second - first + 0.7, width: bayWindow, height: 1.0 });

  return design({
    storeys: [undercroft, floor2, floor3, bay],
    openings: numbering.openings,
    build(kit, { facades }) {
      kit.within(storeyRoot(undercroft), () => {
        const facade = facades.get(undercroft.id);
        for (const side of ['front', 'back']) joists(kit, facade[side], first - 0.14, { out: jetties[0] + 0.1, spacing: 0.75 });
      });
      kit.within(storeyRoot(floor2), () => {
        const facade = facades.get(floor2.id);
        for (const side of ['front', 'back']) joists(kit, facade[side], second - 0.14, { out: jetties[1] + 0.1, spacing: 0.75 });
      });
      kit.within(storeyRoot(floor3), () => {
        const roof = buildRoof(kit, {
          ...box3,
          axis: 'x',
          wallTop: eave,
          rise: roofRise(recipe, (box3.z1 - box3.z0) / 2, { minimumPitch: 45, pitchScale: 1.15 }),
          overhang: Math.max(0.4, recipe.roofOverhang),
          sweep: 0.5,
          hip: 0.55,
        });
        const dormerAt = (box3.x1 - box3.x0) * 0.3;
        for (const at of [-dormerAt, dormerAt]) buildDormer(kit, roof, { at, side: 1, width: 0.95, height: 0.85, reach: 0.7 });
        buildDormer(kit, roof, { at: -dormerAt * 0.5, side: -1, width: 0.95, height: 0.85, reach: 0.7 });
        buildChimney(kit, { x: -width * 0.18, z: 0, width: 0.6, depth: 0.6, y0: eave, y1: eave + roof.rise + 1.3, pots: 1 });
      });
      kit.within(storeyRoot(bay), () => {
        buildRoof(kit, {
          x0: bayBox.x0,
          x1: bayBox.x1,
          z0: box3.z1 - (box3.z1 - box3.z0) * 0.3,
          z1: bayBox.z1,
          axis: 'z',
          wallTop: eave,
          rise: roofRise(recipe, bayHalf, { minimumPitch: 45, pitchScale: 1.15 }),
          overhang: 0.35,
          endOverhang: 0.3,
          sweep: 0.5,
        }, { gableEnds: { start: null, end: 'plaster' }, gableFrame: true });
      });
    },
  });
}
