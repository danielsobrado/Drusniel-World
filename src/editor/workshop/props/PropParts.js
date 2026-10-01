import * as THREE from 'three/webgpu';
import {
  applyWorkshopProjectedUv,
  beveledBox,
  cylinder,
  normalizeGeometry,
  transformGeometry,
} from '../ProceduralWorkshopGeometry.js';
import { FOLIAGE_BASE_COLOR } from '../ProceduralWorkshopMaterials.js';
import { beamBetween } from '../village/HouseFacade.js';

/**
 * Parts shared by the village props. Every builder takes the shared build kit
 * (`HouseKit`) so props get the same material families, deterministic seeding
 * and structure tagging as the houses.
 */

/** A lathe-turned solid, the profile given as [radius, y] pairs from bottom to top. */
export function lathe(profile, { sides = 16, position = [0, 0, 0], rotation = [0, 0, 0] } = {}) {
  const points = profile.map(([radius, y]) => new THREE.Vector2(Math.max(0.001, radius), y));
  return applyWorkshopProjectedUv(transformGeometry(
    normalizeGeometry(new THREE.LatheGeometry(points, sides)),
    { position, rotation },
  ));
}

/** A flat ring (washer) lying in the XZ plane: hoops, well copings, wheel rims. */
export function ring({ inner, outer, height, position = [0, 0, 0], rotation = [0, 0, 0], sides = 24 }) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outer, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, inner, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: sides });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, -height / 2, 0);
  return applyWorkshopProjectedUv(transformGeometry(normalizeGeometry(geometry), { position, rotation }));
}

/**
 * A coopered barrel: bulged staves, iron hoops and a sunken head. `lying`
 * turns it on its side along X.
 */
export function barrel(kit, { x = 0, y = 0, z = 0, radius = 0.3, height = 0.8, lying = false, yaw = 0 }) {
  const bulge = radius;
  const end = radius * 0.84;
  const profile = [];
  const steps = 8;
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    profile.push([end + (bulge - end) * Math.sin(Math.PI * t), height * t]);
  }
  const rotation = lying ? [0, yaw, Math.PI / 2] : [0, yaw, 0];
  const origin = new THREE.Vector3(x, y + (lying ? radius : 0), z);
  // Lathe profiles grow from y = 0; centre them so a lying barrel pivots about its middle.
  const centred = (geometry) => geometry.translate(0, -height / 2, 0);
  const place = (geometry) => transformGeometry(geometry, {
    position: [origin.x, origin.y + (lying ? 0 : height / 2), origin.z],
    rotation,
  });
  kit.add('wood', place(centred(lathe([[0.001, 0], ...profile, [0.001, height]], { sides: 18 }))));
  for (const t of [0.1, 0.34, 0.66, 0.9]) {
    const hoopRadius = end + (bulge - end) * Math.sin(Math.PI * t) + 0.008;
    kit.add('metal', place(ring({ inner: hoopRadius - 0.012, outer: hoopRadius + 0.006, height: 0.04, position: [0, height * t - height / 2, 0] })));
  }
}

/** A plank crate: a box with proud corner posts and rims. */
export function crate(kit, { x = 0, y = 0, z = 0, size = 0.6, height = size, yaw = 0 }) {
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
    new THREE.Vector3(1, 1, 1),
  );
  const add = (geometry) => kit.add('wood', geometry?.applyMatrix4(matrix));
  add(beveledBox({ width: size - 0.04, height: height - 0.04, depth: size - 0.04, position: [0, height / 2, 0], detail: 1, bevelRatio: 0.03 }));
  const h = size / 2 - 0.02;
  const post = 0.06;
  for (const [cx, cz] of [[-h, -h], [h, -h], [h, h], [-h, h]]) {
    add(beamBetween([cx, 0, cz], [cx, height, cz], post));
  }
  for (const level of [post / 2, height - post / 2]) {
    add(beamBetween([-h, level, h], [h, level, h], post * 0.8));
    add(beamBetween([-h, level, -h], [h, level, -h], post * 0.8));
    add(beamBetween([h, level, -h], [h, level, h], post * 0.8));
    add(beamBetween([-h, level, -h], [-h, level, h], post * 0.8));
  }
}

