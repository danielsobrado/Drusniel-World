import * as THREE from 'three/webgpu';
import { archedPanel, beveledBox, leaf } from '../ProceduralWorkshopGeometry.js';
import { tagOpeningGeometry } from '../ProceduralWorkshopSemantics.js';
import { facadeBeam, facadeMatrix, facadePoint } from './HouseFacade.js';

const FRAME = 0.09;
const FRAME_PROUD = 0.07;
const STONE_DRESSING_DEPTH = 0.3;

/** Facade-space geometry of a resolved opening. */
function frameOf(facade, opening) {
  const u = facade.length / 2 + opening.centerX;
  const bottom = facade.y0 + opening.bottom;
  const arched = !opening.rectangular && opening.radius > 0.05;
  const height = opening.springHeight + opening.radius;
  return {
    u,
    bottom,
    width: opening.width,
    height,
    arched,
    springY: bottom + (arched ? opening.springHeight : height),
    radius: arched ? opening.width / 2 : 0,
  };
}

/** An arched or rectangular panel lying in the facade plane at depth `d`. */
function panel(facade, frame, d, depth, { inset = 0 } = {}) {
  const width = Math.max(0.1, frame.width - inset * 2);
  const geometry = frame.arched
    ? archedPanel({
      width,
      springHeight: Math.max(0.05, frame.springY - frame.bottom - inset),
      radius: Math.max(0.05, frame.radius - inset),
      depth,
      position: [frame.u, frame.bottom + inset, d],
    })
    : beveledBox({
      width,
      height: Math.max(0.1, frame.height - inset * 2),
      depth,
      position: [frame.u, frame.bottom + frame.height / 2, d],
      detail: 1,
      bevelRatio: 0.06,
    });
  return geometry.applyMatrix4(facadeMatrix(facade));
}

/** Timber members around the opening, with the arch head as a segmented curve. */
function timberSurround(facade, frame, d, size) {
  const beams = [];
  const beam = (a, b) => beams.push(facadeBeam(facade, a, b, size, { proud: FRAME_PROUD }));
  const left = frame.u - frame.width / 2 - size / 2;
  const right = frame.u + frame.width / 2 + size / 2;
  beam([left, frame.bottom, d], [left, frame.springY, d]);
  beam([right, frame.bottom, d], [right, frame.springY, d]);
  if (frame.arched) {
    const segments = 7;
    const radius = frame.radius + size / 2;
    for (let index = 0; index < segments; index += 1) {
      const a0 = Math.PI * index / segments;
      const a1 = Math.PI * (index + 1) / segments;
      beam(
        [frame.u + Math.cos(a0) * radius, frame.springY + Math.sin(a0) * radius, d],
        [frame.u + Math.cos(a1) * radius, frame.springY + Math.sin(a1) * radius, d],
      );
    }
  } else {
    beam([left - size / 2, frame.springY + size / 2, d], [right + size / 2, frame.springY + size / 2, d]);
  }
  return beams;
}

/** Glazing bars: a transom and mullions, including the joins of a multi-panel assembly. */
function glazingBars(facade, frame, opening, d) {
  const bars = [];
  const bar = (a, b) => bars.push(facadeBeam(facade, a, b, 0.045, { proud: 0.035 }));
  const members = opening.memberOpenings ?? [];
  const boundaries = [];
  for (let index = 1; index < members.length; index += 1) {
    const previous = members[index - 1];
    const next = members[index];
    const edge = (previous.assemblySurfaceX + previous.width / 2 + next.assemblySurfaceX - next.width / 2) / 2;
    boundaries.push(frame.u + edge - opening.centerX);
  }
  if (boundaries.length === 0 && frame.width > 0.5) boundaries.push(frame.u);
  for (const u of boundaries) bar([u, frame.bottom, d], [u, frame.springY, d]);
  const transom = frame.bottom + (frame.springY - frame.bottom) * 0.62;
  bar([frame.u - frame.width / 2, transom, d], [frame.u + frame.width / 2, transom, d]);
  return bars;
}

/** Quaternion-composed rotation: the facade's yaw, then a roll in the facade plane. */
function facadeRoll(facade, roll) {
  const quaternion = new THREE.Quaternion()
    .setFromAxisAngle(new THREE.Vector3(0, 1, 0), facade.yaw)
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll));
  const euler = new THREE.Euler().setFromQuaternion(quaternion);
  return [euler.x, euler.y, euler.z];
}

