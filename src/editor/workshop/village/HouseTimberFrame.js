import { facadeBeam } from './HouseFacade.js';

/** Timbers stand this far out of the plaster face they frame. */
const PROUD = 0.09;
const FACE_D = 0.02;

/** Facade-space extent of an opening, including the frame around it. */
export function openingExtent(facade, opening, margin = 0) {
  const u = facade.length / 2 + opening.centerX;
  const height = opening.springHeight + opening.radius;
  return {
    u0: u - opening.width / 2 - margin,
    u1: u + opening.width / 2 + margin,
    y0: facade.y0 + opening.bottom - margin,
    y1: facade.y0 + opening.bottom + height + margin,
  };
}

function overlapsHorizontally(u, extents, clearance) {
  return extents.some(({ u0, u1 }) => u > u0 - clearance && u < u1 + clearance);
}

function postPositions(facade, extents, spacing, size) {
  const posts = [size / 2, facade.length - size / 2];
  // Jamb posts either side of every opening.
  for (const { u0, u1 } of extents) posts.push(u0 - size / 2, u1 + size / 2);
  const bays = Math.max(1, Math.round(facade.length / spacing));
  for (let bay = 1; bay < bays; bay += 1) {
    const u = facade.length * bay / bays;
    if (overlapsHorizontally(u, extents, size)) continue;
    posts.push(u);
  }
  const sorted = posts
    .filter((u) => u >= size / 2 - 1e-6 && u <= facade.length - size / 2 + 1e-6)
    .sort((left, right) => left - right);
  // Drop a regular post that crowds a jamb post.
  return sorted.filter((u, index) => index === 0 || u - sorted[index - 1] > size * 1.6);
}

/** Split [u0, u1] around the openings a horizontal member at height `y` would cross. */
function railSegments(u0, u1, y, extents) {
  const blockers = extents
    .filter((extent) => y > extent.y0 && y < extent.y1)
    .sort((left, right) => left.u0 - right.u0);
  const segments = [];
  let start = u0;
  for (const { u0: blockStart, u1: blockEnd } of blockers) {
    if (blockStart > start) segments.push([start, blockStart]);
    start = Math.max(start, blockEnd);
  }
  if (u1 > start) segments.push([start, u1]);
  return segments.filter(([a, b]) => b - a > 0.05);
}

function postSegments(u, y0, y1, extents) {
  const blockers = extents
    .filter((extent) => u > extent.u0 && u < extent.u1)
    .sort((left, right) => left.y0 - right.y0);
  const segments = [];
  let start = y0;
  for (const { y0: blockStart, y1: blockEnd } of blockers) {
    if (blockStart > start) segments.push([start, blockStart]);
    start = Math.max(start, blockEnd);
  }
  if (y1 > start) segments.push([start, y1]);
  return segments.filter(([a, b]) => b - a > 0.05);
}

/**
 * Half-timbering over one plastered facade.
 *
 * Posts are regular but always frame the openings; rails break around them;
 * braces fill only clear bays. `braces` is 'none', 'diagonal' (mirrored about
 * the facade centre, as carpenters set them to resist racking both ways) or
 * 'cross'. `rails` lists extra rail heights in world metres.
 */
export function timberFrame(kit, facade, {
  y0 = facade.y0,
  y1 = facade.y1,
  spacing = 1.5,
  braces = 'diagonal',
  rails = [],
  openings = [],
  size = 0.18,
} = {}) {
  const beam = (a, b) => kit.add('wood', facadeBeam(facade, a, b, size, { proud: PROUD }));
  const extents = openings.map((opening) => openingExtent(facade, opening, 0.02));
  const posts = postPositions(facade, extents, spacing, size);

  for (const u of posts) {
    for (const [a, b] of postSegments(u, y0, y1, extents)) beam([u, a, FACE_D], [u, b, FACE_D]);
  }
  const railHeights = [y0 + size / 2, y1 - size / 2, ...rails];
  for (const y of railHeights) {
    for (const [a, b] of railSegments(0, facade.length, y, extents)) beam([a, y, FACE_D], [b, y, FACE_D]);
  }
  // Head and sill rails between each opening's jamb posts.
  for (const { u0, u1, y0: bottom, y1: top } of extents) {
    beam([u0, top + size / 2, FACE_D], [u1, top + size / 2, FACE_D]);
    if (bottom - y0 > size) beam([u0, bottom - size / 2, FACE_D], [u1, bottom - size / 2, FACE_D]);
  }

  if (braces === 'none') return;
  const braceTop = rails.length > 0 ? Math.min(...rails) : y1 - size;
  for (let index = 1; index < posts.length; index += 1) {
    const a = posts[index - 1] + size / 2;
    const b = posts[index] - size / 2;
    if (b - a < 0.45 || overlapsHorizontally((a + b) / 2, extents, (b - a) / 2)) continue;
    const bottom = y0 + size;
    const leftHand = (a + b) / 2 < facade.length / 2;
    if (braces === 'cross') {
      beam([a, bottom, FACE_D], [b, braceTop, FACE_D]);
      beam([b, bottom, FACE_D], [a, braceTop, FACE_D]);
    } else {
      beam(leftHand ? [a, bottom, FACE_D] : [b, bottom, FACE_D], leftHand ? [b, braceTop, FACE_D] : [a, braceTop, FACE_D]);
    }
  }
}
