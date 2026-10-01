import { cylinder } from '../ProceduralWorkshopGeometry.js';
import { beamBetween } from '../village/HouseFacade.js';
import { clamp } from '../village/HouseDesign.js';
import { buildRoof } from '../village/HouseRoof.js';
import { barrel, ring } from './PropParts.js';

const COURSES = 3;
const COURSE_HEIGHT = 0.26;

/**
 * A roofed village well: a coursed stone drum with a coping, two posts carrying
 * a small tiled roof, and a windlass with rope and bucket. `width` sets the
 * drum's outer diameter.
 */
export function buildWell(kit, recipe) {
  const radius = clamp(recipe.width / 2, 0.6, 1.2);
  const wall = 0.3;
  const mid = radius - wall / 2;
  for (let course = 0; course < COURSES; course += 1) {
    const count = Math.max(8, Math.round(Math.PI * 2 * mid / 0.46));
    const offset = course % 2 === 0 ? 0 : 0.5;
    for (let index = 0; index < count; index += 1) {
      const angle = Math.PI * 2 * (index + offset) / count;
      kit.stone({
        width: Math.PI * 2 * mid / count * 0.95,
        height: COURSE_HEIGHT * 0.94,
        depth: wall,
        position: [Math.cos(angle) * mid, COURSE_HEIGHT * (course + 0.5) - 0.05, Math.sin(angle) * mid],
        rotation: [0, Math.PI / 2 - angle, 0],
      }, { heightRatio: course / COURSES });
    }
  }
  const top = COURSE_HEIGHT * COURSES - 0.05;
  kit.add('stone', kit.shade(ring({ inner: radius - wall - 0.02, outer: radius + 0.05, height: 0.1, position: [0, top + 0.05, 0] }), 'stone', 1));
  kit.add('recess', cylinder({ radius: radius - wall, height: 0.04, position: [0, top - 0.35, 0], sides: 20 }));

  const postX = radius + 0.08;
  const postTop = 2.25;
  for (const side of [-1, 1]) kit.add('wood', beamBetween([side * postX, 0, 0], [side * postX, postTop, 0], 0.14));
  const axleY = 1.45;
  kit.add('wood', cylinder({ radius: 0.07, height: postX * 2 + 0.1, position: [0, axleY, 0], rotation: [0, 0, Math.PI / 2], sides: 10 }));
  kit.add('metal', beamBetween([postX + 0.05, axleY, 0], [postX + 0.05, axleY - 0.28, 0], 0.03));
  kit.add('metal', beamBetween([postX + 0.05, axleY - 0.28, 0], [postX + 0.22, axleY - 0.28, 0], 0.03));
  kit.add('wood', beamBetween([0, axleY - 0.06, 0], [0, 0.95, 0], 0.018));
  barrel(kit, { x: 0, y: 0.62, z: 0, radius: 0.15, height: 0.3 });

  buildRoof(kit, {
    x0: -postX - 0.1,
    x1: postX + 0.1,
    z0: -radius * 0.55,
    z1: radius * 0.55,
    axis: 'x',
    wallTop: postTop,
    rise: radius * 0.55 * Math.tan(Math.max(35, recipe.roofPitch) * Math.PI / 180),
    overhang: 0.28,
    endOverhang: 0.2,
  }, { gableEnds: { start: 'boards', end: 'boards' }, tiles: false });
}
