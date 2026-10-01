/**
 * Contact shade — the soft dark patch where a trunk or a boulder meets the
 * ground — after grass-test's `writeContactShade`.
 *
 * The donor paints `{x, z, radius, strength}` footprints into a channel of a
 * ground texture it already had, falling off quadratically. Here they go into the
 * second channel of the per-chunk ground texture the forest floor already uses, so
 * the ground reads both canopy shading and contact shading from one fetch.
 *
 * It exists because a real shadow is the sun's, not the object's: at a low sun a
 * trunk's shadow is long and somewhere else entirely, and inside the shadow-map
 * distance a tree can still look like it is hovering. This is ambient occlusion
 * rather than shadow — it does not move.
 */

export const DEFAULT_CONTACT_SHADE = Object.freeze({
  enabled: true,
  // The donor's footprints, at trunk scale now that the ground texture has 2 m
  // texels (forestFloorTexture.js): `trunk · 3 + 3` round a tree and
  // `radius · 1.5 + 1` round a stone. A patch is `base + radiusPerScale · scale`
  // metres; 1.2 a unit of scale stands for the donor's trunk and stone radii.
  treeRadius: 3,
  rockRadius: 1,
  radiusPerScale: 1.2,
  treeStrength: 1,
  rockStrength: 0.8,
});

export function resolveContactShade(config) {
  const configured = config?.contactShade;
  if (configured?.enabled === false) return null;
  const settings = { ...DEFAULT_CONTACT_SHADE, ...(configured ?? {}) };
  for (const key of ['treeRadius', 'rockRadius', 'radiusPerScale']) {
    const value = Number(settings[key]);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Invalid editor configuration: contactShade.${key} must not be negative.`);
    }
  }
  for (const key of ['treeStrength', 'rockStrength']) {
    const value = Number(settings[key]);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`Invalid editor configuration: contactShade.${key} must be within [0, 1].`);
    }
  }
  return settings;
}

/**
 * The patch round one tree or stone, in metres.
 *
 * @param {object} settings resolved contact shade
 * @param {'tree' | 'rock'} kind
 * @param {number} scale the placement's scale
 */
export function contactShadeRadius(settings, kind, scale = 1) {
  const base = kind === 'tree' ? settings.treeRadius : settings.rockRadius;
  return base + settings.radiusPerScale * (Number.isFinite(scale) ? scale : 1);
}

/**
 * Paints footprints into one channel of an interleaved byte texture.
 *
 * @param {object} options
 * @param {Uint8Array} options.pixels RGBA bytes, `size * size`
 * @param {number} options.size texels per side
 * @param {number} options.centerWorldX canonical centre of the texture
 * @param {number} options.centerWorldZ canonical centre of the texture
 * @param {number} options.chunkWorldSize metres the texture covers
 * @param {Array<{x: number, z: number, radius: number, strength?: number}>} options.sources
 * @param {number} [options.channel] byte offset within a texel, 0..3
 * @param {number} [options.strengthScale] multiplies every source's strength
 * @returns {number} how many sources landed inside the texture
 */
export function paintContactShade({
  pixels,
  size,
  centerWorldX,
  centerWorldZ,
  chunkWorldSize,
  sources,
  channel = 1,
  strengthScale = 1,
}) {
  if (!(pixels instanceof Uint8Array)) {
    throw new Error('Contact shade needs a byte texture to paint into.');
  }
  if (!Number.isInteger(size) || size < 1) {
    throw new Error('Contact shade needs a positive integer texture size.');
  }
  if (!(chunkWorldSize > 0)) {
    throw new Error('Contact shade needs a positive chunk world size.');
  }
  const half = chunkWorldSize / 2;
  const metersPerTexel = chunkWorldSize / size;
  let painted = 0;
  for (const source of sources ?? []) {
    const radius = Number(source?.radius);
    if (!Number.isFinite(radius) || radius <= 0) continue;
    if (!Number.isFinite(source.x) || !Number.isFinite(source.z)) continue;
    const strength = Number(source.strength ?? 1) * strengthScale;
    if (!(strength > 0)) continue;
    // Canonical to texel, in the same orientation the texture is written in: x
    // runs left to right, z runs *down* from the top edge.
    const centerTexelX = (source.x - (centerWorldX - half)) / metersPerTexel - 0.5;
    const centerTexelZ = ((centerWorldZ + half) - source.z) / metersPerTexel - 0.5;
    const texelRadius = radius / metersPerTexel;
    const minimumZ = Math.max(0, Math.floor(centerTexelZ - texelRadius));
    const maximumZ = Math.min(size - 1, Math.ceil(centerTexelZ + texelRadius));
    const minimumX = Math.max(0, Math.floor(centerTexelX - texelRadius));
    const maximumX = Math.min(size - 1, Math.ceil(centerTexelX + texelRadius));
    if (minimumX > maximumX || minimumZ > maximumZ) continue;
    painted += 1;
    for (let z = minimumZ; z <= maximumZ; z += 1) {
      for (let x = minimumX; x <= maximumX; x += 1) {
        const dx = (x - centerTexelX) / texelRadius;
        const dz = (z - centerTexelZ) / texelRadius;
        const distance = Math.hypot(dx, dz);
        if (distance >= 1) continue;
        // Quadratic, as the donor has it: a soft patch rather than a disc, with no
        // visible rim where it stops.
        const value = Math.round((1 - distance) * (1 - distance) * strength * 255);
        const index = (z * size + x) * 4 + channel;
        if (value > pixels[index]) pixels[index] = Math.min(255, value);
      }
    }
  }
  return painted;
}
