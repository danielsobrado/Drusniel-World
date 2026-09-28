import {
  Fn,
  If,
  abs,
  attribute,
  cameraPosition,
  clamp,
  cos,
  dot,
  float,
  floor,
  fract,
  max,
  min,
  mix,
  oneMinus,
  positionLocal,
  pow,
  sin,
  smoothstep,
  sqrt,
  texture,
  uv,
  vec2,
  vec3,
} from 'three/tsl';

import { sampleWorldWindCanonical } from '../../weather/wind/worldWindState.js';
import { groundDeformationNode } from '../deformation/groundDeformationNode.js';
import { stylizedDirtMask, stylizedPathWearMask } from '../StylizedNoiseNodes.js';
import { meadowNoise } from './meadowNoise.js';

const HALF_PI = Math.PI * 0.5;
const TWO_PI = Math.PI * 2;
const HIDDEN = 1e9;
/** The donor's hash and its guard for a degenerate fold direction. */
const HASH_SCALE = 43758.5453;
const INTERACTION_EPSILON = 0.00201;
/** Donor units per metre, the conversion meadowGrassConfig's defaults were built on. */
const DONOR_UNITS_PER_METRE = 2.8;

/**
 * The instance inputs every meadow stage reads. Each call builds fresh nodes:
 * TSL emits a shared node where it is first built, so one first used inside an
 * `If` would leave every later reader an unassigned variable.
 */
export function meadowInstance(originUniform, { cards = false } = {}) {
  const position = attribute('instancePosition', 'vec4');
  const tile = attribute('instanceTile', 'vec2');
  const data = attribute('instanceData', 'vec4');
  const base = vec3(tile.x.add(position.x), position.y, tile.y.add(position.z));
  return {
    base,
    tile,
    local: position.xz,
    canonical: base.xz.add(originUniform),
    strength: position.w,
    rotation: attribute('instanceRotation', 'vec2'),
    // Blades: shape id + path mask in the fraction. Cards: shape × 4 + variant.
    shape: cards ? floor(data.x.div(4)) : floor(data.x),
    cell: cards ? data.x : float(0),
    path: cards ? float(0) : fract(data.x),
    rank: data.y,
    phase: data.z,
    variation: data.w,
  };
}

/**
 * Footprint depth under a stem (groundDeformationNode), addressed from the tile's
 * exact whole-metre corner: tile centres sit on whole metres, so rounding the
 * float32 render + origin sum recovers them exactly at planet scale.
 */
export function meadowTrodden(blade, originUniform, tileSize) {
  const half = tileSize / 2;
  const center = blade.tile.add(originUniform).round();
  const corner = vec2(center.x.sub(half), center.y.negate().sub(half));
  return groundDeformationNode(corner, vec2(blade.local.x.add(half), blade.local.y.negate().add(half)));
}

/** The silhouette's half-width factor at height ratio r (meadowGrassShapes.js, in TSL). */
function silhouette(shape, r) {
  const slender = oneMinus(r);
  const reed = oneMinus(pow(r, 5)).mul(0.55);
  const broadleaf = sqrt(max(float(0), oneMinus(r.mul(r)))).mul(0.85);
  return shape.lessThan(0.5).select(slender, shape.lessThan(1.5).select(reed, broadleaf));
}

/**
 * Stems a band retires across its width, by rank (the donor's `#lodCoverage`).
 * `bands` is a uniformArray of vec4 (end, count, next count, window). A stem
 * ranked in a band's retiring range fades out as the band's phase passes its
 * order, and the survivors widen by the share already retired (capped), so the
 * count drops without the meadow going bald.
 */
function lodCoverage({ bands, bandCount, distance, rank, appearance }) {
  const coverage = float(1).toVar();
  const standing = bands.element(bandCount - 1).z.toVar();
  for (let index = 0; index < bandCount; index += 1) {
    const band = bands.element(index);
    const phase = smoothstep(band.x.sub(band.w), band.x, distance).mul(1.2).toVar();
    standing.addAssign(band.y.sub(band.z).mul(float(1.1).sub(phase).clamp(0, 1)));
    If(rank.greaterThanEqual(band.z).and(rank.lessThan(band.y)), () => {
      const order = band.y.sub(rank).div(band.y.sub(band.z).max(1));
      coverage.assign(float(1).sub(smoothstep(order, order.add(0.2), phase)));
    });
  }
  const widen = min(
    mix(float(1), bands.element(0).y.div(standing.max(1)), appearance.lodCompensation),
    max(appearance.lodWidenMax, float(1)),
  );
  return {
    coverage,
    width: mix(float(1), coverage, appearance.lodThinning).mul(widen),
    shrink: mix(coverage, float(1), appearance.lodThinning),
  };
}

