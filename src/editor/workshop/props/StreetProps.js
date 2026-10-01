import * as THREE from 'three/webgpu';
import {
  applyWorkshopProjectedUv,
  beveledBox,
  normalizeGeometry,
  transformGeometry,
} from '../ProceduralWorkshopGeometry.js';
import { beamBetween } from '../village/HouseFacade.js';
import { clamp } from '../village/HouseDesign.js';

/** A plank bench on splayed trestles. `width` is its length. */
export function buildBench(kit, recipe) {
  const length = clamp(recipe.width, 1.2, 3);
  const seat = 0.46;
  kit.add('wood', beveledBox({ width: length, height: 0.07, depth: 0.34, position: [0, seat, 0], detail: 1, bevelRatio: 0.12 }));
  for (const side of [-1, 1]) {
    const x = side * (length / 2 - 0.22);
    for (const splay of [-1, 1]) {
      kit.add('wood', beamBetween([x, seat - 0.03, splay * 0.06], [x, 0, splay * 0.2], 0.07));
    }
    kit.add('wood', beamBetween([x, seat - 0.08, -0.16], [x, seat - 0.08, 0.16], 0.06));
  }
  kit.add('wood', beamBetween([-length / 2 + 0.22, 0.18, 0], [length / 2 - 0.22, 0.18, 0], 0.05));
}

function arrowBoard(length, height, thickness) {
  const shape = new THREE.Shape();
  const tip = height * 0.55;
  shape.moveTo(0, -height / 2);
  shape.lineTo(length - tip, -height / 2);
  shape.lineTo(length, 0);
  shape.lineTo(length - tip, height / 2);
  shape.lineTo(0, height / 2);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  geometry.translate(0.06, 0, -thickness / 2);
  return normalizeGeometry(geometry);
}

/** A fingerpost with arrow boards pointing different ways. `height` is the post height. */
export function buildSignpost(kit, recipe) {
  const height = clamp(recipe.height, 1.8, 3.5);
  kit.add('wood', beamBetween([0, -0.2, 0], [0, height, 0], 0.13));
  kit.add('wood', beveledBox({ width: 0.2, height: 0.1, depth: 0.2, position: [0, height + 0.02, 0], detail: 1, bevelRatio: 0.3 }));
  const boards = 2 + Math.floor(kit.random() * 2);
  for (let index = 0; index < boards; index += 1) {
    const y = height - 0.28 - index * 0.32;
    const yaw = (index % 2 === 0 ? 0 : Math.PI) + (kit.random() - 0.5) * 1.2;
    kit.add('wood', applyWorkshopProjectedUv(transformGeometry(
      arrowBoard(0.7 + kit.random() * 0.25, 0.2, 0.04),
      { position: [0, y, 0], rotation: [0, yaw, (kit.random() - 0.5) * 0.06] },
    )));
  }
}

/** A split-rail fence run along X. `width` is its length. */
export function buildFence(kit, recipe) {
  const length = clamp(recipe.width, 2, 12);
  const bays = Math.max(1, Math.round(length / 1.8));
  const step = length / bays;
  const posts = [];
  for (let index = 0; index <= bays; index += 1) {
    const x = -length / 2 + step * index;
    const top = 1.05 + (kit.random() - 0.5) * 0.12;
    posts.push([x, top]);
    kit.add('wood', beamBetween([x, -0.25, 0], [x + (kit.random() - 0.5) * 0.04, top, 0], 0.12));
  }
  for (let index = 1; index < posts.length; index += 1) {
    const [x0] = posts[index - 1];
    const [x1] = posts[index];
    for (const y of [0.45, 0.85]) {
      const sag = (kit.random() - 0.5) * 0.06;
      kit.add('wood', beamBetween([x0 - 0.05, y + sag, 0.08], [x1 + 0.05, y - sag, 0.08], 0.08, { depth: 0.1 }));
    }
  }
}
