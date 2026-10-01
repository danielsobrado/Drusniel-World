import * as THREE from 'three/webgpu';
import {
  applyWorkshopProjectedUv,
  beveledBox,
  normalizeGeometry,
} from '../ProceduralWorkshopGeometry.js';

const WIDTH = 0.9;
const DEPTH = 0.55;
const BODY = 0.42;
const LID_RISE = 0.2;

/** A half-round (barrel-vaulted) lid shell running along X. */
function curvedLid(width, depth, rise, thickness, outset = 0) {
  const shape = new THREE.Shape();
  const half = depth / 2 + outset;
  const outer = [];
  const inner = [];
  const steps = 10;
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const z = -half + 2 * half * t;
    const y = rise * Math.sin(Math.PI * t);
    outer.push([z, y + outset]);
    inner.push([z * (1 - thickness / half), y * (1 - thickness / Math.max(rise, 1e-3)) ]);
  }
  shape.moveTo(...outer[0]);
  for (const point of outer.slice(1)) shape.lineTo(...point);
  for (const point of inner.reverse()) shape.lineTo(...point);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  geometry.translate(0, 0, -width / 2);
  geometry.rotateY(Math.PI / 2);
  return normalizeGeometry(geometry);
}

/** An iron-bound chest with a vaulted lid, strapped and locked. */
export function buildChest(kit) {
  kit.add('wood', beveledBox({ width: WIDTH, height: BODY, depth: DEPTH, position: [0, BODY / 2, 0], detail: 1, bevelRatio: 0.05 }));
  kit.add('wood', applyWorkshopProjectedUv(curvedLid(WIDTH, DEPTH, LID_RISE, 0.05).translate(0, BODY, 0)));
  for (const x of [-WIDTH * 0.36, 0, WIDTH * 0.36]) {
    kit.add('metal', beveledBox({ width: 0.06, height: BODY + 0.01, depth: DEPTH + 0.02, position: [x, BODY / 2, 0], detail: 1 }));
    kit.add('metal', applyWorkshopProjectedUv(curvedLid(0.06, DEPTH, LID_RISE, 0.02, 0.012).translate(x, BODY, 0)));
  }
  for (const side of [-1, 1]) {
    for (const end of [-1, 1]) {
      kit.add('metal', beveledBox({ width: 0.08, height: 0.08, depth: 0.08, position: [side * (WIDTH / 2 - 0.02), 0.04, end * (DEPTH / 2 - 0.02)], detail: 1 }));
    }
  }
  kit.add('metal', beveledBox({ width: 0.14, height: 0.16, depth: 0.03, position: [0, BODY - 0.04, DEPTH / 2 + 0.02], detail: 1 }));
}