/**
 * The player's body pressing the meadow over (grass-test's `#sampleInteractionBlade`).
 * A blade folds in a direction hashed from its own base — stable per blade and
 * scattered across the trail, *not* radial from the body — and stands back up as the
 * stamp decays behind the player. Read from the interaction map's render-space
 * window, so it needs no floating-origin conversion.
 *
 * The donor adds the arc to a unit-local blade of 1.5 units and scales it by the
 * blade's width afterwards; in metres that is exactly `bladeHeight × width`, with the
 * height read in donor units. The arc itself is the donor's, unchanged.
 */
function foldUnderBody(blade, local, strength, uniforms, interaction) {
  const windowUv = blade.base.xz
    .sub(interaction.center)
    .div(interaction.worldSize)
    .add(0.5);
  const inside = windowUv.x.greaterThanEqual(0).and(windowUv.x.lessThanEqual(1))
    .and(windowUv.y.greaterThanEqual(0)).and(windowUv.y.lessThanEqual(1));
  const influence = float(0).toVar();
  If(inside, () => {
    influence.assign(texture(interaction.texture, windowUv.clamp(0, 1)).r);
  });

  const amount = smoothstep(0, 0.15, influence);
  const directionX = float(0).toVar();
  const directionZ = float(0).toVar();
  const bendAngle = float(0).toVar();
  If(amount.greaterThan(0), () => {
    const angle = fract(sin(dot(blade.base.xz, vec2(0.9898, 0.2330))).mul(HASH_SCALE)).mul(TWO_PI);
    directionX.assign(cos(angle));
    directionZ.assign(sin(angle));
    bendAngle.assign(amount.mul(HALF_PI));
  });

  // Normalised outside the `If`, as the donor has it: with no stamp the direction is
  // the zero vector, so the fold contributes nothing rather than reading an
  // unassigned variable.
  const directionLength = sqrt(directionX.mul(directionX).add(directionZ.mul(directionZ)));
  const safeLength = max(directionLength, INTERACTION_EPSILON);
  const curve = bendAngle.mul(3);
  const heightRatio = local.y.div(uniforms.bladeHeight).clamp(0, 1);
  const reach = uniforms.bladeHeight.mul(DONOR_UNITS_PER_METRE).mul(uniforms.bladeWidth);
  const horizontal = reach.mul(strength).mul(sin(curve.mul(heightRatio))).mul(heightRatio);
  local.x.addAssign(directionX.div(safeLength).mul(horizontal));
  local.z.addAssign(directionZ.div(safeLength).mul(horizontal));
  local.y.assign(local.y.mul(cos(curve.mul(heightRatio))));
}

/**
 * The blade's render-space position (the batch mesh has an identity transform).
 *
 * @param {object} options
 * @param {object} options.uniforms createMeadowUniforms()
 * @param {object} options.tuning GrassTuning uniforms (wind, lengths)
 * @param {object} options.config stylizedSurface (dirt, path)
 * @param {number} options.bandCount bands that retire stems (3 when far cards take over)
 * @param {number} options.tileSize metres, for the footprint lookup
 * @param {object | null} [options.interaction] uniforms.interaction, when the field
 *   has an interaction map; without it the fold is not built at all
 */
