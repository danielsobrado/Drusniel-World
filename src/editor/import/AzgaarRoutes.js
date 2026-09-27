/**
 * Azgaar land routes (roads and trails; sea routes are left out) as polylines
 * in atlas coordinates, the same space rivers use. The terrain grades them
 * into walkable paths (world/TrailGrading.js).
 */
export const LAND_ROUTE_GROUPS = Object.freeze(['roads', 'trails']);

export function createRouteData(document, atlasWidth, atlasHeight) {
  const sourceWidth = document.info?.width;
  const sourceHeight = document.info?.height;
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) return [];
  return (document.pack?.routes ?? []).flatMap((route) => {
    if (!LAND_ROUTE_GROUPS.includes(route?.group) || !Array.isArray(route.points)) return [];
    const points = route.points
      .filter((point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]))
      .map(([x, y]) => [x / sourceWidth * atlasWidth, y / sourceHeight * atlasHeight]);
    if (points.length < 2) return [];
    return [{ id: Number.isSafeInteger(route.i) ? route.i : 0, group: route.group, points }];
  });
}

export function validateRouteMetadata(routes) {
  if (routes == null) return;
  if (!Array.isArray(routes)) throw new Error('Azgaar macro source routes must be an array.');
  for (const route of routes) {
    if (!LAND_ROUTE_GROUPS.includes(route?.group) || !Array.isArray(route.points) || route.points.length < 2) {
      throw new Error('Azgaar macro source contains invalid route metadata.');
    }
    for (const point of route.points) {
      if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
        throw new Error('Azgaar macro source contains invalid route coordinates.');
      }
    }
  }
}
