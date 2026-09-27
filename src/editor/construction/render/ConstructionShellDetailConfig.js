/**
 * The wall shell's stone-detail texture, shared by
 * `scripts/prepare-construction-textures.mjs`, which bakes the texture to these
 * statistics, and `ConstructionShellDetail.js`, which divides the mean back out
 * so the texture only redistributes a shell's brightness.
 */
export const SHELL_DETAIL_URL = '/assets/textures/construction/shell-stone-detail.png';

/** Mean texel value the texture is normalized to. */
export const SHELL_DETAIL_MEAN = 0.72;

/** Standard deviation of the texels around that mean. */
export const SHELL_DETAIL_CONTRAST = 0.1;

/** Wall-local metres one tile of the texture covers. */
export const SHELL_DETAIL_METERS = 4;
