import * as THREE from 'three/webgpu';
import { beveledBox } from '../ProceduralWorkshopGeometry.js';

/**
 * A planar wall face and its local frame.
 *
 * Facade space is (u, y, d): `u` runs along the wall from `origin` in the
 * direction a viewer standing outside would call left-to-right, `y` is world
 * height and `d` is the distance out of the face (negative is inside the wall).
 * Every house detail — timber framing, windows, doors, signs — is authored in
 * this space and placed with `facadeMatrix`, so one routine serves all four
 * sides of any rectangular volume.
 */
export function createFacade({ origin, direction, length, y0, y1, thickness, side }) {
  const yaw = Math.atan2(-direction[1], direction[0]);
  return Object.freeze({
    origin: Object.freeze([...origin]),
    direction: Object.freeze([...direction]),
    normal: Object.freeze([Math.sin(yaw), Math.cos(yaw)]),
    yaw,
    length,
    y0,
    y1,
    thickness,
    side,
  });
}

/**
 * The four outer faces of an axis-aligned box, keyed front (+z), back (-z),
 * right (+x) and left (-x).
 */
export function boxFacades({ x0, x1, z0, z1, y0, y1, thickness = 0.3 }) {
  const width = x1 - x0;
  const depth = z1 - z0;
  return Object.freeze({
    front: createFacade({ origin: [x0, z1], direction: [1, 0], length: width, y0, y1, thickness, side: 'front' }),
    back: createFacade({ origin: [x1, z0], direction: [-1, 0], length: width, y0, y1, thickness, side: 'back' }),
    right: createFacade({ origin: [x1, z1], direction: [0, -1], length: depth, y0, y1, thickness, side: 'right' }),
    left: createFacade({ origin: [x0, z0], direction: [0, 1], length: depth, y0, y1, thickness, side: 'left' }),
  });
}

/** A free-standing facade, for gable ends and dormer fronts. */
export function facadeAt(origin, normal, length, y0 = 0, y1 = 0, thickness = 0.2) {
  // The along-direction is the outward normal turned a quarter clockwise.
  return createFacade({
    origin,
    direction: [normal[1], -normal[0]],
    length,
    y0,
    y1,
    thickness,
    side: 'free',
  });
}

/** A free-standing facade of `length`, centred on the world point (x, z). */
export function centredFacade([x, z], normal, length, y0 = 0, y1 = 0, thickness = 0.2) {
  const direction = [normal[1], -normal[0]];
  return facadeAt(
    [x - direction[0] * length / 2, z - direction[1] * length / 2],
    normal,
    length,
    y0,
    y1,
    thickness,
  );
}

export function facadeMatrix(facade) {
  return new THREE.Matrix4()
    .makeTranslation(facade.origin[0], 0, facade.origin[1])
    .multiply(new THREE.Matrix4().makeRotationY(facade.yaw));
}

/** World position of a facade-space point. */
export function facadePoint(facade, u, y, d = 0) {
  return [
    facade.origin[0] + facade.direction[0] * u + facade.normal[0] * d,
    y,
    facade.origin[1] + facade.direction[1] * u + facade.normal[1] * d,
  ];
}

/** Move geometry authored in facade space into the world. */
export function placeOnFacade(geometry, facade) {
  geometry.applyMatrix4(facadeMatrix(facade));
  return geometry;
}

const UP = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);

/**
 * A squared timber (or stone lintel) between two world points.
 *
 * The long axis runs `a` → `b`. `side` is the direction the beam's width faces;
 * it defaults to horizontal-perpendicular, which keeps posts, rails and braces
 * flat against the facade they are framing.
 */
export function beamBetween(a, b, size, { depth = size, side = null, bevelRatio = 0.12, detail = 2 } = {}) {
  const start = new THREE.Vector3(...a);
  const end = new THREE.Vector3(...b);
  const axis = end.clone().sub(start);
  const length = axis.length();
  if (length < 1e-4) return null;
  axis.normalize();
  const orthogonal = (candidate) => candidate.addScaledVector(axis, -candidate.dot(axis));
  // Fall back when the requested side runs along the beam (a joist projecting
  // along the facade normal), then when the beam is vertical.
  let widthAxis = orthogonal(side ? new THREE.Vector3(...side) : new THREE.Vector3());
  if (widthAxis.lengthSq() < 1e-6) widthAxis = orthogonal(new THREE.Vector3().crossVectors(UP, axis));
  if (widthAxis.lengthSq() < 1e-6) widthAxis = orthogonal(X_AXIS.clone());
  widthAxis.normalize();
  const depthAxis = new THREE.Vector3().crossVectors(widthAxis, axis).normalize();
  // beveledBox is width (x) × height (y) × depth (z): y is the long axis.
  const rotation = new THREE.Euler().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(widthAxis, axis, depthAxis),
  );
  const center = start.add(end).multiplyScalar(0.5);
  return beveledBox({
    width: size,
    height: length,
    depth,
    position: center.toArray(),
    rotation: [rotation.x, rotation.y, rotation.z],
    detail,
    bevelRatio,
  });
}

/**
 * A timber between two facade-space points, already placed in the world.
 *
 * `size` is the face width a viewer sees in the wall plane; `proud` is how far
 * the member stands out of it, measured along the facade normal.
 */
export function facadeBeam(facade, [u0, y0, d0], [u1, y1, d1], size, { proud = size * 0.7, ...options } = {}) {
  const [nx, nz] = facade.normal;
  return beamBetween(
    facadePoint(facade, u0, y0, d0),
    facadePoint(facade, u1, y1, d1),
    proud,
    { ...options, depth: size, side: [nx, 0, nz] },
  );
}
