import { buildChimney, buildStairs } from '../HouseDetails.js';
import { buildDormer } from '../HouseDormer.js';
import { buildRoof } from '../HouseRoof.js';
import { storeyRoot } from '../HouseStoreys.js';
import { clamp, design, OpeningNumbering, roofRise } from '../HouseDesign.js';

/**
 * L-shaped cottage (after grass-test house 003): a stone ground floor under a
 * plastered, timber-framed upper storey; a front wing with its own cross roof;
 * an outside stair in the L up to the wing's first-floor door; dormers on the
 * main front slope and a stack on the far gable.
 */
export function cottageDesign(recipe) {
  const width = clamp(recipe.width, 6, 16);
  const depth = clamp(recipe.depth, 4, 9);
  const eave = clamp(recipe.height, 4, 8);
  const floor = clamp(eave * 0.42, 1.9, 2.8);
  const wingWidth = clamp(width * 0.36, 2.6, 4.2);
  const wingDepth = clamp(depth * 0.55, 2, 4);
  const main = { x0: -width / 2, x1: width / 2, z0: -depth / 2, z1: depth / 2 };
  const wing = { x0: main.x0, x1: main.x0 + wingWidth, z0: main.z1, z1: main.z1 + wingDepth };
  const exposedStart = wing.x1 + 0.35;
  // The front door and window keep clear of the stair landing in the L.
  const doorX = Math.min(main.x1 - 0.8, Math.max(width * 0.14, wing.x1 + 1.75));
  const windowX = Math.min(main.x1 - 0.6, Math.max(width * 0.36, doorX + 1.4));
  const chimneyZ = depth * 0.18;
  // Right-facade u runs +z → −z, so the stack at z = chimneyZ is at centerX = −chimneyZ.
  const chimneyBand = [-chimneyZ - 0.65, -chimneyZ + 0.65];

  const ground = { id: 'structure-main', label: 'Ground storey', wall: 'stone', ground: true, box: { ...main, y0: 0, y1: floor } };
  const upper = {
    id: 'structure-upper', label: 'Upper storey', wall: 'plaster', roofed: true,
    box: { ...main, y0: floor, y1: eave },
    plate: { overhang: 0.06 },
    frame: { spacing: 2.6, braces: 'none', back: { spacing: 1.3, braces: 'cross' }, right: { spacing: 2.4, braces: 'diagonal' } },
    openings: { shutters: true, flowers: true },
  };
  const wingGround = { id: 'structure-wing', label: 'Front wing', wall: 'stone', ground: true, skip: ['back'], box: { ...wing, y0: 0, y1: floor } };
  const wingUpper = {
    id: 'structure-wing-upper', label: 'Wing upper storey', wall: 'plaster', roofed: true, skip: ['back'],
    box: { ...wing, y0: floor, y1: eave },
    plate: { overhang: 0.06 },
    frame: { spacing: 2.8, braces: 'none', left: { braces: 'diagonal' } },
    openings: { shutters: true, flowers: true },
  };

  const numbering = new OpeningNumbering(recipe);
  numbering.door(ground, 'front', { centerX: doorX, width: 1.0, height: 2.0, arch: true });
  numbering.add('structure-main', { centerX: windowX, bottom: 0.8, width: 0.8, height: 0.95, arch: true });
  numbering.row(ground, 'back', { spacing: 3.2, bottom: 0.9, width: 0.7, height: 0.8, arch: true });
  numbering.row(ground, 'left', { spacing: 9, bottom: 0.9, width: 0.7, height: 0.8, arch: true });
  numbering.row(ground, 'right', { spacing: 9, bottom: 0.9, width: 0.6, height: 0.7, arch: true, avoid: [chimneyBand] });
  // The wing hides the front of the upper storey from x0 to its own far wall.
  numbering.row(upper, 'front', { spacing: 2.3, bottom: 0.7, width: 0.9, height: 1.0, avoid: [[main.x0, exposedStart - 0.2]] });
  numbering.row(upper, 'back', { spacing: 2.8, bottom: 0.7, width: 0.9, height: 1.0 });
  numbering.row(upper, 'right', { spacing: 9, bottom: 0.9, width: 0.7, height: 0.8, avoid: [chimneyBand] });
  numbering.row(upper, 'left', { spacing: 9, bottom: 0.9, width: 0.7, height: 0.8 });
  numbering.row(wingGround, 'front', { spacing: 9, bottom: 0.8, width: 0.7, height: 0.85, arch: true });
  numbering.row(wingGround, 'left', { spacing: 9, bottom: 0.8, width: 0.6, height: 0.7, arch: true });
  numbering.row(wingUpper, 'front', { spacing: 9, bottom: 0.6, width: 1.2, height: 1.0 });
  numbering.row(wingUpper, 'left', { spacing: 9, bottom: 0.7, width: 0.8, height: 0.9 });
  // Right-facade u runs +z → −z: the stair door near the main range is at +centerX.
  numbering.door(wingUpper, 'right', { centerX: wingDepth / 2 - 0.75, bottom: 0.02, width: 0.9, height: 1.9 });

  return design({
    storeys: [ground, upper, wingGround, wingUpper],
    openings: numbering.openings,
    build(kit) {
      kit.within(storeyRoot(upper), () => {
        const roof = buildRoof(kit, {
          ...main,
          axis: 'x',
          wallTop: eave,
          rise: roofRise(recipe, depth / 2),
          overhang: recipe.roofOverhang,
          sweep: 0.25,
        }, { gableFrame: true });
        const dormerSpan = main.x1 - exposedStart;
        if (dormerSpan > 2.4) {
          for (const at of dormerSpan > 5 ? [0.28, 0.74] : [0.5]) {
            buildDormer(kit, roof, { at: exposedStart + dormerSpan * at, side: 1, width: 0.95, height: 0.85 });
          }
        }
        buildChimney(kit, { x: main.x1 + 0.42, z: chimneyZ, width: 0.78, depth: 0.9, y0: -0.2, y1: eave + roof.rise + 0.9, pots: 3 });
      });
      kit.within(storeyRoot(wingUpper), () => {
        buildRoof(kit, {
          x0: wing.x0,
          x1: wing.x1,
          z0: main.z1 - depth * 0.3,
          z1: wing.z1,
          axis: 'z',
          wallTop: eave,
          rise: roofRise(recipe, wingWidth / 2) * 0.95,
          overhang: recipe.roofOverhang,
          sweep: 0.25,
        }, { gableEnds: { start: null, end: 'plaster' }, gableFrame: true });
      });
      if (!recipe.windows) return;
      kit.within(storeyRoot(wingGround), () => {
        const steps = Math.max(6, Math.round(floor / 0.2));
        const run = steps * 0.28;
        const x = wing.x1 + 0.62;
        buildStairs(kit, [x, 0, main.z1 + 1.35 + run], [x, floor, main.z1 + 1.35], { width: 1.05, steps });
        // Landing in front of the wing's first-floor door.
        kit.stone({ width: 1.05, height: floor + 0.3, depth: 1.15, position: [x, (floor - 0.3) / 2, main.z1 + 0.78] }, { category: 'ashlar', heightRatio: 0.5 });
      });
    },
  });
}