export function createMeadowBladePosition({ uniforms, tuning, config, bandCount, tileSize, interaction = null }) {
  return Fn(() => {
    const blade = meadowInstance(uniforms.origin);
    const bladeUv = uv();
    const r = bladeUv.y.clamp(0, 1);
    const local = vec3(0).toVar();
    const distance = blade.base.xz.sub(cameraPosition.xz).length();
    const lod = lodCoverage({
      bands: uniforms.lodBands, bandCount, distance, rank: blade.rank, appearance: uniforms.appearance,
    });
    const hidden = distance.greaterThan(uniforms.maxDistance)
      .or(blade.strength.lessThanEqual(0))
      .or(lod.coverage.lessThanEqual(0));
    If(hidden, () => {
      local.assign(vec3(HIDDEN));
    });
    If(hidden.not(), () => {
      // Worn ground: tracks and the broad bare pockets cut the stand back.
      const pathWear = stylizedPathWearMask(blade.path, blade.canonical, {
        vergeWidth: float(config.path?.vergeWidth ?? 0.45),
        vergeCut: float(config.path?.vergeCut ?? 0.72),
        edgeScale: float(config.path?.edgeScale ?? 0.42),
        edgeWarp: float(config.path?.edgeWarp ?? 0.18),
      });
      const dirt = max(pathWear.wear, stylizedDirtMask(blade.canonical, {
        scale: float(config.dirt.scale),
        coverage: float(config.dirt.coverage),
        softness: float(config.dirt.softness),
        warp: float(config.dirt.warp),
      }));
      // Trodden by the player: blades press down under a print and rise as it fades.
      const trodden = meadowTrodden(blade, uniforms.origin, tileSize);
      const growth = blade.strength.mul(oneMinus(dirt.mul(config.dirt.bladeCut))).mul(oneMinus(trodden.mul(0.75)));
      // Patchy stand height, as the donor's cinematic meadow: a slow noise sets
      // each patch's scale so the field has swells and hollows, not one level.
      const patch = meadowNoise(blade.canonical.mul(uniforms.heightNoiseScale)).clamp(0, 1);
      const height = uniforms.bladeHeight
        .mul(mix(uniforms.heightScale.x, uniforms.heightScale.y, patch))
        .mul(growth);
      const width = uniforms.bladeWidth
        .mul(tuning.widthScale)
        .mul(sqrt(blade.strength))
        .mul(uniforms.widthScale)
        .mul(mix(float(1), uniforms.taper, r))
        .mul(mix(0.88, 1.12, blade.variation))
        .mul(silhouette(blade.shape, r))
        .mul(lod.width);
      local.x.assign(positionLocal.x.mul(width));
      local.y.assign(r.mul(height));
      local.z.assign(r.mul(r).mul(height).mul(uniforms.curve).mul(mix(0.7, 1.3, blade.variation)));
      // Face the blade. Snapshot both components: `local.x` is a live reference,
      // and reading it after the first assignment would rotate the rotated value.
      const x = local.x.toVar();
      const z = local.z.toVar();
      local.x.assign(x.mul(blade.rotation.y).sub(z.mul(blade.rotation.x)));
      local.z.assign(x.mul(blade.rotation.x).add(z.mul(blade.rotation.y)));

      // A resting bend toward the stem's own random side.
      const bendPower = pow(r, uniforms.stiffness);
      const restDirection = vec2(cos(blade.phase), sin(blade.phase));
      const restAngle = uniforms.baseBend.mul(blade.strength).mul(HALF_PI).mul(bendPower);
      local.x.addAssign(restDirection.x.mul(height.mul(sin(restAngle)).mul(r)));
      local.z.addAssign(restDirection.y.mul(height.mul(sin(restAngle)).mul(r)));
      local.y.subAssign(abs(height.mul(cos(restAngle).sub(1)).mul(r)));

      // Wind from the world field: gust fronts travel across the meadow and curl.
      // The sway is expressed as a bend angle (the donor's form), so a blade arcs
      // over rather than shearing sideways, and keeps its length as it goes.
      const wind = sampleWorldWindCanonical(blade.canonical);
      const direction = wind.direction;
      const gust = wind.envelope.clamp(0.35, 3.5);
      const across = vec2(direction.y.negate(), direction.x);
      const along = dot(blade.canonical, direction);
      const primary = sin(along.mul(tuning.windFrequency).add(uniforms.time.mul(tuning.windSpeed)).add(blade.phase));
      const secondary = sin(along.mul(tuning.windFrequency.mul(2.6))
        .add(uniforms.time.mul(tuning.windSpeed.mul(1.8))).add(blade.phase.mul(1.7)).add(1.3)).mul(0.35);
      const turbulence = sin(dot(blade.canonical, across).mul(tuning.windFrequency.mul(1.9))
        .add(uniforms.time.mul(tuning.windSpeed.mul(0.7))).add(blade.phase.mul(0.6)).add(2.6))
        .mul(tuning.windTurbulence);
      const compliance = oneMinus(blade.variation.mul(tuning.windStiffnessRange));
      const windAngle = tuning.windLean.add(primary.add(secondary).add(turbulence).mul(tuning.windStrength))
        .mul(compliance).mul(gust).mul(blade.strength).mul(2).clamp(-1.3, 1.3)
        .mul(bendPower);
      const windReach = height.mul(sin(windAngle)).mul(r);
      local.x.addAssign(direction.x.mul(windReach));
      local.z.addAssign(direction.y.mul(windReach));
      local.y.subAssign(abs(height.mul(cos(windAngle).sub(1)).mul(r)));
      // Tip flutter across the gust, faded before blades turn sub-pixel.
      const flutterFade = oneMinus(smoothstep(tuning.flutterFadeStart, tuning.flutterFadeEnd, distance));
      const flutter = sin(dot(blade.canonical, across).mul(1.9).add(uniforms.time.mul(3.4)).add(blade.phase.mul(3.1)))
        .mul(tuning.flutterStrength).mul(height).mul(pow(r, 3)).mul(flutterFade).mul(gust.sqrt());
      local.x.addAssign(across.x.mul(flutter));
      local.z.addAssign(across.y.mul(flutter));

      // The player's body, last so it folds whatever the wind has already done.
      if (interaction) foldUnderBody(blade, local, blade.strength, uniforms, interaction);

      local.assign(local.mul(clamp(lod.shrink, 0, 1)).add(blade.base));
    });
    return local;
  })();
}