/**
 * A four-sided hanging lantern whose top ring sits at `top`. The glazing is the
 * emissive `glow` family, so a street reads lit at dusk without a light per
 * placement.
 */
export function lantern(kit, { x = 0, top = 1, z = 0, size = 0.26, height = 0.4 }) {
  const half = size / 2;
  const bodyTop = top - 0.08;
  const bodyBottom = bodyTop - height;
  kit.add('metal', ring({ inner: 0.025, outer: 0.045, height: 0.02, position: [x, top - 0.03, z], rotation: [Math.PI / 2, 0, 0], sides: 10 }));
  kit.add('metal', cylinder({ radius: 0.001, radiusTop: 0.03, radiusBottom: half * 1.45, height: 0.1, position: [x, bodyTop + 0.02, z], sides: 4, rotation: [0, Math.PI / 4, 0] }));
  kit.add('glow', beveledBox({ width: size * 0.84, height: height * 0.86, depth: size * 0.84, position: [x, (bodyTop + bodyBottom) / 2, z], detail: 1, bevelRatio: 0.05 }));
  for (const [cx, cz] of [[-half, -half], [half, -half], [half, half], [-half, half]]) {
    kit.add('metal', beamBetween([x + cx, bodyBottom, z + cz], [x + cx, bodyTop, z + cz], 0.025));
  }
  for (const level of [bodyBottom, bodyTop - 0.01]) {
    kit.add('metal', beveledBox({ width: size + 0.03, height: 0.03, depth: size + 0.03, position: [x, level, z], detail: 1, bevelRatio: 0.1 }));
  }
  kit.add('metal', cylinder({ radius: half * 0.7, radiusTop: half * 0.9, radiusBottom: half * 0.4, height: 0.05, position: [x, bodyBottom - 0.035, z], sides: 4, rotation: [0, Math.PI / 4, 0] }));
}

/** A spoked cart wheel standing in the YZ plane, centred at (x, radius, z). */
export function wheel(kit, { x, z, radius = 0.55, width = 0.09, spokes = 8 }) {
  const centre = [x, radius, z];
  kit.add('wood', ring({ inner: radius - 0.07, outer: radius, height: width, position: centre, rotation: [0, 0, Math.PI / 2], sides: 28 }));
  kit.add('metal', ring({ inner: radius - 0.005, outer: radius + 0.015, height: width * 0.8, position: centre, rotation: [0, 0, Math.PI / 2], sides: 28 }));
  kit.add('wood', cylinder({ radius: 0.09, height: width * 2, position: centre, rotation: [0, 0, Math.PI / 2], sides: 12 }));
  for (let index = 0; index < spokes; index += 1) {
    const angle = Math.PI * 2 * index / spokes;
    kit.add('wood', beamBetween(
      [x, radius + Math.sin(angle) * 0.08, z + Math.cos(angle) * 0.08],
      [x, radius + Math.sin(angle) * (radius - 0.06), z + Math.cos(angle) * (radius - 0.06)],
      0.045,
    ));
  }
}

const FOLIAGE_BASE = new THREE.Color(FOLIAGE_BASE_COLOR);

/**
 * Vertex colour that renders as `rgb` (linear) under the foliage material.
 * That material's green base multiplies every leaf's vertex colour, which is
 * right for ivy but turns every blossom green; dividing it out lets a flower
 * keep its own hue while sharing the family's single draw part.
 */
export function bloomColor([r, g, b]) {
  return [r / FOLIAGE_BASE.r, g / FOLIAGE_BASE.g, b / FOLIAGE_BASE.b];
}
