import { mixSeed } from '../../workshop/ProceduralRandom.js';

const smooth = t => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

/** Continuous scalar field on the solved wall surface, independent of modules. */
export function surfaceValueAt(seed, s, y, span, rise, domain) {
  const x = s / span; const v = y / rise;
  const ix = Math.floor(x); const iy = Math.floor(v);
  const sample = (a, b) => mixSeed(mixSeed(seed ^ domain, a), b) / 0x100000000;
  return lerp(lerp(sample(ix, iy), sample(ix + 1, iy), smooth(x - ix)),
    lerp(sample(ix, iy + 1), sample(ix + 1, iy + 1), smooth(x - ix)), smooth(v - iy));
}
