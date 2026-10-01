import { color as colorNode, dot, mix, smoothstep, vec3 } from 'three/tsl';

/**
 * grass-test's canopy grade (`AdventurePalette.adventureCanopyColor`): an
 * authored leaf texture is re-coloured by its own luminance onto one shade→light
 * ramp, so every textured crown — gold, silver or green at the source — reads as
 * the same lit green canopy, while the darkest texels (branch detail painted into
 * the cards) keep their own colour. Its defaults are the donor's shipped
 * `canopyShadow`/`canopyLight`/`canopyTint`.
 *
 * Only textured authored crowns are graded: palette-painted crowns already take
 * their biome's hue, and vertex-painted ones (the alpine conifers' settled snow)
 * carry colour a ramp would erase.
 */
export const DEFAULT_CANOPY_GRADE = Object.freeze({
  enabled: true,
  shadow: '#286746',
  light: '#8cb75a',
  tint: 0.9,
});

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** @param {object | undefined} source `stylizedSurface.trees.canopyGrade` */
export function resolveCanopyGrade(source) {
  if (source?.enabled === false) return null;
  const grade = { ...DEFAULT_CANOPY_GRADE, ...(source ?? {}) };
  for (const key of ['shadow', 'light']) {
    if (typeof grade[key] !== 'string' || !HEX_COLOR.test(grade[key])) {
      throw new Error(`Invalid editor configuration: stylizedSurface.trees.canopyGrade.${key} must be a #rrggbb colour.`);
    }
  }
  if (!Number.isFinite(grade.tint) || grade.tint < 0 || grade.tint > 1) {
    throw new Error('Invalid editor configuration: stylizedSurface.trees.canopyGrade.tint must be in [0, 1].');
  }
  return grade;
}

/**
 * @param {object} sample vec3 leaf colour from the authored texture
 * @param {object | null} grade resolveCanopyGrade()
 */
export function gradeCanopy(sample, grade) {
  if (!grade) return sample;
  const luminance = dot(sample, vec3(0.2126, 0.7152, 0.0722));
  const ramp = mix(colorNode(grade.shadow), colorNode(grade.light), smoothstep(0.03, 0.8, luminance));
  return mix(sample, ramp, smoothstep(0.025, 0.14, luminance).mul(grade.tint));
}
