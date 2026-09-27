/**
 * Baked per-vertex colour for pillow stones.
 *
 * Rounded field stone reads through light and shadow, not surface grain, and
 * the stones get no screen-space AO: everything that darkens a crevice or lifts
 * a crown is baked here, per vertex, at build time. That is the "baked
 * per-vertex crevice occlusion" CLAUDE.md asks for, and its cost exists only
 * where walls are on screen.
 *
 * The terms follow `applyUnitShading`'s multiplicative scheme, so no one layer
 * can crush the albedo, plus one term the prism stones never needed: **crevice**
 * darkening by how far a point has rolled back from the face towards the joint.
 * Order matches the soft path — shade, subtract weathering, clamp, then apply
 * the stone's warm/cool grade — so both paths grade stones the same way.
 *
 * Three.js-free; the builder resolves albedo, grade and weathering per stone.
 */

function clamp01(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * @param options.albedo `[r, g, b]` unit colour from `stoneUnitAlbedo`
 * @param options.grade `[r, g, b]` multipliers, or null when grading is off
 * @param options.weather amount subtracted after shading (`stoneUnitWeathering`)
 * @param options.occlusion the rounding profile's `occlusion` block
 * @returns `shade(out, aboveGrade, localY, crevice, normalY)` writing `out[0..2]`.
 *   `aboveGrade` is metres above local grade, `localY` 0..1 up the stone's own
 *   face, `crevice` 0..1 how far the point has rolled into its joint, `normalY`
 *   the final normal's vertical component.
 */
export function createRoundedStoneShader({
  albedo,
  grade = null,
  weather = 0,
  occlusion,
}) {
  const tint = occlusion.groundTint;
  const tintHeight = occlusion.groundTintHeight;
  const baseHeight = occlusion.baseHeight;

  return function shade(out, aboveGrade, localY, crevice, normalY) {
    const creviceShade = occlusion.crevice * crevice * Math.sqrt(crevice);
    const underside = 1 - localY;
    const downShade = occlusion.down * underside * underside * underside;
    const faceShade = occlusion.face * (normalY < 0 ? -normalY : 0);
    const skyLift = occlusion.sky * (normalY > 0 ? normalY : 0);
    const baseShade = occlusion.base * clamp01(1 - aboveGrade / baseHeight);
    const shadeValue = (1 - creviceShade)
      * (1 - downShade)
      * (1 - faceShade)
      * (1 - baseShade)
      * (1 + skyLift);
    const tintAmount = tintHeight > 0 ? clamp01(1 - aboveGrade / tintHeight) : 0;

    for (let channel = 0; channel < 3; channel += 1) {
      const tinted = albedo[channel] * (1 + (tint[channel] - 1) * tintAmount);
      const shaded = clamp01(tinted * shadeValue - weather);
      out[channel] = grade ? clamp01(shaded * grade[channel]) : shaded;
    }
    return out;
  };
}
