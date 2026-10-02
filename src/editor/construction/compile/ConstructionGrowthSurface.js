import { stoneJitter } from '../../workshop/ProceduralWorkshopIrregularity.js';
import { constructionStyle } from '../masonry/ConstructionStyleCatalog.js';
import { constructionStoneRoundingProfile } from '../config/ConstructionStoneRoundingProfiles.generated.js';
import { constructionRecipe } from './ConstructionStoneShape.js';

const CELL = 0.5;

/** Conservative face envelope from resolved placements, never rendered meshes.
 * Jitter is sampled only for stones touched by growth. Leaves span the highest
 * face in their footprint; stems sample their own points along the wall.
 */
export function createGrowthSurfaceSampler({ record, placements = [], arcTable }) {
  const style = constructionStyle(record.style.key);
  const recipe = constructionRecipe(record);
  const rounding = constructionStoneRoundingProfile(record.style.key);
  const buckets = new Map(); const bounds = new Map(); const faces = new Map();
  for (const stone of placements) {
    const corners = stone.corners ?? [[-stone.width / 2, -stone.height / 2], [stone.width / 2, stone.height / 2]];
    const box = [Math.min(...corners.map(p => p[0])) + stone.s, Math.max(...corners.map(p => p[0])) + stone.s,
      Math.min(...corners.map(p => p[1])) + stone.y, Math.max(...corners.map(p => p[1])) + stone.y];
    bounds.set(stone, box);
    for (let x = Math.floor(box[0] / CELL); x <= Math.floor(box[1] / CELL); x += 1) {
      for (let y = Math.floor(box[2] / CELL); y <= Math.floor(box[3] / CELL); y += 1) {
        const key = `${x}:${y}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(stone);
      }
    }
  }
  const faceFor = stone => {
    if (faces.has(stone)) return faces.get(stone);
    const frame = arcTable.frameAt(stone.s);
    const params = { width: stone.width, height: stone.height, depth: stone.depth,
      position: [frame.normalX * stone.offsetNormal, stone.y, frame.normalZ * stone.offsetNormal],
      rotation: [0, frame.yaw, stone.roll ?? 0] };
    const shaped = stoneJitter(recipe, params, stone.stableIndex, stone.category ?? 'field');
    const scale = style.geometry === 'rounded' ? rounding.protrusionScale : 1;
    const offset = stone.offsetNormal + scale * ((shaped.position[0] - params.position[0]) * frame.normalX
      + (shaped.position[2] - params.position[2]) * frame.normalZ);
    const reach = shaped.depth / 2 + Math.abs(Math.sin(shaped.rotation[0])) * shaped.height / 2
      + Math.abs(Math.sin(shaped.rotation[1] - frame.yaw)) * shaped.width / 2
      + (style.geometry === 'rounded' ? rounding.bulge.maximum : 0);
    const result = { offset, reach }; faces.set(stone, result); return result;
  };
  return (s, y, radius, side) => {
    let face = -Infinity;
    const visited = new Set();
    for (let x = Math.floor((s - radius) / CELL); x <= Math.floor((s + radius) / CELL); x += 1) {
      for (let row = Math.floor((y - radius) / CELL); row <= Math.floor((y + radius) / CELL); row += 1) {
        for (const stone of buckets.get(`${x}:${row}`) ?? []) {
          if (visited.has(stone)) continue;
          visited.add(stone);
          const box = bounds.get(stone);
          if (box[1] < s - radius || box[0] > s + radius || box[3] < y - radius || box[2] > y + radius) continue;
          const { offset, reach } = faceFor(stone);
          face = Math.max(face, side * offset + reach);
        }
      }
    }
    return Number.isFinite(face) ? face : record.dimensions.thickness / 2;
  };
}
