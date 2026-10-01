/**
 * The shape of a village roof, as pure maths.
 *
 * A roof covers an axis-aligned rectangle. In its local frame `a` runs along
 * the ridge and `c` across it; `r` is the normalised distance from the ridge
 * (0) to the eaves edge (1), overhang included. The pitch profile `f(r)` is a
 * straight line blended toward a parabola by `sweep`, which steepens the roof
 * near the ridge and kicks it out flatter at the eaves — the bell-cast of the
 * grass-test village houses. `sag` lowers the ridge toward its middle, and
 * `hip` turns each end into a hipped face whose run is that fraction of the
 * eaves distance.
 *
 * Kept free of three.js so the geometry builders, dormers, chimneys and the
 * tests all agree on one height function.
 */

export function createRoofSurface({
  x0,
  x1,
  z0,
  z1,
  axis = 'x',
  wallTop,
  rise,
  overhang = 0.35,
  endOverhang = overhang,
  sweep = 0,
  sag = 0,
  hip = 0,
}) {
  const alongX = axis === 'x';
  const center = [(x0 + x1) / 2, (z0 + z1) / 2];
  // Local basis: (A, up, C) is right-handed, so geometry built in (a, y, c)
  // keeps its winding when placed in the world.
  const alongAxis = alongX ? [1, 0] : [0, 1];
  const acrossAxis = alongX ? [0, 1] : [-1, 0];
  const halfSpan = (alongX ? x1 - x0 : z1 - z0) / 2;
  const halfDepth = (alongX ? z1 - z0 : x1 - x0) / 2;
  const eaves = halfDepth + overhang;
  const halfLength = halfSpan + endOverhang;
  const hipRun = Math.min(eaves, Math.max(0, hip) * eaves);
  const ridgeHalf = Math.max(0, halfLength - hipRun);
  const blend = Math.min(1, Math.max(0, sweep)) * 0.6;
  const wallRatio = halfDepth / eaves;

  const profile = (r) => (1 - blend) * r + blend * (2 * r - r * r);
  const wallProfile = profile(wallRatio);

  function ridgeHeight(a) {
    const along = Math.max(-ridgeHalf, Math.min(ridgeHalf, a));
    const t = halfLength > 0 ? along / halfLength : 0;
    return wallTop + rise - sag * Math.max(0, 1 - t * t);
  }

  /** Roof height at ridge distance `r` and along-ridge position `a`. */
  function height(r, a = 0) {
    const ridge = ridgeHeight(a);
    return ridge - (ridge - wallTop) * profile(r) / wallProfile;
  }

  function toWorld(a, y, c) {
    return [
      center[0] + alongAxis[0] * a + acrossAxis[0] * c,
      y,
      center[1] + alongAxis[1] * a + acrossAxis[1] * c,
    ];
  }

  function toLocal(x, z) {
    const dx = x - center[0];
    const dz = z - center[1];
    return {
      a: dx * alongAxis[0] + dz * alongAxis[1],
      c: dx * acrossAxis[0] + dz * acrossAxis[1],
    };
  }

  /** Normalised ridge distance of a local point, accounting for hipped ends. */
  function ridgeDistance(a, c) {
    const side = Math.abs(c) / eaves;
    const end = hipRun > 0 ? Math.max(0, Math.abs(a) - ridgeHalf) / hipRun : 0;
    return Math.max(side, end);
  }

  /** Height of the roof surface above a world point, or null outside it. */
  function heightAt(x, z) {
    const { a, c } = toLocal(x, z);
    if (Math.abs(a) > halfLength || Math.abs(c) > eaves) return null;
    const r = ridgeDistance(a, c);
    return r > 1 ? null : height(r, a);
  }

  /** Ridge distance at which the surface reaches `y` on the side faces. */
  function distanceAtHeight(y, a = 0) {
    let low = 0;
    let high = 1;
    for (let iteration = 0; iteration < 24; iteration += 1) {
      const middle = (low + high) / 2;
      if (height(middle, a) > y) low = middle;
      else high = middle;
    }
    return (low + high) / 2;
  }

  return Object.freeze({
    axis,
    alongAxis,
    acrossAxis,
    center,
    wallTop,
    rise,
    halfSpan,
    halfDepth,
    halfLength,
    eaves,
    hipRun,
    ridgeHalf,
    wallRatio,
    sweep,
    sag,
    height,
    ridgeHeight,
    toWorld,
    toLocal,
    heightAt,
    ridgeDistance,
    distanceAtHeight,
  });
}