/** Voussoirs round an arch, or a lintel over a square head, plus a sill. */
function stoneDressings(kit, facade, frame, thickness, { sill }) {
  const d = -thickness / 2 + 0.03;
  if (frame.arched) {
    const ringRadius = frame.radius + STONE_DRESSING_DEPTH / 2;
    const count = Math.max(5, 2 * Math.round(Math.PI * ringRadius / 0.52) + 1);
    for (let index = 0; index < count; index += 1) {
      const angle = Math.PI * (index + 0.5) / count;
      kit.stone({
        width: Math.PI * ringRadius / count * 0.9,
        height: STONE_DRESSING_DEPTH,
        depth: thickness + 0.04,
        position: facadePoint(
          facade,
          frame.u + Math.cos(angle) * ringRadius,
          frame.springY + Math.sin(angle) * ringRadius,
          d,
        ),
        rotation: facadeRoll(facade, angle - Math.PI / 2),
      }, { category: 'voussoir', heightRatio: 0.7 });
    }
  } else {
    kit.stone({
      width: frame.width + 0.5,
      height: 0.28,
      depth: thickness + 0.04,
      position: facadePoint(facade, frame.u, frame.springY + 0.14, d),
      rotation: [0, facade.yaw, 0],
    }, { category: 'ashlar', heightRatio: 0.7 });
  }
  if (sill) {
    kit.stone({
      width: frame.width + 0.22,
      height: 0.12,
      depth: thickness + 0.12,
      position: facadePoint(facade, frame.u, frame.bottom - 0.06, d + 0.05),
      rotation: [0, facade.yaw, 0],
    }, { category: 'ashlar', heightRatio: 0.3 });
  }
}

function shutterPair(facade, frame, d) {
  const shutters = [];
  const width = frame.width / 2;
  const height = frame.springY - frame.bottom;
  for (const side of [-1, 1]) {
    const u = frame.u + side * (frame.width / 2 + FRAME + width / 2 + 0.02);
    shutters.push(beveledBox({
      width,
      height,
      depth: 0.04,
      position: facadePoint(facade, u, frame.bottom + height / 2, d),
      rotation: [0, facade.yaw, 0],
      detail: 1,
      bevelRatio: 0.1,
    }));
    for (const ledge of [0.2, 0.8]) {
      shutters.push(facadeBeam(
        facade,
        [u - width / 2 + 0.03, frame.bottom + height * ledge, d + 0.02],
        [u + width / 2 - 0.03, frame.bottom + height * ledge, d + 0.02],
        0.07,
        { proud: 0.03 },
      ));
    }
  }
  return shutters;
}

function flowerBox(kit, facade, frame, d) {
  const width = Math.max(0.45, frame.width * 0.95);
  const y = frame.bottom - 0.16;
  const pieces = [['wood', beveledBox({
    width,
    height: 0.16,
    depth: 0.24,
    position: facadePoint(facade, frame.u, y, d + 0.12),
    rotation: [0, facade.yaw, 0],
    detail: 1,
    bevelRatio: 0.14,
  })]];
  const blooms = Math.max(5, Math.round(width / 0.1));
  for (let index = 0; index < blooms; index += 1) {
    const u = frame.u - width * 0.42 + width * 0.84 * index / Math.max(1, blooms - 1);
    pieces.push(['foliage', leaf({
      radius: 0.07 + kit.random() * 0.035,
      position: facadePoint(facade, u, y + 0.12 + kit.random() * 0.1, d + 0.1 + kit.random() * 0.08),
      rotation: [kit.random(), kit.random() + facade.yaw, kit.random() * Math.PI],
      color: [0.36 + kit.random() * 0.2, 0.55 + kit.random() * 0.2, 0.25],
    })]);
  }
  return pieces;
}

function emit(kit, pieces, opening) {
  for (const [slot, geometry] of pieces) {
    if (!geometry) continue;
    if (opening.componentId) tagOpeningGeometry(geometry, opening, opening.door);
    kit.add(slot, geometry);
  }
}

/**
 * A window in a facade.
 *
 * In a plaster wall the casement stands proud of the continuous shell; in a
 * stone wall the glass sits back inside the void the courses left and the head
 * is dressed with voussoirs or a lintel. Editable windows keep their component
 * tag on every insert piece so they select and regenerate as one opening.
 */
