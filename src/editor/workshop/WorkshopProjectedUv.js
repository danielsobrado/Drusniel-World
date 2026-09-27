/**
 * The workshop's dominant-axis box projection, Three.js-free.
 *
 * Kept apart from `ProceduralWorkshopGeometry` so meshers that write typed
 * arrays directly — and may run in a worker — project exactly as
 * `applyWorkshopProjectedUv` does, and imported material presets land the same
 * way on every kind of stone.
 */

/** Default texel density of the projection. */
export const WORKSHOP_UV_DENSITY = 0.58;

/** Project one vertex, writing `uv[offset]` and `uv[offset + 1]`. */
export function projectedUvAt(uv, offset, px, py, pz, nx, ny, nz, density = WORKSHOP_UV_DENSITY) {
  const normalX = Math.abs(nx);
  const normalY = Math.abs(ny);
  const normalZ = Math.abs(nz);
  if (normalX >= normalY && normalX >= normalZ) {
    uv[offset] = pz * density;
    uv[offset + 1] = py * density;
  } else if (normalY >= normalX && normalY >= normalZ) {
    uv[offset] = px * density;
    uv[offset + 1] = pz * density;
  } else {
    uv[offset] = px * density;
    uv[offset + 1] = py * density;
  }
}
