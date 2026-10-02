import { mixSeed } from '../../workshop/ProceduralRandom.js';

const PATCH_HASH = 0x79a33b7d;
const smooth = t => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

/** Continuous tones anchored in the solved wall surface, across module seams. */
export function stoneColorPatch(profile, seed, { s, y }) {
  const x = s / profile.span; const v = y / profile.rise;
  const ix = Math.floor(x); const iy = Math.floor(v);
  const sample = (a, b) => mixSeed(mixSeed(seed ^ PATCH_HASH, a), b) / 0x100000000;
  const amount = lerp(lerp(sample(ix, iy), sample(ix + 1, iy), smooth(x - ix)),
    lerp(sample(ix, iy + 1), sample(ix + 1, iy + 1), smooth(x - ix)), smooth(v - iy));
  const from = amount < 0.5 ? profile.pale : profile.ochre;
  const to = amount < 0.5 ? profile.ochre : profile.peach;
  const t = amount < 0.5 ? amount * 2 : (amount - 0.5) * 2;
  return from.map((value, channel) => lerp(value, to[channel], t));
}
