import { surfaceValueAt } from './SurfaceValueField.js';

const PATCH_HASH = 0x79a33b7d;
const lerp = (a, b, t) => a + (b - a) * t;

/** Continuous tones anchored in the solved wall surface, across module seams. */
export function stoneColorPatch(profile, seed, { s, y }) {
  const amount = surfaceValueAt(seed, s, y, profile.span, profile.rise, PATCH_HASH);
  const from = amount < 0.5 ? profile.pale : profile.ochre;
  const to = amount < 0.5 ? profile.ochre : profile.peach;
  const t = amount < 0.5 ? amount * 2 : (amount - 0.5) * 2;
  return from.map((value, channel) => lerp(value, to[channel], t));
}
