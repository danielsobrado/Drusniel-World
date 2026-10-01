import { leaf } from '../ProceduralWorkshopGeometry.js';
import { beamBetween } from '../village/HouseFacade.js';
import { clamp } from '../village/HouseDesign.js';
import { bloomColor } from './PropParts.js';

const BLOOMS = Object.freeze([
  [0.85, 0.12, 0.16], [0.95, 0.72, 0.08], [0.42, 0.24, 0.88], [0.96, 0.92, 0.86], [0.9, 0.42, 0.62],
]);

/**
 * A dressed-stone planter trough heaped with flowers. `width` sets its length.
 */
export function buildPlanter(kit, recipe) {
  const length = clamp(recipe.width, 0.8, 4);
  const depth = 0.55;
  const height = 0.45;
  const wall = 0.1;
  for (const side of [-1, 1]) {
    kit.stone({ width: length, height, depth: wall, position: [0, height / 2, side * (depth / 2 - wall / 2)] }, { category: 'ashlar', heightRatio: 0.4 });
    kit.stone({ width: wall, height, depth: depth - wall * 2, position: [side * (length / 2 - wall / 2), height / 2, 0] }, { category: 'ashlar', heightRatio: 0.4 });
  }
  kit.stone({ width: length - wall * 2, height: 0.08, depth: depth - wall * 2, position: [0, height - 0.12, 0] }, { category: 'ashlar', heightRatio: 0.6 });
  const count = Math.round(length * 26);
  for (let index = 0; index < count; index += 1) {
    const x = (kit.random() - 0.5) * (length - wall * 2 - 0.08);
    const z = (kit.random() - 0.5) * (depth - wall * 2 - 0.08);
    const flower = kit.random() < 0.45;
    kit.add('foliage', leaf({
      radius: flower ? 0.05 + kit.random() * 0.03 : 0.07 + kit.random() * 0.05,
      position: [x, height - 0.04 + kit.random() * (flower ? 0.28 : 0.18), z],
      rotation: [(kit.random() - 0.5) * 1.6, kit.random() * Math.PI * 2, (kit.random() - 0.5) * 1.6],
      color: flower ? bloomColor(BLOOMS[Math.floor(kit.random() * BLOOMS.length)]) : [0.45, 0.75, 0.35],
    }));
  }
}

/** A run of dressed stone bollards joined by sagging iron chain. `width` sets the run length. */
export function buildBollards(kit, recipe) {
  const length = clamp(recipe.width, 1.5, 12);
  const bays = Math.max(1, Math.round(length / 1.5));
  const step = length / bays;
  const top = 0.72;
  for (let index = 0; index <= bays; index += 1) {
    const x = -length / 2 + step * index;
    kit.stone({ width: 0.22, height: top + 0.2, depth: 0.22, position: [x, (top - 0.2) / 2, 0] }, { category: 'ashlar', heightRatio: 0.5 });
    kit.stone({ width: 0.28, height: 0.08, depth: 0.28, position: [x, top + 0.04, 0] }, { category: 'coping', heightRatio: 0.9 });
    kit.add('metal', beamBetween([x, top - 0.08, -0.12], [x, top - 0.08, 0.12], 0.03));
  }
  const links = 8;
  for (let bay = 0; bay < bays; bay += 1) {
    const x0 = -length / 2 + step * bay;
    let previous = null;
    for (let link = 0; link <= links; link += 1) {
      const t = link / links;
      // A shallow catenary: the chain hangs lowest between the bollards.
      const point = [x0 + step * t, top - 0.1 - 0.22 * 4 * t * (1 - t), 0.12];
      if (previous) kit.add('metal', beamBetween(previous, point, 0.025, { depth: 0.012 }));
      previous = point;
    }
  }
}
