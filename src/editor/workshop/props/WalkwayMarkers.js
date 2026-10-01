import { beveledBox, cylinder, leaf } from '../ProceduralWorkshopGeometry.js';
import { beamBetween } from '../village/HouseFacade.js';
import { clamp } from '../village/HouseDesign.js';
import { buildRoof } from '../village/HouseRoof.js';
import { bloomColor, lathe } from './PropParts.js';

const TOTEM_SEGMENT = 0.62;

/** One carved totem drum: a bulged, turned block with brow, eyes and a beak or mouth. */
function totemSegment(kit, y, radius, beak) {
  kit.add('wood', lathe([
    [radius * 0.92, 0], [radius, TOTEM_SEGMENT * 0.15], [radius * 1.04, TOTEM_SEGMENT * 0.5],
    [radius, TOTEM_SEGMENT * 0.85], [radius * 0.92, TOTEM_SEGMENT],
  ], { sides: 12, position: [0, y, 0] }));
  kit.add('wood', beveledBox({ width: radius * 1.5, height: 0.06, depth: 0.08, position: [0, y + TOTEM_SEGMENT * 0.72, radius * 0.98], detail: 1, bevelRatio: 0.3 }));
  for (const side of [-1, 1]) {
    kit.add('recess', beveledBox({ width: 0.09, height: 0.07, depth: 0.03, position: [side * radius * 0.38, y + TOTEM_SEGMENT * 0.6, radius * 1.0], detail: 1, bevelRatio: 0.3 }));
  }
  if (beak) {
    kit.add('wood', cylinder({ radius: 0.001, radiusTop: 0.001, radiusBottom: radius * 0.34, height: 0.24, position: [0, y + TOTEM_SEGMENT * 0.4, radius * 1.1], sides: 4, rotation: [Math.PI / 2, 0, 0] }));
  } else {
    kit.add('recess', beveledBox({ width: radius * 0.9, height: 0.06, depth: 0.03, position: [0, y + TOTEM_SEGMENT * 0.3, radius * 1.0], detail: 1, bevelRatio: 0.3 }));
  }
}

/**
 * A carved totem: stacked faces alternating beaked and mouthed, a pair of
 * spread wings partway up and a crowning bird. `height` sets how many drums.
 */
export function buildTotem(kit, recipe) {
  const height = clamp(recipe.height, 2, 6);
  const drums = Math.max(2, Math.floor((height - 0.6) / TOTEM_SEGMENT));
  const radius = 0.24;
  kit.stone({ width: 0.7, height: 0.2, depth: 0.7, position: [0, 0.04, 0] }, { category: 'ashlar', heightRatio: 0.05 });
  for (let index = 0; index < drums; index += 1) {
    totemSegment(kit, 0.14 + index * TOTEM_SEGMENT, radius * (1 - index * 0.03), index % 2 === 1);
  }
  const wingY = 0.14 + Math.min(drums - 1, 1) * TOTEM_SEGMENT + TOTEM_SEGMENT * 0.7;
  for (const side of [-1, 1]) {
    kit.add('wood', beveledBox({
      width: 0.62,
      height: 0.22,
      depth: 0.06,
      position: [side * (radius + 0.28), wingY, 0.02],
      rotation: [0, 0, side * 0.35],
      detail: 1,
      bevelRatio: 0.2,
    }));
  }
  const top = 0.14 + drums * TOTEM_SEGMENT;
  kit.add('wood', lathe([[radius * 0.8, 0], [radius * 0.7, 0.18], [radius * 0.35, 0.34], [0.001, 0.4]], { sides: 10, position: [0, top, 0] }));
  kit.add('wood', cylinder({ radius: 0.001, radiusTop: 0.001, radiusBottom: 0.06, height: 0.16, position: [0, top + 0.2, radius * 0.7], sides: 4, rotation: [Math.PI / 2, 0, 0] }));
  for (const side of [-1, 1]) {
    kit.add('wood', beveledBox({ width: 0.5, height: 0.05, depth: 0.2, position: [side * 0.3, top + 0.16, 0], rotation: [0, 0, side * -0.3], detail: 1, bevelRatio: 0.2 }));
  }
}

/**
 * An adoration post (wayside shrine): a stone shaft carrying a small roofed
 * niche with a gilded icon and a lit candle, and flowers laid at its foot.
 * `height` sets the shaft height; `topStyle` the little roof.
 */
