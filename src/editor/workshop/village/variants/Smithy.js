import { buildChimney, buildForge, buildLeanTo } from '../HouseDetails.js';
import { buildRoof } from '../HouseRoof.js';
import { storeyRoot } from '../HouseStoreys.js';
import { clamp, design, OpeningNumbering, roofRise } from '../HouseDesign.js';

const JETTY = 0.15;

/**
 * Smithy (after grass-test house 005): a long low stone cottage with a timber
 * upper band under a sagging, deep-verged roof, and an open lean-to forge shed
 * on posts behind it with a glowing hearth and an anvil.
 */
export function smithyDesign(recipe) {
  const width = clamp(recipe.width, 5, 14);
  const depth = clamp(recipe.depth, 3.6, 8);
  const eave = clamp(recipe.height, 3, 6);
  const floor = clamp(eave * 0.64, 2, 3.8);
  const box = { x0: -width / 2, x1: width / 2, z0: -depth / 2, z1: depth / 2 };
  const band = { x0: box.x0 - JETTY, x1: box.x1 + JETTY, z0: box.z0 - JETTY, z1: box.z1 + JETTY };
  const bandHeight = eave - floor;
  // Back-facade u runs +x → −x, so the forge at u = 0.62·width sits at
  // centerX = +0.12·width; the shed door and windows keep to the other end.
  const forgeBand = [width * 0.12 - 1.1, width * 0.12 + 2.2];

  const ground = { id: 'structure-main', label: 'Ground storey', wall: 'stone', ground: true, thickness: 0.44, box: { ...box, y0: 0, y1: floor } };
  const upper = {
    id: 'structure-upper', label: 'Upper band', wall: 'plaster', roofed: true, thickness: 0.2,
    box: { ...band, y0: floor + 0.12, y1: eave },
    plate: { overhang: 0.06, offset: -0.1 },
    frame: { spacing: 1.3, braces: 'none' },
    openings: { shutters: true },
  };

  const numbering = new OpeningNumbering(recipe);
  numbering.door(ground, 'front', { centerX: -width * 0.22, width: 1.0, height: 2.0 });
  numbering.add('structure-main', { centerX: width * 0.08, bottom: 1.0, width: 0.9, height: 0.5 });
  numbering.add('structure-main', { centerX: width * 0.32, bottom: 1.0, width: 0.9, height: 0.5 });
  numbering.door(ground, 'back', { centerX: -width * 0.25, width: 1.0, height: 2.0 });
  numbering.row(ground, 'left', { spacing: 9, bottom: 0.45, width: 0.9, height: 1.4, arch: true });
  numbering.row(ground, 'right', { spacing: 9, bottom: 0.45, width: 0.9, height: 1.4, arch: true });
  const bandWindow = { bottom: bandHeight * 0.25, width: 0.6, height: Math.min(0.5, bandHeight * 0.5) };
  numbering.row(upper, 'front', { spacing: width / 2 + 0.15, ...bandWindow });
  numbering.row(upper, 'back', { spacing: width / 2 + 0.15, ...bandWindow, avoid: [forgeBand] });
  numbering.row(upper, 'left', { spacing: 9, ...bandWindow });
  numbering.row(upper, 'right', { spacing: 9, ...bandWindow });

  return design({
    storeys: [ground, upper],
    openings: numbering.openings,
    build(kit, { facades }) {
      const back = facades.get(ground.id).back;
      const reach = clamp(depth * 0.7, 2.6, 4);
      kit.within(storeyRoot(ground), () => {
        buildLeanTo(kit, back, {
          u0: 0.2,
          u1: width - 0.2,
          reach,
          high: floor - 0.08,
          low: Math.max(2.1, floor - 0.7),
          posts: Math.max(3, Math.round(width / 3)),
        });
        buildForge(kit, back, width * 0.62, reach);
        buildChimney(kit, {
          // Behind the hearth, against the back wall.
          x: width / 2 - width * 0.62,
          z: box.z0 - 0.45,
          width: 0.85,
          depth: 0.85,
          y0: -0.2,
          y1: eave + roofRise(recipe, depth / 2 + JETTY) + 0.6,
          pots: 0,
        });
      });
      kit.within(storeyRoot(upper), () => {
        const roof = buildRoof(kit, {
          ...band,
          axis: 'x',
          wallTop: eave,
          rise: roofRise(recipe, depth / 2 + JETTY),
          overhang: recipe.roofOverhang,
          endOverhang: recipe.roofOverhang + 0.5,
          sag: 0.22,
        }, { gableFrame: true });
        buildChimney(kit, { x: -width * 0.3, z: 0, width: 0.8, depth: 0.7, y0: eave - 0.4, y1: eave + roof.rise + 0.7, pots: 2 });
      });
    },
  });
}
