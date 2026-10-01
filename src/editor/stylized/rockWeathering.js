import {
  attribute,
  color,
  dot,
  float,
  mix,
  normalWorld,
  positionGeometry,
  positionWorld,
  sin,
  texture,
  uniform,
  uv,
  vec3,
} from 'three/tsl';
import { stylizedFbm2 } from './StylizedNoiseNodes.js';

/**
 * Weathering for the authored rock pack — after grass-test's `rockWeathering`.
 *
 * The stylized rock albedo is near-white and uniform, so bare stones read as
 * plastic dropped on the grass. Moss on the up-facing faces in broken patches,
 * shaded undersides and a toned-down albedo are what make them sit in the world
 * instead, and it is a handful of ALU ops with no extra texture.
 *
 * The donor's wet waterline is adapted rather than copied: it reads its sea and
 * lake levels from the fixed map's config, and this world has no fixed levels —
 * a lake's surface depends on the body the stone is standing in. Sea level is the
 * one level that is global, so the splash line keys on that, and a stone on a
 * lake shore simply keeps its dry band. A per-point answer would need the rock
 * material to bind the water field, which is a much larger change than this
 * effect is worth.
 *
 * The donor also dithered rocks away in front of the character. This project's
 * `CharacterOcclusion` deliberately cuts foliage only — rocks are solid obstacles
 * and cutting them reads as a hole in the world — so the mask is left alone.
 */

/**
 * The donor's tone and moss frequencies are per unit of its world, 2.8 to the
 * metre. Read per metre they gave a 2.5 m stone one flat tone and either no moss
 * or a solid cap; converted, a stone carries the donor's broken patches again.
 */
const DONOR_UNITS_PER_METRE = 2.8;
/** Per-placement shift of the pattern, per unit of the instance seed (0..1). */
const SEED_SPREAD = Object.freeze([131.7, 71.3, 97.9]);

/**
 * Where a fragment sits in the weathering pattern: the stone's own (object-space)
 * position, shifted by its placement's stable seed. Render-space position moved
 * with every floating-origin rebase, so each stone's tone and moss jumped when the
 * player walked far enough; object space does not move, and the seed keeps
 * stones sharing one template from reading as copies. The rock view draws only
 * instanced meshes, which always carry `instanceDither` (y is the seed).
 */
function patternPosition() {
  const seed = attribute('instanceDither', 'vec3').y;
  return positionGeometry.add(vec3(...SEED_SPREAD).mul(seed));
}

const MOSS_LIGHT = '#7d9a3a';
const MOSS_DARK = '#4d6424';
const DUST = '#a89a80';
const ALGAE = '#4a5a2a';

export const DEFAULT_ROCK_WEATHERING = Object.freeze({
  enabled: true,
  // Multiplies the albedo. The pack is painted bright, and stones that arrive at
  // full brightness are the ones that read as plastic.
  toning: 0.72,
  moss: 0.85,
  dust: 0.35,
  waterline: 0.7,
  // Metres above the water the splash line reaches, ragged by the noise.
  waterlineHeight: 1.2,
  wetDarkening: 0.5,
  /** Green in the upper half of the splash band, where a tide mark grows. */
  algae: 0.45,
  algaeColor: ALGAE,
});

/**
 * @param {object} [configured] `stylizedSurface.rocks.weathering`
 */
export function resolveRockWeathering(configured) {
  if (configured?.enabled === false) return null;
  const settings = { ...DEFAULT_ROCK_WEATHERING, ...(configured ?? {}) };
  for (const key of ['toning', 'moss', 'dust', 'waterline', 'algae']) {
    const value = Number(settings[key]);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`Invalid editor configuration: rocks.weathering.${key} must be within [0, 1].`);
    }
  }
  if (!(Number(settings.waterlineHeight) > 0)) {
    throw new Error('Invalid editor configuration: rocks.weathering.waterlineHeight must be positive.');
  }
  return settings;
}

/**
 * Rewrites a cloned rock material's albedo and roughness in place.
 *
 * @param {object} material a cloned MeshStandardNodeMaterial
 * @param {object} options
 * @param {object} options.settings resolved weathering settings
 * @param {number|null} [options.seaLevel] world sea level, for the splash line
 */