export function buildWaysideShrine(kit, recipe) {
  const shaft = clamp(recipe.height, 1.4, 3) - 0.75;
  kit.stone({ width: 0.62, height: 0.24, depth: 0.62, position: [0, 0.06, 0] }, { category: 'ashlar', heightRatio: 0.05 });
  kit.stone({ width: 0.24, height: shaft, depth: 0.24, position: [0, 0.18 + shaft / 2, 0] }, { category: 'ashlar', heightRatio: 0.4 });
  const box = { x0: -0.26, x1: 0.26, z0: -0.2, z1: 0.2 };
  const base = 0.18 + shaft;
  const niche = 0.46;
  kit.add('wood', beveledBox({ width: 0.54, height: 0.06, depth: 0.42, position: [0, base + 0.03, 0], detail: 1 }));
  kit.add('wood', beveledBox({ width: 0.52, height: niche, depth: 0.04, position: [0, base + 0.06 + niche / 2, -0.18], detail: 1 }));
  for (const side of [-1, 1]) {
    kit.add('wood', beveledBox({ width: 0.04, height: niche, depth: 0.4, position: [side * 0.24, base + 0.06 + niche / 2, 0], detail: 1 }));
  }
  kit.add('metal', beveledBox({ width: 0.22, height: 0.28, depth: 0.02, position: [0, base + 0.08 + niche * 0.5, -0.15], detail: 1, bevelRatio: 0.2 }));
  kit.add('wood', cylinder({ radius: 0.025, height: 0.1, position: [0.12, base + 0.11, 0.06], sides: 8 }));
  kit.add('glow', cylinder({ radius: 0.001, radiusTop: 0.002, radiusBottom: 0.018, height: 0.05, position: [0.12, base + 0.19, 0.06], sides: 6 }));
  buildRoof(kit, {
    ...box,
    axis: 'x',
    wallTop: base + 0.06 + niche,
    rise: 0.22,
    overhang: 0.1,
    endOverhang: 0.06,
  }, { gableEnds: { start: 'boards', end: 'boards' }, tiles: false });
  for (let index = 0; index < 12; index += 1) {
    const angle = kit.random() * Math.PI * 2;
    const distance = 0.3 + kit.random() * 0.12;
    kit.add('foliage', leaf({
      radius: 0.06 + kit.random() * 0.03,
      position: [Math.cos(angle) * distance, 0.2 + kit.random() * 0.06, Math.sin(angle) * distance],
      rotation: [-1.2 + kit.random() * 0.4, angle, kit.random()],
      color: bloomColor([0.8 + kit.random() * 0.2, 0.25 + kit.random() * 0.5, 0.2 + kit.random() * 0.3]),
    }));
  }
}

/** A wayside cross on a two-step base. `height` is the cross's overall height. */
export function buildWaysideCross(kit, recipe) {
  const height = clamp(recipe.height, 1.6, 4);
  kit.stone({ width: 1.0, height: 0.2, depth: 1.0, position: [0, 0.04, 0] }, { category: 'ashlar', heightRatio: 0.02 });
  kit.stone({ width: 0.66, height: 0.2, depth: 0.66, position: [0, 0.24, 0] }, { category: 'ashlar', heightRatio: 0.08 });
  const shaft = height - 0.34;
  kit.stone({ width: 0.2, height: shaft, depth: 0.18, position: [0, 0.34 + shaft / 2, 0] }, { category: 'ashlar', heightRatio: 0.5 });
  kit.stone({ width: 0.78, height: 0.18, depth: 0.18, position: [0, 0.34 + shaft * 0.74, 0] }, { category: 'ashlar', heightRatio: 0.8 });
  kit.add('metal', beveledBox({ width: 0.16, height: 0.2, depth: 0.02, position: [0, 0.34 + shaft * 0.45, 0.1], detail: 1, bevelRatio: 0.2 }));
}

/** A round-headed milestone on a low footing, with a carved band. */
export function buildMilestone(kit) {
  kit.stone({ width: 0.6, height: 0.16, depth: 0.4, position: [0, 0.03, 0] }, { category: 'ashlar', heightRatio: 0.05 });
  kit.stone({ width: 0.42, height: 0.62, depth: 0.24, position: [0, 0.42, 0] }, { category: 'ashlar', heightRatio: 0.4 });
  kit.add('stone', kit.shade(cylinder({ radius: 0.21, height: 0.24, position: [0, 0.73, 0], rotation: [Math.PI / 2, 0, 0], sides: 16 }), 'stone', 0.9));
  kit.add('recess', beveledBox({ width: 0.3, height: 0.1, depth: 0.02, position: [0, 0.56, 0.12], detail: 1, bevelRatio: 0.3 }));
}

/** A cairn of stacked field stones, shrinking toward the top. */
export function buildCairn(kit) {
  let y = 0;
  const layers = 5 + Math.floor(kit.random() * 3);
  for (let layer = 0; layer < layers; layer += 1) {
    const size = 0.62 * (1 - layer / (layers + 1)) + 0.08;
    const height = size * (0.42 + kit.random() * 0.12);
    kit.stone({
      width: size * (1 + (kit.random() - 0.5) * 0.3),
      height,
      depth: size * (1 + (kit.random() - 0.5) * 0.3),
      position: [(kit.random() - 0.5) * 0.06, y + height / 2, (kit.random() - 0.5) * 0.06],
      rotation: [0, kit.random() * Math.PI, 0],
      bevelRatio: 0.3,
    }, { heightRatio: layer / layers });
    y += height * 0.94;
  }
  kit.add('wood', beamBetween([0, y - 0.1, 0], [0.03, y + 0.35, 0], 0.035));
}
