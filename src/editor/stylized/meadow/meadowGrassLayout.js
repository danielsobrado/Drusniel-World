/**
 * Meadow grass tiling and LOD bands, ported from grass-test's `GrassFieldLayout`
 * and `grassLodPolicy`, in metres.
 *
 * Blades live on a camera-centred grid of square tiles. Each tile draws one of
 * four bands by its nearest distance to the camera, and a band is two knobs tuned
 * independently: `detail` is the blade's segment count (2·detail − 1 triangles)
 * and `density` its population, stems per metre along each side of the tile.
 * Neither may grow with distance, or a nearer band would look cheaper than the
 * one behind it. `distance` is a fraction of `maxDistance`; the last band ends at
 * 1 so the bands reach it.
 */
export const LOD_ORDER = Object.freeze(['high', 'medium', 'low', 'veryLow']);
export const MAX_GRASS_DETAIL = 8;

export function grassTrianglesPerBlade(detail) {
  return Math.max(1, Math.round(detail)) * 2 - 1;
}

/** Stems in one tile of a band: the per-side count squared, as the template builds it. */
export function bandStemCount(tileSize, density) {
  return Math.floor(tileSize * density) ** 2;
}

/** Squared distance from the camera to the nearest point of a tile. */
export function tileDistanceSquared(cameraX, cameraZ, tileX, tileZ, tileSize) {
  const half = tileSize * 0.5;
  const dx = Math.max(Math.abs(cameraX - tileX) - half, 0);
  const dz = Math.max(Math.abs(cameraZ - tileZ) - half, 0);
  return dx * dx + dz * dz;
}

/** Flat [name, thresholdSquared, …] so the per-tile loop compares against squares. */
export function lodThresholds(maxDistance, lod) {
  const thresholds = [];
  for (const name of LOD_ORDER) {
    const threshold = lod[name].distance * maxDistance;
    thresholds.push(name, threshold * threshold);
  }
  return thresholds;
}

export function selectLod(distanceSquared, thresholds) {
  for (let index = 0; index < thresholds.length; index += 2) {
    if (distanceSquared < thresholds[index + 1]) return thresholds[index];
  }
  return null;
}

/**
 * The per-band vectors the blade material retires stems by (the donor's
 * `GrassMaterial.setLod`): (band end in metres, stems in this band's tile,
 * stems in the next band's tile, fade window in metres). A band's tile holds the
 * first `count` stems of the shared stable sequence, so stems ranked between the
 * next band's count and this one's are the ones that retire across the band.
 */
export function lodBandVectors({ tileSize, maxDistance, lod }) {
  const counts = LOD_ORDER.map((name) => bandStemCount(tileSize, lod[name].density));
  return LOD_ORDER.map((name, index) => {
    const end = lod[name].distance * maxDistance;
    const previous = index === 0 ? 0 : lod[LOD_ORDER[index - 1]].distance * maxDistance;
    // A wide window lets a band's extra stems sink over up to 20 m, so the density
    // step reads as a gradient rather than a ring that follows the camera.
    return [end, counts[index], counts[index + 1] ?? 0, Math.min(20, (end - previous) * 0.6)];
  });
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

/** Validates a band set; throws with every problem at once. */
export function validateLodBands(lod, path) {
  const problems = [];
  if (typeof lod !== 'object' || lod === null) throw new Error(`Invalid editor configuration: ${path} is missing.`);
  let previousDistance = 0;
  let previousDetail = Infinity;
  let previousDensity = Infinity;
  for (const name of LOD_ORDER) {
    const band = lod[name];
    const bandPath = `${path}.${name}`;
    if (typeof band !== 'object' || band === null) {
      problems.push(`${bandPath} is missing`);
      continue;
    }
    const { detail, density, distance } = band;
    if (!positiveInteger(detail) || detail > MAX_GRASS_DETAIL) problems.push(`${bandPath}.detail must be an integer in 1..${MAX_GRASS_DETAIL}`);
    else if (detail > previousDetail) problems.push(`${bandPath}.detail exceeds the nearer band's`);
    else previousDetail = detail;
    if (!(Number.isFinite(density) && density > 0)) problems.push(`${bandPath}.density must be positive`);
    else if (density > previousDensity) problems.push(`${bandPath}.density exceeds the nearer band's`);
    else previousDensity = density;
    if (!(Number.isFinite(distance) && distance > 0 && distance <= 1)) problems.push(`${bandPath}.distance must be in (0, 1]`);
    else if (distance <= previousDistance) problems.push(`${bandPath}.distance must exceed the nearer band's`);
    else previousDistance = distance;
  }
  if (lod[LOD_ORDER.at(-1)]?.distance !== 1) problems.push(`${path}.${LOD_ORDER.at(-1)}.distance must be 1`);
  if (problems.length) throw new Error(`Invalid editor configuration: ${problems.join('; ')}.`);
}