export function applyRockWeathering(material, { settings, seaLevel = null }) {
  if (!settings?.enabled) return material;
  const sourceMap = material.map ?? null;
  const world = positionWorld;
  const pattern = patternPosition();
  const donor = pattern.mul(DONOR_UNITS_PER_METRE);
  const donorXZ = donor.xz;

  // Broad tonal breakup from sine products over the stone, so stones sharing one
  // template stop reading as copies of each other.
  const tone = sin(donor.x.mul(0.83).add(sin(donor.y.mul(1.31)).mul(1.6)))
    .mul(sin(donor.z.mul(0.97).add(sin(donor.x.mul(0.61)).mul(1.2))))
    .mul(sin(donor.y.mul(0.71).add(donor.z.mul(0.37))))
    .mul(0.5).add(0.5);
  const albedo = (sourceMap ? texture(sourceMap, uv()).rgb : vec3(1))
    .mul(color(material.color.getHex()))
    .mul(settings.toning)
    .mul(mix(0.74, 1.06, tone));

  // Moss in broken patches on whatever faces up.
  const patches = sin(donorXZ.x.mul(0.9).add(sin(donorXZ.y.mul(0.7)).mul(1.8)))
    .mul(sin(donorXZ.y.mul(1.1).add(sin(donorXZ.x.mul(0.5)).mul(1.4))))
    .mul(0.5).add(0.5);
  const up = normalWorld.y;
  const mossMask = up.smoothstep(0.35, 0.85)
    .mul(patches.smoothstep(0.25, 0.7))
    .mul(settings.moss);
  const shade = dot(albedo, vec3(0.3, 0.59, 0.11)).mul(0.9).add(0.55);
  const mossColor = mix(color(MOSS_DARK), color(MOSS_LIGHT), patches).mul(shade);
  // Undersides sit in the ground's shade.
  const underside = up.smoothstep(-0.7, 0.15).mul(0.45).add(0.55);
  let weathered = mix(albedo, mossColor, mossMask).mul(underside);
  let roughness = material.roughnessMap
    ? texture(material.roughnessMap, uv()).g.mul(material.roughness ?? 1).max(mossMask.mul(0.95))
    : float(material.roughness ?? 0.85).max(mossMask.mul(0.95));

  // Dust settles on the bare tops the moss has not claimed.
  const dust = up.smoothstep(0.55, 0.95)
    .mul(mossMask.oneMinus())
    .mul(patches.oneMinus())
    .mul(settings.dust);
  weathered = mix(weathered, color(DUST).mul(shade), dust);

  // Wet, dark and glossy up to a ragged splash line at the sea, with the green
  // that grows just above it. The donor darkens the band; the tint is the half of
  // a waterline that makes it read as a tide mark rather than as shadow.
  if (Number.isFinite(seaLevel) && settings.waterline > 0) {
    const level = uniform(seaLevel);
    const splash = stylizedFbm2(pattern.xz.mul(0.7)).mul(0.5).add(0.5)
      .mul(settings.waterlineHeight);
    const above = world.y.sub(level);
    const wet = above.smoothstep(splash.mul(0.6), splash.add(0.15)).oneMinus()
      .mul(above.smoothstep(-2, -0.5))
      .mul(settings.waterline);
    weathered = weathered.mul(wet.mul(settings.wetDarkening).oneMinus());
    roughness = mix(roughness, float(0.25), wet);
    // Algae sits in the upper, drier half of the band — it needs the water but
    // does not live under it — so it fades in above the wet line rather than with
    // it, and is broken up by the same noise the splash line is.
    if (settings.algae > 0) {
      const band = above.smoothstep(splash.mul(0.35), splash.mul(1.1));
      const growth = band.mul(above.smoothstep(-0.2, 0.7)).oneMinus()
        .mul(splash)
        .mul(settings.algae);
      weathered = mix(weathered, color(settings.algaeColor ?? ALGAE), growth.clamp(0, 1));
    }
  }

  material.colorNode = weathered;
  material.roughnessNode = roughness;
  material.needsUpdate = true;
  return material;
}
