import {
  Fn,
  If,
  Loop,
  cameraPosition as cameraPositionNode,
  color,
  dot,
  exp,
  float,
  mix,
  positionWorld as positionWorldNode,
  smoothstep,
  time as timeNode,
  vec2,
  vec3,
} from 'three/tsl';
import { stylizedFbm2 } from '../StylizedNoiseNodes.js';

/**
 * Valley mist, after grass-test's `createValleyFogNodes` (src/rendering/valleyFog.js).
 *
 * The donor lays mist over snow-country gorges. Density falls off exponentially
 * with height above the terrain, so it pools on gorge floors and in the valleys
 * below the view while crests stand clear. Drifting pockets break the sheet into
 * banks, and — because the ground under a view ray changes too much for a closed
 * form — the density is marched along the ray, sampling the heightfield in the
 * air rather than on the surface, so it reads as volume rather than paint. The
 * first metres stay clear so a wall beside the camera is not washed out, and
 * sunlit mist scatters forward toward the low sun, falling to a cool shade away
 * from it.
 *
 * WHAT CHANGED FROM THE DONOR, AND WHY
 *
 * - Depth buffer. The donor does NOT read the viewport depth buffer or the scene
 *   colour texture: it marches from `cameraPosition` toward `positionWorld`
 *   (the fragment being shaded) and looks up a height *texture* at each step.
 *   This port keeps that shape — it needs no depth and no colour texture, which
 *   is this project's hard rule. It therefore also adds no planar reflection or
 *   cube probe; the mist is a pure function of the ray and the height field.
 *
 * - Height source. The donor has one whole-map height texture
 *   (`terrainSampler.texture` with `bounds`), which this streamed Azgaar world
 *   does not: terrain arrives as per-chunk slots, so there is no single texture a
 *   shader can bind and index for the whole map. The terrain slot's own
 *   `heightTexture` is per-128 m-chunk and would need the shader to know which
 *   chunk a given ray step is over. So this port marches against a
 *   `LocalGroundHeight` patch instead — a 64² half-float height field rebuilt
 *   around the focus (src/editor/stylized/ambient/LocalGroundHeight.js). It is
 *   already what the ambient particles sit on, it is camera-local and bounded,
 *   and a single shared patch serves every material that blends this in.
 *
 * - Bounded ray. Because the patch is local, the march is too: `config.maxDistance`
 *   must stay inside the patch's reliable radius, and the mist fades out before
 *   that distance rather than reading terrain the patch does not have (which
 *   would otherwise paint a hard wall where the patch ends).
 *
 * Cost: a fixed `config.steps` texture fetches and noise evaluations per shaded
 * pixel (default 6), then one exponential. It is gated three ways — a compile-time
 * off switch (this returns `null`, so nothing is built), a runtime region weight
 * the caller fades where there are no gorges, and a distance fade. Below the
 * region weight the loop is skipped by a branch, so a large area that wants no
 * mist pays one comparison.
 */

/** Below this region weight the march is skipped; a uniform driven to zero costs one compare. */
const ACTIVE_WEIGHT = 0.001;
/** Fraction of `maxDistance` the ray's own height varies the pocket noise over. */
const HEIGHT_IN_POCKETS = 0.004;

/** Accept either `(x, z) => height` or an object exposing `heightNode(x, z)`. */
function asGroundSampler(heightSampler) {
  if (typeof heightSampler === 'function') return heightSampler;
  if (typeof heightSampler?.heightNode === 'function') {
    return (x, z) => heightSampler.heightNode(x, z);
  }
  return null;
}

/**
 * Mist that sits in the valleys and gorges below the view.
 *
 * @param {object} options
 * @param {object} [options.worldPosition] positionWorld node for the shaded point
 * @param {object} [options.cameraPosition] cameraPosition node, the ray's origin
 * @param {(x: object, z: object) => object | object} options.heightSampler a
 *   LocalGroundHeight (or its bound `heightNode`) giving ground height under a
 *   point in world x/z
 * @param {object} options.config resolved valleyFog settings (valleyFogConfig.js)
 * @param {object} [options.time] seconds uniform, for the drifting pockets
 * @param {object} [options.weight] region weight node 0..1 — the caller fades it
 *   out where there are no gorges (and to zero to switch the mist off at runtime)
 * @param {number} [options.quality] quality share 0..1; `<= 0` builds nothing
 * @param {object} [options.sunDirection] direction toward the sun, for the forward lobe
 * @param {object} [options.sunColor] sun colour × intensity, for the forward lobe
 * @param {object} [options.fogColor] scene fog colour to tint the mist toward
 * @returns {{ amount: object, color: object } | null} blend `mix(base, color, amount)`;
 *   `null` when there is nothing to build and the caller keeps its own material
 */
