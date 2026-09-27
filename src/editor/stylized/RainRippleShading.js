import {
  abs,
  float,
  floor,
  fract,
  int,
  length,
  max,
  smoothstep,
  step,
  uint,
  vec2,
} from 'three/tsl';
import { latticeHashNode } from '../weather/wind/windNoise.js';

/**
 * Rain rings on a water chunk (after grass-test's rain ripples).
 *
 * Each 1 m cell drops one ring at a hashed point and time; a pixel looks at the
 * four cells nearest it. Rain decides how many cells are active and how bright
 * the rings are, so the cost is the same in calm weather but nothing shows.
 *
 * The lattice must be exact at planet scale, where float32 cannot hold a
 * canonical position's fraction. Cells are therefore indexed by the chunk's
 * integer origin in metres (a per-chunk uniform, exact below 2^24 m) plus a
 * local offset, and hashed as integers, which also keeps them continuous
 * across chunk borders.
 */

export const RAIN_RIPPLE_CELL_METERS = 1;
const RING_PERIOD_SECONDS = 1.1;
const RING_MAX_RADIUS = 0.45;
const RING_WIDTH = 0.045;

function cellHash(cellX, cellZ, salt) {
  return latticeHashNode(
    uint(int(cellX)).add(uint(salt * 7919)),
    uint(int(cellZ)).add(uint(salt * 104729)),
  );
}

/**
 * @param {object} options
 * @param {object} options.localMeters vec2: metres from the chunk's origin corner, cell axes
 * @param {object} options.originMeters vec2 uniform: the chunk origin in whole metres, cell axes
 * @param {object} options.time seconds
 * @param {object} options.rain 0..1
 * @returns {object} ring brightness, 0..1
 */
export function createRainRippleNode({ localMeters, originMeters, time, rain }) {
  const point = localMeters.div(RAIN_RIPPLE_CELL_METERS);
  const cell = floor(point);
  const local = fract(point);
  // The 2×2 block of cells nearest the pixel.
  const offset = step(0.5, local).mul(2).sub(1);
  let ring = float(0);
  for (const [ox, oz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const neighbour = vec2(offset.x.mul(ox), offset.y.mul(oz));
    const id = cell.add(neighbour).add(originMeters);
    const centre = neighbour.add(vec2(cellHash(id.x, id.y, 1), cellHash(id.x, id.y, 2)).mul(0.8).add(0.1));
    const age = fract(time.div(RING_PERIOD_SECONDS).add(cellHash(id.x, id.y, 3)));
    const active = step(cellHash(id.x, id.y, 4), rain.mul(0.85));
    const radius = age.mul(RING_MAX_RADIUS);
    const distance = length(local.sub(centre));
    const edge = float(1).sub(smoothstep(0, RING_WIDTH, abs(distance.sub(radius))));
    ring = max(ring, edge.mul(float(1).sub(age)).mul(active));
  }
  return ring.mul(rain);
}
