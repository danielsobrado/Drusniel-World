/**
 * Spray puffs for one river fall (after grass-test's waterfall mist), in
 * metres relative to the fall's foot at its water level.
 *
 * Per particle, three vec4s:
 *   spawn   x, y, z, and the water level there (relative, so 0 at the plunge)
 *   motion  x and z drift in m/s, rise in m/s, phase 0..1
 *   shape   start and end size in metres, lifetime in seconds, peak opacity
 *
 * Most rise from the plunge and drift downstream; a quarter lift off the lower
 * face. A bigger fall throws more and larger puffs, and a wider river spreads
 * them further, but past DENSITY_COUNT each puff is thinner, so a big fall's
 * cloud grows more in size than in density.
 */

const DENSITY_COUNT = 48;
const MAXIMUM_COUNT = 160;

function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  };
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function mistParticleCount(site) {
  const perFall = clamp(12 + site.drop * 0.9, 12, 64);
  const widthFactor = clamp(site.widthMeters / 12, 1, 2.5);
  return Math.round(Math.min(MAXIMUM_COUNT, perFall * widthFactor));
}

export function createMistParticles(site) {
  const random = createRandom(site.seed);
  const count = mistParticleCount(site);
  const strength = clamp(site.drop / 25, 0.35, 1.5);
  const sizeScale = clamp(site.widthMeters / 12, 1, 2);
  const thin = Math.min(1, Math.sqrt(DENSITY_COUNT / count));
  const faceX = site.lipX - site.x;
  const faceZ = site.lipZ - site.z;
  const drop = site.top - site.foot;
  const spawn = new Float32Array(count * 4);
  const motion = new Float32Array(count * 4);
  const shape = new Float32Array(count * 4);
  for (let index = 0; index < count; index += 1) {
    const face = random() < 0.25;
    // A face puff sits on the lower 65 % of the face, measured up from the foot.
    const up = face ? random() * 0.65 : 0;
    const baseX = faceX * up;
    const baseZ = faceZ * up;
    const across = (random() - 0.5) * (face ? 0.8 : 0.9) * site.widthMeters;
    const along = face ? 0 : (-0.5 + random() * 3.5) * sizeScale;
    const start = (1.6 + random() * 1.4) * (0.7 + 0.3 * strength) * (face ? 0.7 : 1) * sizeScale;
    // Centred at least half a puff above the water, so it is not born faded.
    const lift = start * 0.5 + (face ? 0.3 + random() * 0.8 : random() * 0.8);
    const drift = 0.25 + random() * 0.65;
    const lateral = (random() - 0.5) * 0.8;
    const rise = (0.45 + random() * 0.9) * (0.6 + 0.4 * strength) * (face ? 0.6 : 1);
    const lifetime = face ? 2.5 + random() * 2 : 3.5 + random() * 3;
    const grow = 2 + random() * 1.2;
    const opacity = (0.24 + random() * 0.18) * thin * (face ? 0.6 : 1);
    const offset = index * 4;
    spawn.set([
      baseX - site.dirZ * across + site.dirX * along,
      drop * up + lift,
      baseZ + site.dirX * across + site.dirZ * along,
      drop * up,
    ], offset);
    motion.set([
      site.dirX * drift - site.dirZ * lateral,
      rise,
      site.dirZ * drift + site.dirX * lateral,
      random(),
    ], offset);
    shape.set([start, start * grow, lifetime, opacity], offset);
  }
  return { count, spawn, motion, shape };
}
