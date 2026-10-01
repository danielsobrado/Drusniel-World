import { facadePoint } from '../HouseFacade.js';
import { buildRoof } from '../HouseRoof.js';
import { storeyRoot } from '../HouseStoreys.js';
import { buildBellcote } from '../HouseTradeDetails.js';
import { bays, clamp, design, OpeningNumbering, roofRise } from '../HouseDesign.js';

/**
 * A village chapel: a thick-walled stone nave, gable to the square, with an
 * arched door and a high window in the west front, tall lancets between
 * buttresses down each side, and a bellcote on the front gable.
 */
export function chapelDesign(recipe) {
  const width = clamp(recipe.width, 5, 9);
  const depth = clamp(recipe.depth, 8, 12);
  const eave = clamp(recipe.height, 4, 8);
  const thickness = 0.6;
  const box = { x0: -width / 2, x1: width / 2, z0: -depth / 2, z1: depth / 2 };
  const nave = { id: 'structure-main', label: 'Nave', wall: 'stone', ground: true, thickness, box: { ...box, y0: 0, y1: eave } };
  const lancet = { bottom: Math.min(1.4, eave * 0.25), width: 0.7, height: Math.min(2.4, eave * 0.5), arch: true };

  const numbering = new OpeningNumbering(recipe);
  numbering.door(nave, 'front', { centerX: 0, width: 1.4, height: Math.min(2.8, eave * 0.55), arch: true });
  numbering.add('structure-main', { centerX: 0, bottom: Math.min(eave - 1.8, eave * 0.62), width: 0.9, height: 1.3, arch: true, label: 'West window' });
  numbering.row(nave, 'left', { spacing: 2.6, margin: 1.0, ...lancet });
  numbering.row(nave, 'right', { spacing: 2.6, margin: 1.0, ...lancet });
  numbering.row(nave, 'back', { spacing: 9, ...lancet, width: 0.9 });

  return design({
    storeys: [nave],
    openings: numbering.openings,
    build(kit, { facades }) {
      kit.within(storeyRoot(nave), () => {
        const roof = buildRoof(kit, {
          ...box,
          axis: 'z',
          wallTop: eave,
          rise: roofRise(recipe, width / 2, { minimumPitch: 50, pitchScale: 1.2 }),
          overhang: 0.35,
          endOverhang: 0.2,
        });
        buildBellcote(kit, { x: 0, y: eave + roof.rise - 0.1, z: box.z1 + 0.05 });
      });
      // Buttresses between the lancets, stepping back as they rise.
      const tiers = [
        { bottom: -0.15, top: eave * 0.55, out: 0.55 },
        { bottom: eave * 0.55, top: eave * 0.85, out: 0.32 },
      ];
      kit.within(storeyRoot(nave), () => {
        for (const side of ['left', 'right']) {
          const facade = facades.get(nave.id)[side];
          const half = facade.length / 2;
          const lancets = bays(-half + 1.0, half - 1.0, 2.6);
          const between = lancets.slice(1).map((x, index) => (x + lancets[index]) / 2);
          for (const centerX of [-half + 0.3, ...between, half - 0.3]) {
            for (const { bottom, top, out } of tiers) {
              kit.stone({
                width: 0.5,
                height: top - bottom,
                depth: out,
                position: facadePoint(facade, half + centerX, (bottom + top) / 2, out / 2),
                rotation: [0, facade.yaw, 0],
              }, { category: 'ashlar', heightRatio: top / eave });
            }
          }
        }
      });
    },
  });
}
