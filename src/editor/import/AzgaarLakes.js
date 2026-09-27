/**
 * Azgaar lake features.
 *
 * Azgaar stores a lake as one to a few cells below its land height, with the
 * marine biome, plus a feature record carrying the lake's own surface height
 * and outline. Rasterized as-is those cells become sea-level pits in the hills,
 * with ocean water in them. Instead the import:
 *
 *   - rasterizes lake cells as land at the lake's level, in the biome that
 *     surrounds them, so the base terrain has no pit and no marine tiles;
 *   - keeps each lake's height and outline, from which the water domain carves
 *     the basin and fills it at the lake's own level.
 */

function isLakeFeature(feature) {
  return feature?.type === 'lake' && Number.isSafeInteger(feature.i)
    && Number.isFinite(feature.height);
}

function lakeFeatures(document) {
  return (document.pack?.features ?? []).filter(isLakeFeature);
}

/** The most common biome among a lake's land neighbours; ties go to the lower id. */
function surroundingBiome(lakeId, cells) {
  const counts = new Map();
  for (const cell of cells) {
    if (cell?.f !== lakeId) continue;
    for (const neighbourIndex of cell.c ?? []) {
      const neighbour = cells[neighbourIndex];
      const biome = Number(neighbour?.biome);
      if (!neighbour || neighbour.f === lakeId || !Number.isInteger(biome) || biome <= 0) continue;
      counts.set(biome, (counts.get(biome) ?? 0) + 1);
    }
  }
  let selected = null;
  for (const [biome, count] of counts) {
    if (!selected || count > selected.count || (count === selected.count && biome < selected.biome)) {
      selected = { biome, count };
    }
  }
  return selected?.biome ?? null;
}

/**
 * Per lake feature id, what its cells rasterize as: land at the lake's level
 * (rounded up, so the flat sits just above the water) in the surrounding biome.
 * Lakes with no land neighbour are left to Azgaar's own cells.
 */
export function createLakeCellOverrides(document) {
  const cells = Array.isArray(document.pack?.cells) ? document.pack.cells : [];
  const overrides = new Map();
  for (const lake of lakeFeatures(document)) {
    const biome = surroundingBiome(lake.i, cells);
    if (biome === null) continue;
    overrides.set(lake.i, Object.freeze({
      elevation: Math.min(100, Math.ceil(lake.height)),
      biome,
    }));
  }
  return overrides;
}

/** Each lake's surface height (Azgaar units) and outline in atlas coordinates. */
export function createLakeData(document, atlasWidth, atlasHeight) {
  const sourceWidth = document.info.width;
  const sourceHeight = document.info.height;
  const vertices = Array.isArray(document.pack?.vertices) ? document.pack.vertices : [];
  return lakeFeatures(document).flatMap((feature) => {
    if (!Array.isArray(feature.vertices)) return [];
    const outline = feature.vertices.flatMap((index) => {
      const point = vertices[index]?.p;
      return Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1])
        ? [[point[0] / sourceWidth * atlasWidth, point[1] / sourceHeight * atlasHeight]]
        : [];
    });
    if (outline.length < 3) return [];
    return [{
      id: feature.i,
      name: typeof feature.name === 'string' ? feature.name : null,
      height: feature.height,
      outline,
    }];
  });
}
