import { buildChimney, buildDeck, buildStairs } from '../HouseDetails.js';
import { buildRoof } from '../HouseRoof.js';
import { storeyRoot } from '../HouseStoreys.js';
import { bays, clamp, design, OpeningNumbering, roofRise } from '../HouseDesign.js';

/**
 * Tavern on a plank deck (after grass-test house 009): a stone storey with
 * arched windows standing on a raised deck reached by timber stairs, a timber-
 * framed storey above, and a bell-swept roof whose ridge sags between its ends.
 */
export function deckTavernDesign(recipe) {
  const width = clamp(recipe.width, 6, 14);
  const depth = clamp(recipe.depth, 4.5, 9);
  const eave = clamp(recipe.height, 5.5, 12);
  const deck = clamp(eave * 0.15, 0.6, 1.6);
  const first = deck + clamp((eave - deck) * 0.5, 2.4, 4.2);
  const box = { x0: -width / 2, x1: width / 2, z0: -depth / 2, z1: depth / 2 };
  const upperBox = { x0: box.x0 - 0.1, x1: box.x1 + 0.1, z0: box.z0 - 0.1, z1: box.z1 + 0.1 };
  const stoneHeight = first - deck;
  const upperHeight = eave - first;

  const plinth = { id: 'structure-plinth', label: 'Cellar plinth', wall: 'stone', ground: true, quoins: false, thickness: 0.44, box: { ...box, y0: 0, y1: deck - 0.05 } };
  const stone = { id: 'structure-main', label: 'Stone storey', wall: 'stone', thickness: 0.44, box: { ...box, y0: deck - 0.05, y1: first } };
  const upper = {
    id: 'structure-upper', label: 'Timber storey', wall: 'plaster', roofed: true,
    box: { ...upperBox, y0: first + 0.11, y1: eave },
    plate: { overhang: 0.1, offset: -0.11 },
    frame: { spacing: 1.55, braces: 'diagonal', rails: [first + 1.2] },
    openings: { shutters: true },
  };

  const numbering = new OpeningNumbering(recipe);
  numbering.door(stone, 'front', { centerX: -width * 0.3, width: 1.0, height: 2.1 });
  const arch = { bottom: stoneHeight * 0.36, width: 0.8, height: 1.1, arch: true };
  for (const x of bays(-width * 0.12, width / 2 - 0.5, 2.1)) numbering.add('structure-main', { centerX: x, ...arch });
  numbering.row(stone, 'back', { spacing: 2.2, ...arch });
  numbering.door(stone, 'right', { centerX: 0, width: 1.0, height: 2.1 });
  numbering.row(stone, 'left', { spacing: depth / 2, ...arch });
  const timberWindow = { bottom: upperHeight * 0.3, width: 0.9, height: Math.min(1.0, upperHeight * 0.45) };
  for (const side of ['front', 'back']) numbering.row(upper, side, { spacing: 3.0, ...timberWindow });
  for (const side of ['left', 'right']) numbering.row(upper, side, { spacing: 9, ...timberWindow });

  return design({
    storeys: [plinth, stone, upper],
    openings: numbering.openings,
    build(kit, { resolved }) {
      kit.within(storeyRoot(stone), () => {
        buildDeck(kit, { x0: box.x0 - 0.6, x1: box.x1 + 1.2, z0: box.z0 - 0.9, z1: box.z1 + 1.3, y: deck });
        const steps = Math.max(3, Math.round(deck / 0.19));
        const door = resolved.get('structure-main').find((opening) => opening.door);
        const stairX = door?.centerX ?? -width * 0.3;
        buildStairs(kit, [stairX, 0, box.z1 + 1.3 + steps * 0.28], [stairX, deck, box.z1 + 1.3], { width: 1.1, steps, material: 'wood' });
      });
      kit.within(storeyRoot(upper), () => {
        const roof = buildRoof(kit, {
          ...upperBox,
          axis: 'x',
          wallTop: eave,
          rise: roofRise(recipe, depth / 2, { minimumPitch: 40 }),
          overhang: Math.max(0.5, recipe.roofOverhang),
          endOverhang: 0.4,
          sweep: 0.55,
          sag: 0.45,
        }, { gableFrame: true });
        buildChimney(kit, { x: width * 0.34, z: depth * 0.18, width: 0.9, depth: 0.9, y0: eave - 0.5, y1: eave + roof.rise + 0.5, pots: 0 });
      });
    },
  });
}