export function buildWindow(kit, facade, opening, {
  wall = 'plaster',
  thickness = 0.22,
  shutters = false,
  flowers = false,
} = {}) {
  const frame = frameOf(facade, opening);
  const pieces = [];
  if (wall === 'stone') {
    const d = -thickness * 0.6;
    pieces.push(['recess', panel(facade, frame, d, 0.04)]);
    for (const bar of glazingBars(facade, frame, opening, d + 0.03)) pieces.push(['wood', bar]);
    stoneDressings(kit, facade, frame, thickness, { sill: true });
  } else {
    pieces.push(['recess', panel(facade, frame, 0.015, 0.03)]);
    for (const beam of timberSurround(facade, frame, 0.03, FRAME)) pieces.push(['wood', beam]);
    for (const bar of glazingBars(facade, frame, opening, 0.04)) pieces.push(['wood', bar]);
    pieces.push(['wood', beveledBox({
      width: frame.width + 0.24,
      height: 0.07,
      depth: 0.15,
      position: facadePoint(facade, frame.u, frame.bottom - 0.035, 0.07),
      rotation: [0, facade.yaw, 0],
      detail: 1,
    })]);
    if (shutters && !frame.arched) {
      for (const shutter of shutterPair(facade, frame, 0.05)) pieces.push(['wood', shutter]);
    }
  }
  if (flowers && !opening.door) pieces.push(...flowerBox(kit, facade, frame, wall === 'stone' ? 0.02 : 0.05));
  emit(kit, pieces, { ...opening, door: false });
}

/** A ledged plank door with strap hinges, set in a timber frame or a dressed stone void. */
export function buildDoor(kit, facade, opening, { wall = 'plaster', thickness = 0.22, step = true } = {}) {
  const frame = frameOf(facade, opening);
  const d = wall === 'stone' ? -thickness * 0.55 : 0.03;
  const pieces = [];
  if (frame.arched) {
    pieces.push(['wood', panel(facade, frame, d, 0.06)]);
  } else {
    const boards = Math.max(3, Math.round(frame.width / 0.2));
    const boardWidth = frame.width / boards;
    for (let index = 0; index < boards; index += 1) {
      pieces.push(['wood', beveledBox({
        width: boardWidth * 0.97,
        height: frame.height,
        depth: 0.06,
        position: facadePoint(facade, frame.u - frame.width / 2 + boardWidth * (index + 0.5), frame.bottom + frame.height / 2, d),
        rotation: [0, facade.yaw, 0],
        detail: 1,
        bevelRatio: 0.12,
      })]);
    }
  }
  for (const ratio of [0.2, 0.72]) {
    const y = frame.bottom + (frame.springY - frame.bottom) * ratio;
    pieces.push(['metal', facadeBeam(
      facade,
      [frame.u - frame.width / 2 + 0.04, y, d + 0.04],
      [frame.u + frame.width * 0.2, y, d + 0.04],
      0.06,
      { proud: 0.02 },
    )]);
  }
  pieces.push(['metal', beveledBox({
    width: 0.06,
    height: 0.14,
    depth: 0.05,
    position: facadePoint(facade, frame.u + frame.width * 0.32, frame.bottom + 1.0, d + 0.05),
    rotation: [0, facade.yaw, 0],
    detail: 1,
  })]);
  if (wall === 'stone') {
    stoneDressings(kit, facade, frame, thickness, { sill: false });
  } else {
    for (const beam of timberSurround(facade, frame, 0.03, 0.12)) pieces.push(['wood', beam]);
  }
  emit(kit, pieces, { ...opening, door: true });
  if (step && opening.bottom < 0.05) {
    kit.stone({
      width: frame.width + 0.36,
      height: 0.16,
      depth: 0.42,
      position: facadePoint(facade, frame.u, frame.bottom + 0.02, 0.2),
      rotation: [0, facade.yaw, 0],
    }, { category: 'ashlar', heightRatio: 0.05 });
  }
}

/** Build every opening on a facade, dispatching doors and windows. */
export function buildOpenings(kit, facade, openings, options = {}) {
  for (const opening of openings) {
    if (opening.door) buildDoor(kit, facade, opening, options);
    else buildWindow(kit, facade, opening, options);
  }
}