export function createValleyFogNodes({
  worldPosition = positionWorldNode,
  cameraPosition = cameraPositionNode,
  heightSampler = null,
  config = null,
  time = timeNode,
  weight = float(1),
  quality = 1,
  sunDirection = null,
  sunColor = null,
  fogColor = null,
} = {}) {
  const sampleGround = asGroundSampler(heightSampler);
  const steps = Math.round(Number(config?.steps) || 0);
  // Compile nothing when switched off: no branch, no loop and no texture fetch.
  // The caller keeps the material it already had, byte for byte.
  if (!config?.enabled || !sampleGround || steps < 1 || !(Number(quality) > 0)) return null;

  const range = config.nearClear;
  const stepFraction = 1 / steps;
  // Drift in pocket-noise units: bearing × speed (m/s) × time (s) × 1/scale (1/m).
  // Built from constants and a uniform, so the pockets slide downwind with the
  // weather without any per-frame upload.
  const angle = config.windAngleDegrees * Math.PI / 180;
  const drift = vec2(Math.cos(angle), Math.sin(angle))
    .mul(float(config.drift).mul(time))
    .mul(config.pocketScale);

  // Explicit level: the march runs inside a branch and a loop, where implicit
  // derivatives are not allowed, so the height fetch must name its mip.
  const opticalDepth = Fn(() => {
    const depth = float(0).toVar();
    If(weight.greaterThan(ACTIVE_WEIGHT), () => {
      const ray = worldPosition.sub(cameraPosition).toVar();
      const distance = ray.length().toVar();
      const direction = ray.normalize().toVar();
      // The patch under the camera is bounded, so the march is clamped to it;
      // the mist fades before the clamp so the boundary never shows.
      const length = distance.min(config.maxDistance).toVar();
      const step = length.mul(stepFraction).toVar();
      Loop(steps, ({ i }) => {
        const along = float(i).add(0.5).mul(step);
        // The first metres stay clear, so a wall beside the camera is not washed out.
        If(along.greaterThan(range[0]), () => {
          const point = cameraPosition.add(direction.mul(along));
          const above = point.y.sub(sampleGround(point.x, point.z)).max(0).toVar();
          If(above.lessThan(config.ceiling), () => {
            // Height is folded into the pocket coordinates so the tops of the
            // banks are ragged rather than flat.
            const cell = point.xz.mul(config.pocketScale).add(drift)
              .add(vec2(point.y.mul(HEIGHT_IN_POCKETS), 0));
            const pockets = stylizedFbm2(cell).mul(2).sub(1);
            const banks = mix(
              float(1 - config.pocketStrength),
              float(1 + config.pocketStrength),
              smoothstep(-0.45, 0.45, pockets),
            );
            const clear = smoothstep(range[0], range[1], along);
            const ceiling = smoothstep(config.ceiling * 0.6, config.ceiling, above).oneMinus();
            const fade = smoothstep(config.maxDistance * config.farFade, config.maxDistance, distance).oneMinus();
            depth.addAssign(
              exp(above.div(-config.height))
                .mul(banks).mul(clear).mul(ceiling).mul(fade).mul(step),
            );
          });
        });
      });
    });
    return depth.mul(config.density).mul(weight).mul(quality);
  })();

  const amount = exp(opticalDepth.negate()).oneMinus().clamp(0, 1);

  // Cool shade, tinted toward the scene fog so the mist does not read as a
  // separate layer sitting in front of it.
  const shade = color(config.shadeColor);
  const base = fogColor ? mix(shade.mul(fogColor), fogColor, 0.5) : shade;
  let tint = base;
  if (sunColor) {
    // Henyey-Greenstein forward lobe toward the sun, normalised to 1 at 90°.
    const view = worldPosition.sub(cameraPosition).normalize();
    const g = config.scatter;
    const cosine = dot(view, sunDirection ?? vec3(0.35, 0.85, 0.25).normalize());
    const phase = float((1 + g * g) ** 1.5)
      .div(float(1 + g * g).sub(cosine.mul(2 * g)).pow(1.5));
    tint = base.add(sunColor.mul(phase.mul(config.sunScatter)));
  }
  return { amount, color: tint };
}
