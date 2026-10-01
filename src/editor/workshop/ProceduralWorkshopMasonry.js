import { beveledBox } from './ProceduralWorkshopGeometry.js';
import { packCourse } from './ProceduralWorkshopCoursePacker.js';
import { stoneJitter } from './ProceduralWorkshopIrregularity.js';
import { applyUnitShading } from './ProceduralWorkshopMaterials.js';
import { createRandom, mixSeed } from './ProceduralRandom.js';

/**
 * Shared coursed-masonry primitives.
 *
 * Every workshop archetype that lays field stone — castle walls, towers, the
 * manor plinth and the village houses' stone storeys — goes through these, so
 * per-unit shaping stays inside the course band the packer assigned and
 * structural dressings keep their reduced jitter (04-…md §6, §8, §19).
 */

/** Smallest field stone a packed course may emit, before mortar inset. */
export const MIN_COURSE_STONE_WIDTH = 0.28;

export function openingHalfWidth(opening, y) {
  const localY = y - opening.bottom;
  if (localY < 0 || localY > opening.springHeight + opening.radius) return 0;
  if (opening.rectangular) return opening.width / 2;
  if (localY <= opening.springHeight) return opening.width / 2;
  const archY = localY - opening.springHeight;
  return Math.sqrt(Math.max(0, opening.radius ** 2 - archY ** 2));
}

export function isInsideOpening(opening, x, y, stoneHalfWidth = 0) {
  const halfWidth = openingHalfWidth(opening, y);
  return halfWidth > 0 && Math.abs(x - opening.centerX) < halfWidth + stoneHalfWidth * 0.35;
}

/** Returns the shaped parameters so callers can record surface relief. */
export function addStone(target, recipe, params, stableIndex, heightRatio, category = 'field') {
  const shaped = stoneJitter(recipe, params, stableIndex, category);
  target.push(applyUnitShading(
    beveledBox({ ...params, ...shaped, detail: recipe.detail }),
    recipe,
    {
      stableIndex,
      heightRatio,
      protrusion: shaped.protrusion,
      depth: shaped.depth,
    },
  ));
  return shaped;
}

/**
 * Lay packed field-stone courses along one planar wall.
 *
 * The wall runs along its local X, centred on (`centerX`, `centerZ`) and turned
 * by `yaw`; courses start at y = 0. `openings` are in the same along-wall
 * coordinate, and stones whose centre falls inside one are omitted so the
 * opening is a real void rather than a panel over solid masonry.
 */
export function buildWallCourses(recipe, {
  width = recipe.width,
  depth = recipe.depth,
  height = recipe.height,
  centerX = 0,
  centerZ = 0,
  openings = [],
  seedOffset = 0,
  yaw = 0,
  relief = null,
} = {}) {
  const random = createRandom(mixSeed(recipe.seed, seedOffset));
  const geometries = [];
  const courseHeight = 0.5 - recipe.detail * 0.045;
  const courses = Math.max(2, Math.ceil(height / courseHeight));
  const actualCourseHeight = height / courses;
  const targetStoneWidth = 0.94 - recipe.detail * 0.08;
  let stableIndex = seedOffset * 10000;

  // Joints of the course below, so this course can break bond against them
  // (04-…md §5) instead of faking a running bond by shrinking one stone.
  let previousJoints = [];

  for (let course = 0; course < courses; course += 1) {
    const y = (course + 0.5) * actualCourseHeight;
    const { stones, joints } = packCourse({
      span: width,
      targetWidth: targetStoneWidth,
      minWidth: MIN_COURSE_STONE_WIDTH,
      random,
      forbiddenJoints: previousJoints,
    });
    previousJoints = joints;

    if (stones.length > 256) {
      throw new Error('Workshop stone packing exceeded its safety budget.');
    }

    for (const stone of stones) {
      const insideOpening = openings.some((opening) => (
        isInsideOpening(opening, stone.center, y, stone.width / 2)
      ));
      if (!insideOpening) {
        const inset = 0.014 + random() * 0.016;
        const shaped = addStone(geometries, recipe, {
          width: Math.max(0.12, stone.width - inset),
          height: Math.max(0.12, actualCourseHeight - inset * 0.72),
          depth: depth * (0.96 + random() * 0.025),
          position: [
            centerX + Math.cos(yaw) * stone.center,
            y + (random() - 0.5) * 0.028,
            centerZ - Math.sin(yaw) * stone.center,
          ],
          rotation: [0, yaw + (random() - 0.5) * 0.012, 0],
        }, stableIndex, y / height);
        // Facade space on a planar wall is simply the along-wall coordinate.
        relief?.record(stone.center, y, shaped.protrusion);
      }
      stableIndex += 1;
    }
  }
  return geometries;
}
