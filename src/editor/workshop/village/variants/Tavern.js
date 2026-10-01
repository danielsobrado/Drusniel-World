import { buildChimney, buildHangingSign } from '../HouseDetails.js';
import { buildDormer } from '../HouseDormer.js';
import { buildRoof } from '../HouseRoof.js';
import { joists, storeyRoot } from '../HouseStoreys.js';
import { clamp, design, OpeningNumbering, roofRise } from '../HouseDesign.js';

const JETTY = 0.3;

/**
 * Tavern (after grass-test house 004): a tall stone ground floor, a jettied
 * timber band on joist ends, and a steep bell-swept roof that comes down to the
 * band, with dormers, a stack through the back slope and a hanging sign.
 */
export function tavernDesign(recipe) {
  const width = clamp(recipe.width, 5, 14);
  const depth = clamp(recipe.depth, 4, 10);
  const eave = clamp(recipe.height, 3.2, 7);
  const floor = clamp(eave * 0.64, 2.2, 4.2);
  const box = { x0: -width / 2, x1: width / 2, z0: -depth / 2, z1: depth / 2 };
  const band = { x0: box.x0 - JETTY, x1: box.x1 + JETTY, z0: box.z0 - JETTY, z1: box.z1 + JETTY };
  const bandHeight = eave - floor;

  const ground = { id: 'structure-main', label: 'Ground storey', wall: 'stone', ground: true, thickness: 0.44, box: { ...box, y0: 0, y1: floor } };
  const upper = {
    id: 'structure-upper', label: 'Jettied band', wall: 'plaster', roofed: true, thickness: 0.2,
    box: { ...band, y0: floor + 0.12, y1: eave },
    plate: { overhang: 0.08, offset: -0.1 },
    frame: { spacing: 1.45, braces: 'cross', left: { spacing: 1.35, braces: 'none' }, right: { spacing: 1.35, braces: 'none' } },
    openings: { flowers: true },
  };

  const numbering = new OpeningNumbering(recipe);
  numbering.door(ground, 'front', { centerX: 0, width: 1.3, height: 2.1 });
  for (const side of [-1, 1]) numbering.add('structure-main', { centerX: side * width * 0.3, bottom: 1.0, width: 0.8, height: 0.7 });
  numbering.row(ground, 'back', { spacing: 2.5, bottom: 1.0, width: 0.7, height: 0.6 });
  numbering.row(ground, 'left', { spacing: depth / 2, bottom: 1.0, width: 0.7, height: 0.6 });
  numbering.row(ground, 'right', { spacing: depth / 2, bottom: 1.0, width: 0.7, height: 0.6 });
  const bandWindow = { bottom: bandHeight * 0.22, width: 0.9, height: Math.min(0.8, bandHeight * 0.55) };
  numbering.row(upper, 'front', { spacing: width / 2 + 0.3, ...bandWindow });
  numbering.row(upper, 'back', { spacing: width / 2 + 0.3, ...bandWindow });
  numbering.row(upper, 'left', { spacing: 9, ...bandWindow, width: 0.7 });
  numbering.row(upper, 'right', { spacing: 9, ...bandWindow, width: 0.7 });

  return design({
    storeys: [ground, upper],
    openings: numbering.openings,
    build(kit, { facades }) {
      const groundFacades = facades.get(ground.id);
      kit.within(storeyRoot(ground), () => {
        for (const facade of Object.values(groundFacades)) joists(kit, facade, floor - 0.14, { out: JETTY + 0.1, spacing: 0.95 });
        buildHangingSign(kit, groundFacades.front, groundFacades.front.length - 0.45, floor - 0.3, { out: 1.05 });
      });
      kit.within(storeyRoot(upper), () => {
        const roof = buildRoof(kit, {
          ...band,
          axis: 'x',
          wallTop: eave,
          rise: roofRise(recipe, depth / 2 + JETTY, { minimumPitch: 50, pitchScale: 1.25 }),
          overhang: Math.max(0.45, recipe.roofOverhang),
          endOverhang: Math.max(0.5, recipe.roofOverhang),
          sweep: 0.55,
          sag: 0.12,
        }, { gableFrame: true });
        if (width >= 6) {
          for (const ratio of [-0.28, 0.28]) buildDormer(kit, roof, { at: ratio * width, side: 1, width: 1.0, height: 0.95, reach: 0.72 });
        }
        buildChimney(kit, { x: width * 0.3, z: -depth * 0.2, width: 0.8, depth: 0.8, y0: floor, y1: eave + roof.rise + 0.7, pots: 0 });
      });
    },
  });
}
